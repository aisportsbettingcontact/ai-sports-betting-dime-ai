import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { LOG_SAFE_MAX_LENGTH, logSafe } from "./logSafe";

describe("logSafe — log-injection sanitizer", () => {
  it("escapes CR/LF so a payload cannot forge a new log line", () => {
    expect(logSafe("evil\n[CRITICAL][FAKE] pwned")).toBe(
      "evil\\n[CRITICAL][FAKE] pwned"
    );
    expect(logSafe("a\r\nb")).toBe("a\\r\\nb");
    expect(logSafe("tab\tseparated")).toBe("tab\\tseparated");
  });

  it("neutralizes ANSI escape sequences (terminal smuggling)", () => {
    expect(logSafe("[31mred[0m")).toBe("?[31mred?[0m");
  });

  it("caps length and reports the truncated remainder", () => {
    const out = logSafe("x".repeat(1000));
    expect(out.length).toBeLessThan(1000);
    expect(out).toContain(`…[+${1000 - LOG_SAFE_MAX_LENGTH}]`);
  });

  it("stringifies non-strings and uses Error messages", () => {
    expect(logSafe(42)).toBe("42");
    expect(logSafe(undefined)).toBe("undefined");
    expect(logSafe(new Error("boom\nline2"))).toBe("boom\\nline2");
  });

  it("property: output never contains raw control characters", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), value => {
        const out = logSafe(value);
        // eslint-disable-next-line no-control-regex
        expect(out).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
        expect(out.length).toBeLessThanOrEqual(LOG_SAFE_MAX_LENGTH + 12);
      }),
      { numRuns: 300 }
    );
  });

  it("property: sanitization is idempotent on its own output", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), value => {
        const once = logSafe(value);
        expect(logSafe(once)).toBe(once);
      }),
      { numRuns: 200 }
    );
  });
});
