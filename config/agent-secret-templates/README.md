# Dime agent secret-reference templates

These files contain 1Password **references only**, never credential values.
Copy only the scope needed into the repository root using the destination name
shown in the file, replace the `op://<vault>/<item>/...` references, and set
mode `0600`.

Each provider scope is a separate ignored environment file so RunPod identity
and each Hugging Face role never share one credential-bearing process. AWS uses
the existing `dime-builder` SSO profile by default and does not use static
access keys.

Production owner and user logins do not use these templates. Their six
credentials remain as unreferenced Railway shared variables, so the production
application process does not receive them. On demand, the device-only Keychain
broker and a shell-free Railway child stream directly into an ephemeral role
filter, and only the selected three values reach the explicit login harness.
No Railway credential value is committed, written to a local reference file,
printed, or added to an agent environment.

The runtime files are ignored by `.gitignore` through `.env.*`. Do not commit
them, paste their resolved values into an agent prompt, or use a single
all-provider file.
