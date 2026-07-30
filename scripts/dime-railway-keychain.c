#include <CommonCrypto/CommonDigest.h>
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <mach-o/dyld.h>
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
#define MAX_VARIABLE_MAP_BYTES (1024 * 1024)
#define MAX_SELECTED_CREDENTIAL_BYTES (32 * 1024)
#define MAX_JSON_DEPTH 32

#ifndef DIME_NODE_EXECUTABLE
#define DIME_NODE_EXECUTABLE "/usr/bin/false"
#endif

#ifndef DIME_NODE_SHA256
#define DIME_NODE_SHA256                                                         \
  "0000000000000000000000000000000000000000000000000000000000000000"
#endif

#ifndef DIME_PRODUCTION_AUTH_SCRIPT
#define DIME_PRODUCTION_AUTH_SCRIPT "/dev/null"
#endif

#ifndef DIME_PRODUCTION_AUTH_SHA256
#define DIME_PRODUCTION_AUTH_SHA256                                              \
  "0000000000000000000000000000000000000000000000000000000000000000"
#endif

#ifndef DIME_RAILWAY_EXECUTABLE
#define DIME_RAILWAY_EXECUTABLE "/usr/bin/false"
#endif

#ifndef DIME_RAILWAY_SHA256
#define DIME_RAILWAY_SHA256                                                      \
  "0000000000000000000000000000000000000000000000000000000000000000"
#endif

static const char *KEYCHAIN_SERVICE =
    "com.aisportsbettingmodels.dime.railway-api-token.v1";
static const char *KEYCHAIN_ACCOUNT = "dime-control-plane";
static const char *RAILWAY_EXECUTABLE = DIME_RAILWAY_EXECUTABLE;
static const char *TRUST_DIRECTORY =
    "/Library/Application Support/DimeAI/trust";
static const char *PROVENANCE_FILE =
    "/Library/Application Support/DimeAI/trust/dime-railway-keychain.sha256";
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

static bool is_sha256_hex(const char *value) {
  if (value == NULL || strlen(value) != 64)
    return false;
  for (size_t index = 0; index < 64; index++) {
    char character = value[index];
    if (!((character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f')))
      return false;
  }
  return true;
}

static void sha256_file(const char *path, char output[65]) {
  FILE *file = fopen(path, "rb");
  if (file == NULL)
    fail_closed("unable to open a provenance-pinned artifact");
  CC_SHA256_CTX context;
  if (CC_SHA256_Init(&context) != 1) {
    fclose(file);
    fail_closed("unable to initialize artifact hashing");
  }
  unsigned char buffer[64 * 1024];
  while (!feof(file)) {
    size_t count = fread(buffer, 1, sizeof(buffer), file);
    if (count > 0 && CC_SHA256_Update(&context, buffer, (CC_LONG)count) != 1) {
      secure_zero(buffer, sizeof(buffer));
      fclose(file);
      fail_closed("unable to hash a provenance-pinned artifact");
    }
    if (ferror(file)) {
      secure_zero(buffer, sizeof(buffer));
      fclose(file);
      fail_closed("unable to read a provenance-pinned artifact");
    }
  }
  secure_zero(buffer, sizeof(buffer));
  fclose(file);
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  if (CC_SHA256_Final(digest, &context) != 1)
    fail_closed("unable to finalize artifact hashing");
  static const char hexadecimal[] = "0123456789abcdef";
  for (size_t index = 0; index < sizeof(digest); index++) {
    output[index * 2] = hexadecimal[digest[index] >> 4];
    output[index * 2 + 1] = hexadecimal[digest[index] & 0x0f];
  }
  output[64] = '\0';
  secure_zero(digest, sizeof(digest));
}

static void executable_path(char output[PATH_MAX]) {
  uint32_t size = PATH_MAX;
  char unresolved[PATH_MAX];
  if (_NSGetExecutablePath(unresolved, &size) != 0 ||
      realpath(unresolved, output) == NULL)
    fail_closed("unable to resolve broker executable identity");
}

static void verify_trusted_provenance(void) {
  struct stat directory_state;
  struct stat provenance_state;
  if (lstat(TRUST_DIRECTORY, &directory_state) != 0 ||
      !S_ISDIR(directory_state.st_mode) || S_ISLNK(directory_state.st_mode) ||
      directory_state.st_uid != 0 ||
      (directory_state.st_mode & 07777) != 0755)
    fail_closed(
        "credential execution requires a root-owned mode-0755 trust directory");
  if (lstat(PROVENANCE_FILE, &provenance_state) != 0 ||
      !S_ISREG(provenance_state.st_mode) || S_ISLNK(provenance_state.st_mode) ||
      provenance_state.st_uid != 0 ||
      (provenance_state.st_mode & 07777) != 0444)
    fail_closed(
        "credential execution requires a root-owned immutable provenance file");

  FILE *file = fopen(PROVENANCE_FILE, "rb");
  if (file == NULL)
    fail_closed("unable to read independent broker provenance");
  char expected[66] = {0};
  size_t count = fread(expected, 1, sizeof(expected) - 1, file);
  bool read_failed = ferror(file) != 0;
  fclose(file);
  while (count > 0 &&
         (expected[count - 1] == '\n' || expected[count - 1] == '\r'))
    expected[--count] = '\0';
  if (read_failed || !is_sha256_hex(expected))
    fail_closed("independent broker provenance is malformed");

  char path[PATH_MAX];
  executable_path(path);
  char actual[65];
  sha256_file(path, actual);
  if (strcmp(actual, expected) != 0) {
    secure_zero(actual, sizeof(actual));
    secure_zero(expected, sizeof(expected));
    fail_closed("broker binary does not match independent provenance");
  }
  secure_zero(actual, sizeof(actual));
  secure_zero(expected, sizeof(expected));
}

static void verify_authentication_child(void) {
  char node_hash[65];
  char auth_hash[65];
  char railway_hash[65];
  sha256_file(DIME_NODE_EXECUTABLE, node_hash);
  sha256_file(DIME_PRODUCTION_AUTH_SCRIPT, auth_hash);
  sha256_file(DIME_RAILWAY_EXECUTABLE, railway_hash);
  bool matches =
      is_sha256_hex(DIME_NODE_SHA256) &&
      is_sha256_hex(DIME_PRODUCTION_AUTH_SHA256) &&
      is_sha256_hex(DIME_RAILWAY_SHA256) &&
      strcmp(node_hash, DIME_NODE_SHA256) == 0 &&
      strcmp(auth_hash, DIME_PRODUCTION_AUTH_SHA256) == 0 &&
      strcmp(railway_hash, DIME_RAILWAY_SHA256) == 0;
  secure_zero(node_hash, sizeof(node_hash));
  secure_zero(auth_hash, sizeof(auth_hash));
  secure_zero(railway_hash, sizeof(railway_hash));
  if (!matches)
    fail_closed("authentication child does not match compiled provenance");
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
  if (argc == 7 && strcmp(argv[1], "status") == 0 &&
      strcmp(argv[2], "--project") == 0 &&
      strcmp(argv[3], PINNED_PROJECT) == 0 &&
      strcmp(argv[4], "--environment") == 0 &&
      strcmp(argv[5], PINNED_ENVIRONMENT) == 0 &&
      strcmp(argv[6], "--json") == 0)
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

static bool is_platform_auth_command(int argc, char **argv) {
  return (argc == 3 ||
          (argc == 4 && strcmp(argv[3], "--headed") == 0)) &&
         strcmp(argv[1], "platform-auth") == 0 &&
         (strcmp(argv[2], "owner") == 0 || strcmp(argv[2], "user") == 0);
}

static void skip_json_whitespace(const unsigned char **cursor,
                                 const unsigned char *end) {
  while (*cursor < end &&
         (**cursor == ' ' || **cursor == '\n' || **cursor == '\r' ||
          **cursor == '\t'))
    (*cursor)++;
}

static int hexadecimal_value(unsigned char value) {
  if (value >= '0' && value <= '9')
    return value - '0';
  if (value >= 'a' && value <= 'f')
    return value - 'a' + 10;
  if (value >= 'A' && value <= 'F')
    return value - 'A' + 10;
  return -1;
}

static void append_utf8(char *output, size_t *used, unsigned int codepoint) {
  if (codepoint <= 0x7f) {
    output[(*used)++] = (char)codepoint;
  } else if (codepoint <= 0x7ff) {
    output[(*used)++] = (char)(0xc0 | (codepoint >> 6));
    output[(*used)++] = (char)(0x80 | (codepoint & 0x3f));
  } else {
    output[(*used)++] = (char)(0xe0 | (codepoint >> 12));
    output[(*used)++] = (char)(0x80 | ((codepoint >> 6) & 0x3f));
    output[(*used)++] = (char)(0x80 | (codepoint & 0x3f));
  }
}

static char *parse_json_string(const unsigned char **cursor,
                               const unsigned char *end) {
  if (*cursor >= end || **cursor != '"')
    fail_closed("Railway variable map contains a non-string key or value");
  (*cursor)++;
  size_t capacity = (size_t)(end - *cursor) + 1;
  char *output = calloc(capacity, 1);
  if (output == NULL)
    fail_closed("unable to allocate JSON string");
  size_t used = 0;
  while (*cursor < end) {
    unsigned char value = *(*cursor)++;
    if (value == '"') {
      output[used] = '\0';
      return output;
    }
    if (value < 0x20) {
      secure_zero(output, capacity);
      free(output);
      fail_closed("Railway variable map contains an invalid JSON string");
    }
    if (value != '\\') {
      output[used++] = (char)value;
      continue;
    }
    if (*cursor >= end) {
      secure_zero(output, capacity);
      free(output);
      fail_closed("Railway variable map contains a truncated escape");
    }
    unsigned char escape = *(*cursor)++;
    switch (escape) {
    case '"':
    case '\\':
    case '/':
      output[used++] = (char)escape;
      break;
    case 'b':
      output[used++] = '\b';
      break;
    case 'f':
      output[used++] = '\f';
      break;
    case 'n':
      output[used++] = '\n';
      break;
    case 'r':
      output[used++] = '\r';
      break;
    case 't':
      output[used++] = '\t';
      break;
    case 'u': {
      if ((size_t)(end - *cursor) < 4) {
        secure_zero(output, capacity);
        free(output);
        fail_closed("Railway variable map contains a truncated Unicode escape");
      }
      unsigned int codepoint = 0;
      for (size_t index = 0; index < 4; index++) {
        int digit = hexadecimal_value(*(*cursor)++);
        if (digit < 0) {
          secure_zero(output, capacity);
          free(output);
          fail_closed("Railway variable map contains an invalid Unicode escape");
        }
        codepoint = (codepoint << 4) | (unsigned int)digit;
      }
      if (codepoint == 0 ||
          (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
        secure_zero(output, capacity);
        free(output);
        fail_closed(
            "Railway variable map contains an unsupported Unicode codepoint");
      }
      append_utf8(output, &used, codepoint);
      break;
    }
    default:
      secure_zero(output, capacity);
      free(output);
      fail_closed("Railway variable map contains an invalid escape");
    }
  }
  secure_zero(output, capacity);
  free(output);
  fail_closed("Railway variable map contains an unterminated string");
  return NULL;
}

static void skip_json_value(const unsigned char **cursor,
                            const unsigned char *end, unsigned int depth) {
  if (depth > MAX_JSON_DEPTH)
    fail_closed("Railway variable map exceeded JSON nesting limit");
  skip_json_whitespace(cursor, end);
  if (*cursor >= end)
    fail_closed("Railway variable map contains a missing value");
  if (**cursor == '"') {
    char *ignored = parse_json_string(cursor, end);
    secure_zero(ignored, strlen(ignored));
    free(ignored);
    return;
  }
  if (**cursor == '{' || **cursor == '[') {
    unsigned char open = *(*cursor)++;
    unsigned char close = open == '{' ? '}' : ']';
    skip_json_whitespace(cursor, end);
    if (*cursor < end && **cursor == close) {
      (*cursor)++;
      return;
    }
    while (*cursor < end) {
      if (open == '{') {
        char *key = parse_json_string(cursor, end);
        secure_zero(key, strlen(key));
        free(key);
        skip_json_whitespace(cursor, end);
        if (*cursor >= end || *(*cursor)++ != ':')
          fail_closed("Railway variable map contains an invalid object");
      }
      skip_json_value(cursor, end, depth + 1);
      skip_json_whitespace(cursor, end);
      if (*cursor < end && **cursor == ',') {
        (*cursor)++;
        skip_json_whitespace(cursor, end);
        continue;
      }
      if (*cursor < end && **cursor == close) {
        (*cursor)++;
        return;
      }
      fail_closed("Railway variable map contains invalid JSON structure");
    }
    fail_closed("Railway variable map contains unterminated JSON");
  }
  const unsigned char *start = *cursor;
  while (*cursor < end && **cursor != ',' && **cursor != '}' &&
         **cursor != ']' && **cursor != ' ' && **cursor != '\n' &&
         **cursor != '\r' && **cursor != '\t')
    (*cursor)++;
  if (*cursor == start)
    fail_closed("Railway variable map contains an invalid value");
}

struct selected_credentials {
  const char *names[3];
  char *values[3];
};

static void clear_selected_credentials(struct selected_credentials *selected) {
  for (size_t index = 0; index < 3; index++) {
    if (selected->values[index] != NULL) {
      secure_zero(selected->values[index], strlen(selected->values[index]));
      free(selected->values[index]);
      selected->values[index] = NULL;
    }
  }
}

static bool contains_control_character(const char *value) {
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor;
       cursor++) {
    if (*cursor < 0x20 || *cursor == 0x7f)
      return true;
  }
  return false;
}

static struct selected_credentials
select_role_credentials(unsigned char *payload, size_t length,
                        const char *role) {
  struct selected_credentials selected = {0};
  if (strcmp(role, "owner") == 0) {
    selected.names[0] = "DIME_PROD_OWNER_EMAIL";
    selected.names[1] = "DIME_PROD_OWNER_PASSWORD";
    selected.names[2] = "DIME_PROD_OWNER_USERNAME";
  } else {
    selected.names[0] = "DIME_PROD_USER_EMAIL";
    selected.names[1] = "DIME_PROD_USER_PASSWORD";
    selected.names[2] = "DIME_PROD_USER_USERNAME";
  }
  const unsigned char *cursor = payload;
  const unsigned char *end = payload + length;
  skip_json_whitespace(&cursor, end);
  if (cursor >= end || *cursor++ != '{')
    fail_closed("Railway variable map must be a JSON object");
  skip_json_whitespace(&cursor, end);
  while (cursor < end && *cursor != '}') {
    char *key = parse_json_string(&cursor, end);
    skip_json_whitespace(&cursor, end);
    if (cursor >= end || *cursor++ != ':') {
      secure_zero(key, strlen(key));
      free(key);
      clear_selected_credentials(&selected);
      fail_closed("Railway variable map contains an invalid property");
    }
    skip_json_whitespace(&cursor, end);
    int selected_index = -1;
    for (size_t index = 0; index < 3; index++) {
      if (strcmp(key, selected.names[index]) == 0)
        selected_index = (int)index;
    }
    secure_zero(key, strlen(key));
    free(key);
    if (selected_index >= 0) {
      if (selected.values[selected_index] != NULL) {
        clear_selected_credentials(&selected);
        fail_closed("Railway variable map contains a duplicate role credential");
      }
      selected.values[selected_index] = parse_json_string(&cursor, end);
    } else {
      skip_json_value(&cursor, end, 0);
    }
    skip_json_whitespace(&cursor, end);
    if (cursor < end && *cursor == ',') {
      cursor++;
      skip_json_whitespace(&cursor, end);
      if (cursor >= end || *cursor == '}') {
        clear_selected_credentials(&selected);
        fail_closed("Railway variable map contains a trailing separator");
      }
      continue;
    }
    if (cursor < end && *cursor == '}')
      break;
    clear_selected_credentials(&selected);
    fail_closed("Railway variable map contains invalid object separators");
  }
  if (cursor >= end || *cursor++ != '}') {
    clear_selected_credentials(&selected);
    fail_closed("Railway variable map is unterminated");
  }
  skip_json_whitespace(&cursor, end);
  if (cursor != end) {
    clear_selected_credentials(&selected);
    fail_closed("Railway variable map contains trailing data");
  }
  for (size_t index = 0; index < 3; index++) {
    if (selected.values[index] == NULL || selected.values[index][0] == '\0') {
      clear_selected_credentials(&selected);
      fail_closed("Railway variable map is missing an exact role credential");
    }
  }
  if (strlen(selected.values[0]) > 320 ||
      strchr(selected.values[0], '@') == NULL ||
      strlen(selected.values[1]) < 8 ||
      strlen(selected.values[1]) > 1024 ||
      strlen(selected.values[2]) > 80 ||
      contains_control_character(selected.values[0]) ||
      contains_control_character(selected.values[1]) ||
      contains_control_character(selected.values[2])) {
    clear_selected_credentials(&selected);
    fail_closed("selected platform credential triple is invalid");
  }
  return selected;
}

static size_t json_escaped_length(const char *value) {
  size_t length = 0;
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor;
       cursor++) {
    if (*cursor == '"' || *cursor == '\\' || *cursor < 0x20)
      length += *cursor < 0x20 ? 6 : 2;
    else
      length++;
  }
  return length;
}

static void append_json_string(char *output, size_t *used, const char *value) {
  static const char hexadecimal[] = "0123456789abcdef";
  output[(*used)++] = '"';
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor;
       cursor++) {
    if (*cursor == '"' || *cursor == '\\') {
      output[(*used)++] = '\\';
      output[(*used)++] = (char)*cursor;
    } else if (*cursor < 0x20) {
      output[(*used)++] = '\\';
      output[(*used)++] = 'u';
      output[(*used)++] = '0';
      output[(*used)++] = '0';
      output[(*used)++] = hexadecimal[*cursor >> 4];
      output[(*used)++] = hexadecimal[*cursor & 0x0f];
    } else {
      output[(*used)++] = (char)*cursor;
    }
  }
  output[(*used)++] = '"';
}

static char *serialize_selected_credentials(
    const struct selected_credentials *selected, size_t *length) {
  size_t capacity = 32;
  for (size_t index = 0; index < 3; index++)
    capacity += strlen(selected->names[index]) +
                json_escaped_length(selected->values[index]) + 8;
  if (capacity > MAX_SELECTED_CREDENTIAL_BYTES)
    fail_closed("selected credential payload exceeded size limit");
  char *output = calloc(capacity, 1);
  if (output == NULL)
    fail_closed("unable to allocate selected credential payload");
  size_t used = 0;
  output[used++] = '{';
  for (size_t index = 0; index < 3; index++) {
    if (index > 0)
      output[used++] = ',';
    append_json_string(output, &used, selected->names[index]);
    output[used++] = ':';
    append_json_string(output, &used, selected->values[index]);
  }
  output[used++] = '}';
  output[used++] = '\n';
  output[used] = '\0';
  *length = used;
  return output;
}

static int wait_for_child(pid_t child) {
  int status = 0;
  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR)
      fail_closed("unable to wait for a broker child");
  }
  if (WIFEXITED(status))
    return WEXITSTATUS(status);
  if (WIFSIGNALED(status))
    return 128 + WTERMSIG(status);
  return 1;
}

static unsigned char *capture_railway_variable_map(size_t *length) {
  if (access(RAILWAY_EXECUTABLE, X_OK) != 0)
    fail_closed("the pinned Railway CLI is unavailable");
  int output_pipe[2];
  if (pipe(output_pipe) != 0)
    fail_closed("unable to create private Railway output pipe");
  posix_spawn_file_actions_t actions;
  int action_status = posix_spawn_file_actions_init(&actions);
  bool actions_initialized = action_status == 0;
  if (action_status == 0)
    action_status = posix_spawn_file_actions_adddup2(
        &actions, output_pipe[1], STDOUT_FILENO);
  if (action_status == 0)
    action_status = posix_spawn_file_actions_addopen(
        &actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0);
  if (action_status == 0)
    action_status =
        posix_spawn_file_actions_addclose(&actions, output_pipe[0]);
  if (action_status == 0)
    action_status =
        posix_spawn_file_actions_addclose(&actions, output_pipe[1]);
  if (action_status != 0) {
    if (actions_initialized)
      posix_spawn_file_actions_destroy(&actions);
    close(output_pipe[0]);
    close(output_pipe[1]);
    fail_closed("unable to configure private Railway output pipe");
  }
  size_t credential_length = 0;
  unsigned char *credential = load_credential(&credential_length);
  char *environment[MAX_CHILD_ENV] = {0};
  size_t environment_count = 0;
  char *broker_home = resolve_broker_home();
  append_environment(environment, &environment_count, "HOME", broker_home);
  free(broker_home);
  append_environment(environment, &environment_count, "PATH", "/usr/bin:/bin");
  append_environment(environment, &environment_count, "NO_COLOR", "1");
  append_environment(environment, &environment_count, "RAILWAY_API_TOKEN",
                     (const char *)credential);
  environment[environment_count] = NULL;

  char *arguments[] = {
      (char *)RAILWAY_EXECUTABLE,
      "variable",
      "list",
      "--project",
      (char *)PINNED_PROJECT,
      "--environment",
      (char *)PINNED_ENVIRONMENT,
      "--json",
      NULL,
  };
  pid_t child = 0;
  int spawn_status = posix_spawn(&child, RAILWAY_EXECUTABLE, &actions, NULL,
                                 arguments, environment);
  posix_spawn_file_actions_destroy(&actions);
  close(output_pipe[1]);
  secure_zero(credential, credential_length + 1);
  free(credential);
  for (size_t index = 0; index < environment_count; index++) {
    if (strncmp(environment[index], "RAILWAY_API_TOKEN=", 18) == 0)
      secure_zero(environment[index], strlen(environment[index]));
    free(environment[index]);
  }
  if (spawn_status != 0) {
    close(output_pipe[0]);
    fail_closed("unable to execute pinned Railway variable retrieval");
  }

  unsigned char *payload = calloc(MAX_VARIABLE_MAP_BYTES + 1, 1);
  if (payload == NULL)
    fail_closed("unable to allocate private Railway response");
  size_t used = 0;
  while (used <= MAX_VARIABLE_MAP_BYTES) {
    ssize_t count =
        read(output_pipe[0], payload + used, MAX_VARIABLE_MAP_BYTES + 1 - used);
    if (count > 0) {
      used += (size_t)count;
      continue;
    }
    if (count == 0)
      break;
    if (errno != EINTR) {
      close(output_pipe[0]);
      secure_zero(payload, MAX_VARIABLE_MAP_BYTES + 1);
      free(payload);
      fail_closed("unable to read private Railway response");
    }
  }
  close(output_pipe[0]);
  int child_status = wait_for_child(child);
  if (used > MAX_VARIABLE_MAP_BYTES || child_status != 0) {
    secure_zero(payload, MAX_VARIABLE_MAP_BYTES + 1);
    free(payload);
    fail_closed("pinned Railway variable retrieval failed");
  }
  *length = used;
  return payload;
}

static void write_all(int descriptor, const char *value, size_t length) {
  size_t written = 0;
  while (written < length) {
    ssize_t count = write(descriptor, value + written, length - written);
    if (count > 0) {
      written += (size_t)count;
      continue;
    }
    if (count < 0 && errno == EINTR)
      continue;
    fail_closed("unable to send selected credentials to authentication child");
  }
}

static int execute_platform_auth(const char *role, bool headed) {
  verify_authentication_child();
  umask(0077);
  size_t raw_length = 0;
  unsigned char *raw = capture_railway_variable_map(&raw_length);
  struct selected_credentials selected =
      select_role_credentials(raw, raw_length, role);
  secure_zero(raw, MAX_VARIABLE_MAP_BYTES + 1);
  free(raw);

  size_t selected_length = 0;
  char *selected_json =
      serialize_selected_credentials(&selected, &selected_length);
  clear_selected_credentials(&selected);

  int input_pipe[2];
  if (pipe(input_pipe) != 0) {
    secure_zero(selected_json, selected_length);
    free(selected_json);
    fail_closed("unable to create private authentication pipe");
  }
  posix_spawn_file_actions_t actions;
  int action_status = posix_spawn_file_actions_init(&actions);
  bool actions_initialized = action_status == 0;
  if (action_status == 0)
    action_status =
        posix_spawn_file_actions_adddup2(&actions, input_pipe[0], STDIN_FILENO);
  if (action_status == 0)
    action_status =
        posix_spawn_file_actions_addclose(&actions, input_pipe[0]);
  if (action_status == 0)
    action_status =
        posix_spawn_file_actions_addclose(&actions, input_pipe[1]);
  if (action_status != 0) {
    if (actions_initialized)
      posix_spawn_file_actions_destroy(&actions);
    close(input_pipe[0]);
    close(input_pipe[1]);
    secure_zero(selected_json, selected_length);
    free(selected_json);
    fail_closed("unable to configure private authentication pipe");
  }

  char scope[64] = {0};
  snprintf(scope, sizeof(scope), "railway-platform-%s", role);
  char *environment[MAX_CHILD_ENV] = {0};
  size_t environment_count = 0;
  append_environment(environment, &environment_count, "HOME", getenv("HOME"));
  append_environment(environment, &environment_count, "TMPDIR",
                     getenv("TMPDIR"));
  append_environment(environment, &environment_count, "USER", getenv("USER"));
  append_environment(environment, &environment_count, "LOGNAME",
                     getenv("LOGNAME"));
  append_environment(environment, &environment_count, "LANG", getenv("LANG"));
  append_environment(environment, &environment_count, "LC_ALL",
                     getenv("LC_ALL"));
  append_environment(environment, &environment_count, "PATH", "/usr/bin:/bin");
  append_environment(environment, &environment_count,
                     "DIME_PLATFORM_CREDENTIAL_SOURCE", scope);
  environment[environment_count] = NULL;

  char *arguments[10] = {(char *)DIME_NODE_EXECUTABLE,
                         (char *)DIME_PRODUCTION_AUTH_SCRIPT,
                         "verify",
                         "--role",
                         (char *)role,
                         "--broker-active",
                         "--json",
                         NULL,
                         NULL,
                         NULL};
  if (headed) {
    arguments[7] = "--headed";
    arguments[8] = NULL;
  }
  pid_t child = 0;
  int spawn_status = posix_spawn(&child, DIME_NODE_EXECUTABLE, &actions, NULL,
                                 arguments, environment);
  posix_spawn_file_actions_destroy(&actions);
  close(input_pipe[0]);
  for (size_t index = 0; index < environment_count; index++)
    free(environment[index]);
  if (spawn_status != 0) {
    close(input_pipe[1]);
    secure_zero(selected_json, selected_length);
    free(selected_json);
    fail_closed("unable to execute provenance-pinned authentication child");
  }
  write_all(input_pipe[1], selected_json, selected_length);
  close(input_pipe[1]);
  secure_zero(selected_json, selected_length);
  free(selected_json);
  return wait_for_child(child);
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
  const char *allowed[] = {"TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL",
                           "LC_CTYPE", "SSH_AUTH_SOCK", "TERM", "CI"};
  const size_t allowed_count = sizeof(allowed) / sizeof(allowed[0]);
  for (size_t index = 0; index < allowed_count; index++)
    append_environment(environment, &environment_count, allowed[index],
                       getenv(allowed[index]));
  char *broker_home = resolve_broker_home();
  append_environment(environment, &environment_count, "HOME", broker_home);
  free(broker_home);
  append_environment(environment, &environment_count, "PATH", "/usr/bin:/bin");
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

  return wait_for_child(child);
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--version") == 0) {
    fputs("dime-railway-keychain 2.0.0\n", stdout);
    return 0;
  }
  if (!(argc == 2 && (strcmp(argv[1], "import") == 0 ||
                     strcmp(argv[1], "status") == 0)) &&
      !is_platform_auth_command(argc, argv) &&
      !is_allowed_read_command(argc, argv))
    fail_closed("command is outside the pinned read-only contract");
  verify_trusted_provenance();
  if (argc == 2 && strcmp(argv[1], "import") == 0) {
    import_credential();
    return 0;
  }
  if (argc == 2 && strcmp(argv[1], "status") == 0) {
    report_status();
    return 0;
  }
  if (is_platform_auth_command(argc, argv))
    return execute_platform_auth(argv[2],
                                 argc == 4 && strcmp(argv[3], "--headed") == 0);
  return execute_railway(argc, argv);
}
