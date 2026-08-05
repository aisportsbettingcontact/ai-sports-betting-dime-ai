import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import path from "path";

const ENGINE_PATH = path.resolve(__dirname, "model_v9_engine.py");

describe("KenPom credentials validation", () => {
  it("should successfully authenticate with KENPOM_EMAIL and KENPOM_PASSWORD", () => {
    // Skip gracefully in CI/test environments where secrets are not injected
    const email = process.env.KENPOM_EMAIL ?? "";
    const pass = process.env.KENPOM_PASSWORD ?? "";
    if (email.length <= 5 || pass.length <= 5) {
      console.warn(
        "[KenPom] Credentials not available in test environment — skipping live auth check"
      );
      return;
    }
    // Run a minimal engine call — just login check (empty team name will fail after login)
    const result = spawnSync("/usr/bin/python3.11", [ENGINE_PATH], {
      input: JSON.stringify({
        away_team: "__credential_test__",
        home_team: "__credential_test__",
        conf_a: "ACC",
        conf_h: "ACC",
        mkt_sp: 0,
        mkt_to: 140,
        mkt_ml_a: null,
        mkt_ml_h: null,
        kenpom_email: email,
        kenpom_pass: pass,
      }),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        HOME: process.env.HOME ?? "/home/ubuntu",
        PATH: "/usr/local/bin:/usr/bin:/bin",
        PYTHONPATH:
          "/usr/local/lib/python3.11/dist-packages:/usr/lib/python3/dist-packages",
        KENPOM_EMAIL: email,
        KENPOM_PASSWORD: pass,
      },
    });

    // Parse the last JSON line from stdout
    const lines = (result.stdout ?? "").trim().split("\n");
    const lastLine = lines[lines.length - 1];
    let parsed: any = null;
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      /* ignore */
    }

    // If credentials are wrong, the error will contain 'credentials'
    // If credentials are right but team is invalid, error will be about the team
    const errorMsg = (parsed?.error ?? result.stderr ?? "").toLowerCase();
    const credentialFailed =
      errorMsg.includes("check your credentials") ||
      errorMsg.includes("logging in failed");

    expect(credentialFailed).toBe(false);
  }, 35_000);
});
