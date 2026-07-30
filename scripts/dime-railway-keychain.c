#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <errno.h>
#include <pwd.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#define MAX_CREDENTIAL_BYTES (16 * 1024)
#define MAX_CHILD_ENV 32

static const char *KEYCHAIN_SERVICE =
    "com.aisportsbettingmodels.dime.railway-api-token.v1";
static const char *KEYCHAIN_ACCOUNT = "dime-control-plane";
static const char *RAILWAY_EXECUTABLE = "/opt/homebrew/bin/railway";
static const char *BROKER_HOME_SUFFIX =
    "/Library/Application Support/DimeAI/railway-home";
static const char *PINNED_PROJECT =
    "8dd7341d-702c-48c7-90df-5c19a4f04913";
static const char *PINNED_ENVIRONMENT =
    "787f3113-17ab-47d9-9819-1268aeb09b3e";
static const char *PINNED_SERVICES[] = {
    "a46ea921-5c5d-4225-9254-92f742e95b51",
    "3528dc9f-a63b-45e9-94bb-6d1df25d6f3a",
    "a48cf462-136a-4d9b-b427-00504927116a",
};

static void secure_zero(void *pointer, size_t length) {
  volatile unsigned char *bytes = pointer;
  while (length-- > 0)
    *bytes++ = 0;
}

static void fail_closed(const char *message) {
  fprintf(stderr, "Secure Railway broker failed closed: %s\n", message);
  exit(1);
}

static CFStringRef cf_string(const char *value) {
  return CFStringCreateWithCString(kCFAllocatorDefault, value,
                                   kCFStringEncodingUTF8);
}

static CFMutableDictionaryRef base_query(void) {
  CFMutableDictionaryRef query = CFDictionaryCreateMutable(
      kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks);
  CFStringRef service = cf_string(KEYCHAIN_SERVICE);
  CFStringRef account = cf_string(KEYCHAIN_ACCOUNT);
  if (query == NULL || service == NULL || account == NULL) {
    if (service != NULL)
      CFRelease(service);
    if (account != NULL)
      CFRelease(account);
    if (query != NULL)
      CFRelease(query);
    fail_closed("unable to construct Keychain query");
  }
  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, service);
  CFDictionarySetValue(query, kSecAttrAccount, account);
  CFDictionarySetValue(query, kSecAttrSynchronizable, kCFBooleanFalse);
  CFRelease(service);
  CFRelease(account);
  return query;
}

static unsigned char *read_credential_from_stdin(size_t *length) {
  unsigned char *buffer = calloc(MAX_CREDENTIAL_BYTES + 2, 1);
  if (buffer == NULL)
    fail_closed("unable to allocate credential input");

  size_t used = 0;
  while (!feof(stdin)) {
    if (used >= MAX_CREDENTIAL_BYTES + 1) {
      secure_zero(buffer, MAX_CREDENTIAL_BYTES + 2);
      free(buffer);
      fail_closed("credential input exceeded size limit");
    }
    size_t count =
        fread(buffer + used, 1, MAX_CREDENTIAL_BYTES + 1 - used, stdin);
    used += count;
    if (ferror(stdin)) {
      secure_zero(buffer, MAX_CREDENTIAL_BYTES + 2);
      free(buffer);
      fail_closed("credential input failed");
    }
  }
  while (used > 0 && (buffer[used - 1] == '\n' || buffer[used - 1] == '\r'))
    used--;
  if (used < 20 || used > MAX_CREDENTIAL_BYTES) {
    secure_zero(buffer, MAX_CREDENTIAL_BYTES + 2);
    free(buffer);
    fail_closed("credential input is invalid");
  }
  for (size_t index = 0; index < used; index++) {
    if (buffer[index] == '\0' || buffer[index] == ' ' || buffer[index] == '\t' ||
        buffer[index] == '\n' || buffer[index] == '\r') {
      secure_zero(buffer, MAX_CREDENTIAL_BYTES + 2);
      free(buffer);
      fail_closed("credential input contains invalid whitespace");
    }
  }
  *length = used;
  return buffer;
}

static void import_credential(void) {
  size_t length = 0;
  unsigned char *credential = read_credential_from_stdin(&length);
  CFDataRef data =
      CFDataCreate(kCFAllocatorDefault, credential, (CFIndex)length);
  if (data == NULL) {
    secure_zero(credential, MAX_CREDENTIAL_BYTES + 2);
    free(credential);
    fail_closed("unable to construct Keychain credential");
  }

  CFMutableDictionaryRef query = base_query();
  OSStatus delete_status = SecItemDelete(query);
  if (delete_status != errSecSuccess && delete_status != errSecItemNotFound) {
    CFRelease(data);
    CFRelease(query);
    secure_zero(credential, MAX_CREDENTIAL_BYTES + 2);
    free(credential);
    fail_closed("unable to replace existing Keychain credential");
  }
  CFDictionarySetValue(query, kSecValueData, data);
  CFDictionarySetValue(query, kSecAttrAccessible,
                       kSecAttrAccessibleWhenUnlockedThisDeviceOnly);
  OSStatus status = SecItemAdd(query, NULL);

  CFRelease(data);
  CFRelease(query);
  secure_zero(credential, MAX_CREDENTIAL_BYTES + 2);
  free(credential);
  if (status != errSecSuccess)
    fail_closed("unable to store Keychain credential");

  fputs("{\"status\":\"PASS\",\"storage\":\"macos-keychain\","
        "\"synchronizable\":false,\"credentialPrinted\":false}\n",
        stdout);
}

static unsigned char *load_credential(size_t *length) {
  CFMutableDictionaryRef query = base_query();
  CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(query, &result);
  CFRelease(query);
  if (status != errSecSuccess || result == NULL ||
      CFGetTypeID(result) != CFDataGetTypeID()) {
    if (result != NULL)
      CFRelease(result);
    fail_closed("Keychain credential is unavailable");
  }

  CFDataRef data = (CFDataRef)result;
  CFIndex count = CFDataGetLength(data);
  if (count < 20 || count > MAX_CREDENTIAL_BYTES) {
    CFRelease(data);
    fail_closed("Keychain credential length is invalid");
  }
  unsigned char *credential = calloc((size_t)count + 1, 1);
  if (credential == NULL) {
    CFRelease(data);
    fail_closed("unable to allocate Keychain credential");
  }
  CFDataGetBytes(data, CFRangeMake(0, count), credential);
  CFRelease(data);
  *length = (size_t)count;
  return credential;
}

static void report_status(void) {
  size_t length = 0;
  unsigned char *credential = load_credential(&length);
  secure_zero(credential, length + 1);
  free(credential);
  fputs("{\"status\":\"PASS\",\"storage\":\"macos-keychain\","
        "\"credentialAvailable\":true,\"credentialPrinted\":false}\n",
        stdout);
}

static void append_environment(char **environment, size_t *count,
                               const char *name, const char *value) {
  if (value == NULL || *count >= MAX_CHILD_ENV - 1)
    return;
  size_t bytes = strlen(name) + strlen(value) + 2;
  char *entry = calloc(bytes, 1);
  if (entry == NULL)
    fail_closed("unable to allocate Railway environment");
  snprintf(entry, bytes, "%s=%s", name, value);
  environment[(*count)++] = entry;
}

static char *resolve_broker_home(void) {
  errno = 0;
  struct passwd *account = getpwuid(getuid());
  if (account == NULL || account->pw_dir == NULL || account->pw_dir[0] != '/')
    fail_closed("unable to resolve the installing user's home directory");

  size_t bytes = strlen(account->pw_dir) + strlen(BROKER_HOME_SUFFIX) + 1;
  char *path = calloc(bytes, 1);
  if (path == NULL)
    fail_closed("unable to allocate the isolated Railway home path");
  snprintf(path, bytes, "%s%s", account->pw_dir, BROKER_HOME_SUFFIX);

  struct stat state;
  if (lstat(path, &state) != 0 || !S_ISDIR(state.st_mode) ||
      S_ISLNK(state.st_mode) || state.st_uid != getuid() ||
      (state.st_mode & 07777) != 0700) {
    free(path);
    fail_closed("isolated Railway home is not an owned mode-0700 directory");
  }
  return path;
}

static bool is_pinned_service(const char *value) {
  for (size_t index = 0;
       index < sizeof(PINNED_SERVICES) / sizeof(PINNED_SERVICES[0]); index++) {
    if (strcmp(value, PINNED_SERVICES[index]) == 0)
      return true;
  }
  return false;
}

static bool is_allowed_read_command(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--version") == 0)
    return true;
  if (argc == 7 && strcmp(argv[1], "status") == 0 &&
      strcmp(argv[2], "--project") == 0 &&
      strcmp(argv[3], PINNED_PROJECT) == 0 &&
      strcmp(argv[4], "--environment") == 0 &&
      strcmp(argv[5], PINNED_ENVIRONMENT) == 0 &&
      strcmp(argv[6], "--json") == 0)
    return true;
  if (argc == 8 && strcmp(argv[1], "variable") == 0 &&
      strcmp(argv[2], "list") == 0 &&
      strcmp(argv[3], "--project") == 0 &&
      strcmp(argv[4], PINNED_PROJECT) == 0 &&
      strcmp(argv[5], "--environment") == 0 &&
      strcmp(argv[6], PINNED_ENVIRONMENT) == 0 &&
      strcmp(argv[7], "--json") == 0)
    return true;
  if (argc == 12 && strcmp(argv[1], "deployment") == 0 &&
      strcmp(argv[2], "list") == 0 &&
      strcmp(argv[3], "--project") == 0 &&
      strcmp(argv[4], PINNED_PROJECT) == 0 &&
      strcmp(argv[5], "--environment") == 0 &&
      strcmp(argv[6], PINNED_ENVIRONMENT) == 0 &&
      strcmp(argv[7], "--service") == 0 && is_pinned_service(argv[8]) &&
      strcmp(argv[9], "--limit") == 0 && strcmp(argv[10], "1") == 0 &&
      strcmp(argv[11], "--json") == 0)
    return true;
  return false;
}

static int execute_railway(int argc, char **argv) {
  if (argc < 2)
    fail_closed("a Railway command is required");
  if (!is_allowed_read_command(argc, argv))
    fail_closed("command is outside the pinned read-only contract");
  if (access(RAILWAY_EXECUTABLE, X_OK) != 0)
    fail_closed("the pinned Railway CLI is unavailable");
  umask(0077);

  size_t credential_length = 0;
  unsigned char *credential = load_credential(&credential_length);

  char *environment[MAX_CHILD_ENV] = {0};
  size_t environment_count = 0;
  const char *allowed[] = {"PATH", "TMPDIR", "USER", "LOGNAME", "SHELL",
                           "LANG", "LC_ALL", "LC_CTYPE", "SSH_AUTH_SOCK",
                           "TERM", "CI"};
  const size_t allowed_count = sizeof(allowed) / sizeof(allowed[0]);
  for (size_t index = 0; index < allowed_count; index++)
    append_environment(environment, &environment_count, allowed[index],
                       getenv(allowed[index]));
  char *broker_home = resolve_broker_home();
  append_environment(environment, &environment_count, "HOME", broker_home);
  free(broker_home);
  append_environment(environment, &environment_count, "NO_COLOR", "1");
  append_environment(environment, &environment_count, "RAILWAY_API_TOKEN",
                     (const char *)credential);
  environment[environment_count] = NULL;

  char **child_argv = calloc((size_t)argc + 1, sizeof(char *));
  if (child_argv == NULL)
    fail_closed("unable to allocate Railway arguments");
  child_argv[0] = (char *)RAILWAY_EXECUTABLE;
  for (int index = 1; index < argc; index++)
    child_argv[index] = argv[index];
  child_argv[argc] = NULL;

  pid_t child = 0;
  int spawn_status =
      posix_spawn(&child, RAILWAY_EXECUTABLE, NULL, NULL, child_argv, environment);

  secure_zero(credential, credential_length + 1);
  free(credential);
  for (size_t index = 0; index < environment_count; index++) {
    if (strncmp(environment[index], "RAILWAY_API_TOKEN=", 18) == 0)
      secure_zero(environment[index], strlen(environment[index]));
    free(environment[index]);
  }
  free(child_argv);
  if (spawn_status != 0)
    fail_closed("unable to execute the Railway CLI");

  int status = 0;
  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR)
      fail_closed("unable to wait for the Railway CLI");
  }
  if (WIFEXITED(status))
    return WEXITSTATUS(status);
  if (WIFSIGNALED(status))
    return 128 + WTERMSIG(status);
  return 1;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "import") == 0) {
    import_credential();
    return 0;
  }
  if (argc == 2 && strcmp(argv[1], "status") == 0) {
    report_status();
    return 0;
  }
  return execute_railway(argc, argv);
}
