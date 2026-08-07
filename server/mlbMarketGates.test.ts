import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The loader is the only DB-touching part; mock getDb so these run offline.
const selectMock = vi.fn();
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => selectMock(),
        }),
      }),
    }),
  }),
}));

import {
  MLB_MARKET_KEYS,
  allPublished,
  anyMarketGated,
  getMlbMarketGateHealth,
  getMlbMarketGateSnapshot,
  mlbMarketGateMode,
  paramNameFor,
  parsePublished,
  __resetMlbMarketGatesForTest,
} from "./mlbMarketGates";

const ORIGINAL = process.env.MLB_MARKET_GATE_MODE;

beforeEach(() => {
  __resetMlbMarketGatesForTest();
  selectMock.mockReset();
  delete process.env.MLB_MARKET_GATE_MODE;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MLB_MARKET_GATE_MODE;
  else process.env.MLB_MARKET_GATE_MODE = ORIGINAL;
});

describe("parsePublished — fail-open contract", () => {
  // REGRESSION: the natural-looking shape
  //   Number.isFinite(Number(raw)) ? Number(raw) >= 0.5 : true
  // inverts this contract, because Number(null) === 0 and Number("") === 0 are
  // both finite and both below the threshold — so unreadable input would GATE
  // the market instead of publishing it. These cases pin the correct direction.
  it("publishes on null", () => expect(parsePublished(null)).toBe(true));
  it("publishes on undefined", () =>
    expect(parsePublished(undefined)).toBe(true));
  it("publishes on empty string", () => expect(parsePublished("")).toBe(true));
  it("publishes on whitespace", () => expect(parsePublished("   ")).toBe(true));
  it("publishes on non-numeric text", () =>
    expect(parsePublished("BACKTEST-ONLY")).toBe(true));
  it("publishes on NaN", () => expect(parsePublished(Number.NaN)).toBe(true));
  it("publishes on Infinity", () =>
    expect(parsePublished(Infinity)).toBe(true));

  it("gates on the decimal zero drizzle actually returns", () => {
    expect(parsePublished("0.00000000")).toBe(false);
  });
  it("publishes on the decimal one drizzle actually returns", () => {
    expect(parsePublished("1.00000000")).toBe(true);
  });
  it("gates on numeric 0 and publishes on numeric 1", () => {
    expect(parsePublished(0)).toBe(false);
    expect(parsePublished(1)).toBe(true);
  });
  it("uses a 0.5 threshold, not !== 0", () => {
    expect(parsePublished("0.0000001")).toBe(false);
    expect(parsePublished("0.4999")).toBe(false);
    expect(parsePublished("0.5")).toBe(true);
  });
});

describe("mlbMarketGateMode", () => {
  it("defaults to off when unset", () =>
    expect(mlbMarketGateMode()).toBe("off"));
  it("treats an unknown value as off", () => {
    process.env.MLB_MARKET_GATE_MODE = "enabled";
    expect(mlbMarketGateMode()).toBe("off");
  });
  it("accepts on/log case- and whitespace-insensitively", () => {
    process.env.MLB_MARKET_GATE_MODE = " ON ";
    expect(mlbMarketGateMode()).toBe("on");
    process.env.MLB_MARKET_GATE_MODE = "Log";
    expect(mlbMarketGateMode()).toBe("log");
  });
});

describe("paramName contract", () => {
  it("matches the nine paramNames the audit wrote", () => {
    expect(MLB_MARKET_KEYS.map(paramNameFor)).toEqual([
      "publish_fg_ml",
      "publish_fg_rl",
      "publish_fg_total",
      "publish_f5_ml",
      "publish_f5_rl",
      "publish_f5_total",
      "publish_nrfi_yrfi",
      "publish_k_props",
      "publish_hr_props",
    ]);
  });
});

describe("anyMarketGated", () => {
  it("is false for the identity snapshot", () => {
    expect(anyMarketGated(allPublished())).toBe(false);
  });
  it("is true when a single market is gated", () => {
    expect(anyMarketGated({ ...allPublished(), fg_ml: false })).toBe(true);
  });
});

describe("getMlbMarketGateSnapshot", () => {
  it("mode=off returns all-published WITHOUT touching the database", async () => {
    const gates = await getMlbMarketGateSnapshot();
    expect(gates).toEqual(allPublished());
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("gates only the markets whose rows say 0, leaving absent rows published", async () => {
    process.env.MLB_MARKET_GATE_MODE = "on";
    selectMock.mockResolvedValue([
      { paramName: "publish_fg_ml", currentValue: "0.00000000" },
      { paramName: "publish_hr_props", currentValue: "0.00000000" },
      { paramName: "publish_fg_total", currentValue: "1.00000000" },
    ]);
    const gates = await getMlbMarketGateSnapshot();
    expect(gates.fg_ml).toBe(false);
    expect(gates.hr_props).toBe(false);
    expect(gates.fg_total).toBe(true);
    // never written → fail open
    expect(gates.f5_rl).toBe(true);
    expect(gates.k_props).toBe(true);
    expect(getMlbMarketGateHealth().missingParams).toContain("publish_f5_rl");
  });

  it("ignores unknown paramNames", async () => {
    process.env.MLB_MARKET_GATE_MODE = "on";
    selectMock.mockResolvedValue([
      { paramName: "publish_not_a_market", currentValue: "0.00000000" },
    ]);
    expect(await getMlbMarketGateSnapshot()).toEqual(allPublished());
  });

  it("caches within the TTL — a burst issues one query", async () => {
    process.env.MLB_MARKET_GATE_MODE = "on";
    selectMock.mockResolvedValue([]);
    await Promise.all([
      getMlbMarketGateSnapshot(),
      getMlbMarketGateSnapshot(),
      getMlbMarketGateSnapshot(),
    ]);
    await getMlbMarketGateSnapshot();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN when the read throws and nothing has ever loaded", async () => {
    process.env.MLB_MARKET_GATE_MODE = "on";
    selectMock.mockRejectedValue(new Error("TiDB unavailable"));
    expect(await getMlbMarketGateSnapshot()).toEqual(allPublished());
    expect(getMlbMarketGateHealth().source).toBe("fail-open");
  });

  it("serves the last good snapshot when a later read fails", async () => {
    process.env.MLB_MARKET_GATE_MODE = "on";
    selectMock.mockResolvedValue([
      { paramName: "publish_fg_ml", currentValue: "0.00000000" },
    ]);
    const first = await getMlbMarketGateSnapshot();
    expect(first.fg_ml).toBe(false);

    // Expire the TTL, then break the DB.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    selectMock.mockRejectedValue(new Error("TiDB unavailable"));
    const second = await getMlbMarketGateSnapshot();
    vi.useRealTimers();

    // Stale-but-correct beats reverting to all-published: an outage must never
    // silently un-gate a market the owner deliberately gated.
    expect(second.fg_ml).toBe(false);
    expect(getMlbMarketGateHealth().source).toBe("stale");
  });

  it("never rejects, whatever the database does", async () => {
    process.env.MLB_MARKET_GATE_MODE = "on";
    selectMock.mockRejectedValue(new Error("boom"));
    await expect(getMlbMarketGateSnapshot()).resolves.toBeDefined();
  });
});
