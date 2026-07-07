# Session B REDO — Raw Evidence Log

**Date:** 2026-07-07  
**Purpose:** Raw command outputs backing SESSION-B-REDO-REPORT.md

---

## §7: stripe_events phantom

```
$ grep -rn "stripe_events\|stripeEvents" drizzle/*.ts
(zero results — exit code 1)
```

## §7: Table count

```
$ grep -c "mysqlTable" drizzle/*.ts | awk -F: '{sum+=$2} END {print sum}'
67
```

## §11: Dead /#pricing links

```
$ grep -rn "/#pricing" client/src/pages/landing/
client/src/pages/landing/components/ComparisonSection.tsx:106:  href="/#pricing"
client/src/pages/landing/components/PremiumValueAnchor.tsx:23:  <a href="/#pricing" ...>
client/src/pages/landing/components/ProductMechanism.tsx:84:  href="/#pricing"
```

```
$ grep -n 'id="pricing"\|id=.pricing.' client/src/pages/landing/LandingPage.tsx
49:{/* Waitlist capture — replaces PricingCTA + PremiumValueAnchor during pre-launch */}
(no id="pricing" element)
```

```
$ grep -n "id=" client/src/pages/landing/components/WaitlistCapture.tsx
237:      id="waitlist"
(id is "waitlist", NOT "pricing")
```

## SEC-003: 90d JWT

```
$ grep -n "setExpirationTime\|sessionDays" server/routers/appUsers.ts
80:    .setExpirationTime("90d")
430:      const sessionDays = input.stayLoggedIn ? 90 : 1;
436:          maxAge: sessionDays * 24 * 60 * 60 * 1000,
```

## DB-003: DIME FK

```
$ grep -n "references\|foreignKey" drizzle/dime.schema.ts
(exit code 1 — zero results)
```

## DB-005: worldCupRound enum

```
$ grep -n "worldCupRound" drizzle/wc2026.schema.ts
549:    worldCupRound: mysqlEnum("world_cup_round", ["group", "r32", "quarterfinals", "semifinals", "third_place", "finals"]),
```

## DB-006: Waitlist rate limit

```
$ grep -rn "rateLimit\|rateLimiter\|express-rate-limit" server/routers/waitlist.ts
(zero results)

$ grep -n "globalApiLimiter" server/_core/index.ts
124:const globalApiLimiter = rateLimit({  // 200 req/min/IP
325:  app.use("/api", globalApiLimiter);
```

Comment on waitlist.ts line 8 says "rate-limited by IP at router level" but no dedicated limiter exists.

## PROD-002: termsAccepted

```
$ grep -rn "termsAccepted" server/routers/ | grep -v ".test."
server/routers/appUsers.ts:545:      termsAccepted: user.termsAccepted,
server/routers/appUsers.ts:561:      termsAccepted: true,
server/routers/appUsers.ts:562:      termsAcceptedAt: Date.now(),
server/routers/appUsers.ts:587:      termsAccepted: u.termsAccepted,
server/routers/appUsers.ts:588:      termsAcceptedAt: u.termsAcceptedAt,
```

No middleware checks termsAccepted before allowing access.

## PROD-003: Cookie consent

```
$ grep -rn "cookie.consent\|cookieConsent\|cookie-consent\|CookieBanner\|cookie.banner" client/src/
(zero results)
```

## PROD-004: GDPR

```
$ grep -rn "deleteAccount\|exportMyData\|gdpr\|GDPR\|data.export\|data.deletion" server/
(zero results)
```

## FE-001: Admin ownerProcedure

```
$ grep -c "ownerProcedure" server/routers/*.ts | grep -v ":0"
server/routers/appUsers.ts:19
server/routers/metrics.ts:4
server/routers/mlbSchedule.ts:13
server/routers/nbaSchedule.ts:3
server/routers/nhlSchedule.ts:5
server/routers/security.ts:7
server/routers/waitlist.ts:8
```

Client uses RequireAuth only (no role check). Server enforces ownerProcedure on all admin mutations.

## DEAD-001/003: Unused components

```
$ grep -rn "DashboardLayout" client/src/ | grep -v "DashboardLayout.tsx" | grep -v "DashboardLayoutSkeleton.tsx"
(zero results)

$ grep -rn "AIChatBox" client/src/ | grep -v "AIChatBox.tsx"
(zero results)
```

## §12: Compliance claims

```
$ grep -rn "No picks\|no picks" client/src/pages/landing/
ComparisonSection.tsx:11:  { feature: "No picks, no lock-of-the-day hype", us: true, them: false },
Hero.tsx:139:          No picks. No lock-of-the-day hype. Just the data.
PainSection.tsx:13:  "No picks — just the raw model output..."

$ grep -rn "responsib\|gamble\|gambling" client/src/pages/landing/
EdgeExplanation.tsx:146: ...Bet responsibly.
FAQ.tsx:28: ...sports betting laws vary...
LandingFooter.tsx:17: ...does not provide...gambling advice...Bet responsibly...
TrustBoundary.tsx:126: ...Bet responsibly.

$ grep -rc "aria-" client/src/pages/landing/ | awk -F: '{sum+=$2} END {print sum}'
37

$ grep -rn "TrustBoundary\|trust" client/src/pages/landing/
LandingPage.tsx:12: const TrustBoundary = lazy(...)
LandingPage.tsx:51: <LazySection id="trust"><TrustBoundary /></LazySection>
Hero.tsx:56: {/* Eyebrow trust line */}
TrustBoundary.tsx:47: export default function TrustBoundary()
```

No Norton Seal, BBB, SOC2, or any third-party trust badge found.
