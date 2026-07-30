import { describe, expect, it } from "vitest";

import { buildMlbModelSubprocessEnvironment } from "./mlbModelRunner";

describe("MLB Python model subprocess environment", () => {
  it("passes only the closed non-secret allowlist", () => {
    const environment = buildMlbModelSubprocessEnvironment({
      LANG: "en_US.UTF-8",
      TZ: "UTC",
      TMPDIR: "/tmp/model",
      OPENBLAS_NUM_THREADS: "4",
      DATABASE_URL: "database-secret",
      RAILWAY_API_TOKEN: "railway-secret",
      RUNPOD_API_KEY: "runpod-secret",
      ANTHROPIC_API_KEY: "provider-secret",
      STRIPE_SECRET_KEY: "stripe-secret",
      DIME_PROD_OWNER_PASSWORD: "owner-secret",
      DIME_PROD_USER_PASSWORD: "user-secret",
      APP_SESSION_SECRET: "session-secret",
      PYTHONPATH: "/unreviewed/path",
      PYTHONHOME: "/unreviewed/home",
      HOME: "/unreviewed/home",
    });

    expect(environment).toEqual({
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUNBUFFERED: "1",
      PYTHONHASHSEED: "0",
      LANG: "en_US.UTF-8",
      TZ: "UTC",
      TMPDIR: "/tmp/model",
      OPENBLAS_NUM_THREADS: "4",
    });
    for (const forbidden of [
      "DATABASE_URL",
      "RAILWAY_API_TOKEN",
      "RUNPOD_API_KEY",
      "ANTHROPIC_API_KEY",
      "STRIPE_SECRET_KEY",
      "DIME_PROD_OWNER_PASSWORD",
      "DIME_PROD_USER_PASSWORD",
      "APP_SESSION_SECRET",
      "PYTHONPATH",
      "PYTHONHOME",
      "HOME",
    ]) {
      expect(Object.hasOwn(environment, forbidden)).toBe(false);
    }
  });

  it("rejects malformed inherited values", () => {
    expect(
      buildMlbModelSubprocessEnvironment({
        LANG: `en_US.UTF-8\0EXTRA`,
        OMP_NUM_THREADS: "not-a-number",
        MKL_NUM_THREADS: "1000",
      })
    ).toEqual({
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUNBUFFERED: "1",
      PYTHONHASHSEED: "0",
    });
  });
});
