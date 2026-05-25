import { createConnection } from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error('NO DATABASE_URL'); process.exit(1); }

const conn = await createConnection(url);

const [rows] = await conn.execute(
  `SELECT id, username, email, role, hasAccess, expiryDate,
          stripeCustomerId, stripeSubscriptionId, stripePlanId,
          discordId, discordUsername, pendingSetup, pendingEmail, pendingUsername,
          pendingStripeSessionId, createdAt
   FROM app_users
   WHERE username = 'testaccount'
   LIMIT 1`
);

if (rows.length === 0) {
  console.log('[RESULT] No user found with username=testaccount');
} else {
  console.log('[RESULT] testaccount user:');
  console.log(JSON.stringify(rows[0], null, 2));
}

await conn.end();
