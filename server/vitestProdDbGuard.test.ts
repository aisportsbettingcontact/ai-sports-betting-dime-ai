/**
 * Guards the guard: vitest.globalSetup.ts is what stops `pnpm vitest run` from
 * writing to a production database. If its host classification silently breaks,
 * the protection disappears without any visible signal.
 */
import { describe, it, expect } from "vitest";
import { assessDatabaseUrl } from "../vitest.globalSetup";

describe("production-database test guard", () => {
  it("[LOCAL] allows loopback and container service hosts", () => {
    for (const dsn of [
      "mysql://root@127.0.0.1:3306/dime_test",
      "mysql://root@localhost:3306/dime_test",
      "mysql://root@mysql:3306/dime_test",
      "mysql://root@host.docker.internal:3306/dime_test",
    ]) {
      expect(assessDatabaseUrl(dsn).allowed, dsn).toBe(true);
    }
  });

  it("[PROD] refuses the real TiDB Cloud production host", () => {
    const v = assessDatabaseUrl("mysql://u:p@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/db");
    expect(v.allowed).toBe(false);
    expect(v.host).toBe("gateway01.us-east-1.prod.aws.tidbcloud.com");
  });

  it("[PROD] refuses other managed providers", () => {
    for (const dsn of [
      "mysql://u:p@x.rds.amazonaws.com:3306/db",
      "mysql://u:p@svc.up.railway.app:3306/db",
      "mysql://u:p@db.prod.internal:3306/db",
    ]) {
      expect(assessDatabaseUrl(dsn).allowed, dsn).toBe(false);
    }
  });

  it("[UNSET] allows an absent DATABASE_URL — suites skip or fail closed on their own", () => {
    expect(assessDatabaseUrl(undefined).allowed).toBe(true);
    expect(assessDatabaseUrl("").allowed).toBe(true);
  });

  it("[FAIL-CLOSED] refuses an unknown remote host rather than assuming it is safe", () => {
    expect(assessDatabaseUrl("mysql://u:p@db.somewhere.example:3306/db").allowed).toBe(false);
  });

  it("[FAIL-CLOSED] refuses an unparseable DSN instead of guessing", () => {
    expect(assessDatabaseUrl("not-a-url").allowed).toBe(false);
  });
});
