export type NotificationPayload = {
  title: string;
  content: string;
};

/**
 * Legacy owner-notification dispatcher — GUTTED.
 *
 * This used to POST to the retired legacy platform's hosted notification
 * gateway, which is dead on Railway (that platform was decommissioned).
 *
 * It is now a logged no-op that always returns `false` (delivery failed/unavailable).
 * The exported signature is kept unchanged so the ~10 server callers (security
 * digests, cron heartbeats, CSRF alerts, etc.) keep compiling and behaving the
 * same way they already did in production (the legacy gateway was never
 * configured there, so `notifyOwner()` was already returning `false` before this).
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  console.warn(
    `[Notification] notifyOwner() is a no-op (legacy notification gateway removed) — title="${payload.title}"`
  );
  return false;
}
