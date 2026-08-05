-- Rollback for 0133_account_lockout.sql
-- Expand-only migration (3 additive columns on app_users). Reverting is safe:
-- the columns are written only by the login/reset paths and read only by the
-- per-account lockout check — no other code depends on them, and dropping them
-- loses only in-flight failed-attempt counters (not user data).
-- Only run this if the account-lockout code is NOT deployed (or the kill-switch
-- ACCOUNT_LOCKOUT_DISABLED=1 is set), so nothing tries to write these columns.
ALTER TABLE `app_users` DROP COLUMN `lockedUntil`;--> statement-breakpoint
ALTER TABLE `app_users` DROP COLUMN `firstFailedLoginAt`;--> statement-breakpoint
ALTER TABLE `app_users` DROP COLUMN `failedLoginCount`;
