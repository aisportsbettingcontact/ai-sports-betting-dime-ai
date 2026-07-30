# Dime agent secret-reference templates

These files contain 1Password **references only**, never credential values.
Copy only the scope needed into the repository root using the destination name
shown in the file and set mode `0600`. The committed reference is the exact
reviewed vault, item, section, and field contract; changing any segment requires
a manifest review and is rejected by the broker.

Each provider scope is a separate ignored environment file so RunPod identity
and each Hugging Face role never share one credential-bearing process. AWS uses
the existing `dime-builder` SSO profile by default and does not use static
access keys.

Production owner and user logins do not use these templates. Their six
credentials remain as unreferenced Railway shared variables, so the production
application process does not receive them. On demand, the device-only Keychain
broker captures the shell-free Railway child output in a private pipe and
selects the exact role inside native code; only the selected three values cross
a second private pipe into the provenance-pinned login child.
No Railway credential value is committed, written to a local reference file,
printed, or added to an agent environment.

The runtime files are ignored by `.gitignore` through `.env.*`. Do not commit
them, paste their resolved values into an agent prompt, or use a single
all-provider file.
