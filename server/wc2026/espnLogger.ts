/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║                       ESPN SCRAPER — ELITE LOGGER                          ║
 * ║                                                                              ║
 * ║  Dual-channel structured forensic logger.                                   ║
 * ║  Channel A → Terminal  (colorized, human-readable, noise-free)              ║
 * ║  Channel B → Log file  (machine-parseable JSON-lines + plain text mirror)   ║
 * ║                                                                              ║
 * ║  Log levels (ordered by severity):                                          ║
 * ║    INPUT   → raw inputs received by any function                            ║
 * ║    STEP    → named execution stage entered                                  ║
 * ║    STATE   → intermediate computed value / decision point                   ║
 * ║    HTTP    → every outbound HTTP request + response metadata                ║
 * ║    RETRY   → retry attempt with delay + reason                              ║
 * ║    PARSE   → data transformation / field extraction                         ║
 * ║    OUTPUT  → final result produced by a function                            ║
 * ║    VERIFY  → validation gate — PASS / WARN / FAIL                          ║
 * ║    ERROR   → non-fatal error with full context                              ║
 * ║    FATAL   → scrape-aborting error                                          ║
 * ║                                                                              ║
 * ║  Log file: .manus-logs/espn-scraper.log   (plain text, append-only)        ║
 * ║  Stats file: .manus-logs/espn-scraper-stats.json  (per-run summary)        ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import * as fs from "fs";
import * as path from "path";

// ─── ANSI COLOR PALETTE ───────────────────────────────────────────────────────

const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  // Foreground
  white:   "\x1b[97m",
  gray:    "\x1b[90m",
  cyan:    "\x1b[96m",
  blue:    "\x1b[94m",
  green:   "\x1b[92m",
  yellow:  "\x1b[93m",
  orange:  "\x1b[33m",
  red:     "\x1b[91m",
  magenta: "\x1b[95m",
  // Background accents
  bgRed:   "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgBlue:  "\x1b[44m",
} as const;

// ─── LEVEL CONFIG ─────────────────────────────────────────────────────────────

type LogLevel =
  | "INPUT"
  | "STEP"
  | "STATE"
  | "HTTP"
  | "RETRY"
  | "PARSE"
  | "OUTPUT"
  | "VERIFY"
  | "WARN"
  | "ERROR"
  | "FATAL";

interface LevelConfig {
  color: string;
  badge: string;
  icon: string;
  priority: number;
}

const LEVEL_CONFIG: Record<LogLevel, LevelConfig> = {
  INPUT:  { color: C.cyan,    badge: "INPUT ", icon: "→", priority: 0 },
  STEP:   { color: C.blue,    badge: "STEP  ", icon: "▶", priority: 1 },
  STATE:  { color: C.gray,    badge: "STATE ", icon: "·", priority: 2 },
  HTTP:   { color: C.magenta, badge: "HTTP  ", icon: "⇄", priority: 3 },
  RETRY:  { color: C.orange,  badge: "RETRY ", icon: "↻", priority: 4 },
  PARSE:  { color: C.cyan,    badge: "PARSE ", icon: "⚙", priority: 5 },
  OUTPUT: { color: C.green,   badge: "OUTPUT", icon: "✓", priority: 6 },
  VERIFY: { color: C.green,   badge: "VERIFY", icon: "✔", priority: 7 },
  WARN:   { color: C.yellow,  badge: "WARN  ", icon: "⚠", priority: 8 },
  ERROR:  { color: C.red,     badge: "ERROR ", icon: "✗", priority: 9 },
  FATAL:  { color: C.bgRed + C.white, badge: "FATAL ", icon: "☠", priority: 9 },
};

// ─── LOG ENTRY TYPES ──────────────────────────────────────────────────────────

export interface LogEntry {
  ts: string;           // ISO-8601 timestamp
  level: LogLevel;
  runId: string;        // UUID for the current scrape run
  gameId: string;       // ESPN gameId being scraped
  phase: string;        // Current execution phase label
  msg: string;          // Human-readable message
  data?: Record<string, unknown>; // Structured key-value payload
  durationMs?: number;  // Elapsed time for timed operations
  attempt?: number;     // Retry attempt number (1-indexed)
  url?: string;         // URL for HTTP log entries
  statusCode?: number;  // HTTP status code
  bytes?: number;       // Response size in bytes
  error?: string;       // Error message / stack
}

export interface RunStats {
  runId: string;
  gameId: string;
  startedAt: string;
  completedAt: string | null;
  totalDurationMs: number | null;
  apiCallCount: number;
  retryCount: number;
  errorCount: number;
  fatalCount: number;
  verifyPassCount: number;
  verifyWarnCount: number;
  verifyFailCount: number;
  playersScraped: number;
  bytesTransferred: number;
  phases: string[];
  outcome: "SUCCESS" | "PARTIAL" | "FAILED" | "IN_PROGRESS";
}

// ─── LOGGER CLASS ─────────────────────────────────────────────────────────────

export class EspnLogger {
  private readonly runId: string;
  private readonly gameId: string;
  private readonly logFile: string;
  private readonly statsFile: string;
  private readonly startTime: number;
  private currentPhase: string = "INIT";

  // Counters
  private apiCallCount = 0;
  private retryCount = 0;
  private errorCount = 0;
  private fatalCount = 0;
  private verifyPassCount = 0;
  private verifyWarnCount = 0;
  private verifyFailCount = 0;
  private playersScraped = 0;
  private bytesTransferred = 0;
  private phases: string[] = [];

  // Phase timers
  private phaseStartTimes: Map<string, number> = new Map();

  constructor(gameId: string, logDir: string = ".manus-logs") {
    this.gameId = gameId;
    this.runId = this.generateRunId();
    this.startTime = Date.now();

    // Ensure log directory exists
    const absLogDir = path.isAbsolute(logDir)
      ? logDir
      : path.join(process.cwd(), logDir);

    try {
      fs.mkdirSync(absLogDir, { recursive: true });
    } catch {
      // non-fatal
    }

    this.logFile = path.join(absLogDir, "espn-scraper.log");
    this.statsFile = path.join(absLogDir, "espn-scraper-stats.json");

    // Write session header to log file
    this.writeFileHeader();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  input(msg: string, data?: Record<string, unknown>): void {
    this.emit("INPUT", msg, data);
  }

  step(phase: string, msg?: string, data?: Record<string, unknown>): void {
    if (phase !== this.currentPhase) {
      this.enterPhase(phase);
    }
    this.emit("STEP", msg ?? phase, data);
  }

  state(msg: string, data?: Record<string, unknown>): void {
    this.emit("STATE", msg, data);
  }

  http(
    direction: "REQ" | "RES",
    url: string,
    opts: {
      attempt?: number;
      statusCode?: number;
      bytes?: number;
      durationMs?: number;
      userAgent?: string;
      error?: string;
    } = {}
  ): void {
    const msg =
      direction === "REQ"
        ? `→ ${this.truncUrl(url)}`
        : `← ${this.truncUrl(url)} [${opts.statusCode ?? "?"}] ${opts.bytes != null ? this.fmtBytes(opts.bytes) : ""} ${opts.durationMs != null ? `${opts.durationMs}ms` : ""}`;

    const entry: Partial<LogEntry> = {
      url,
      statusCode: opts.statusCode,
      bytes: opts.bytes,
      durationMs: opts.durationMs,
      attempt: opts.attempt,
    };
    if (opts.userAgent) {
      (entry as Record<string, unknown>).userAgent = opts.userAgent.slice(0, 60);
    }
    if (opts.error) {
      entry.error = opts.error;
    }

    if (direction === "REQ") {
      this.apiCallCount++;
    } else if (opts.bytes) {
      this.bytesTransferred += opts.bytes;
    }

    this.emit("HTTP", msg, entry as Record<string, unknown>);
  }

  retry(
    url: string,
    attempt: number,
    maxAttempts: number,
    delayMs: number,
    reason: string
  ): void {
    this.retryCount++;
    this.emit(
      "RETRY",
      `Attempt ${attempt}/${maxAttempts} — waiting ${delayMs}ms | ${reason}`,
      { url: this.truncUrl(url), attempt, maxAttempts, delayMs, reason }
    );
  }

  parse(msg: string, data?: Record<string, unknown>): void {
    this.emit("PARSE", msg, data);
  }

  output(msg: string, data?: Record<string, unknown>, durationMs?: number): void {
    this.emit("OUTPUT", msg, data, durationMs);
  }

  verify(
    verdict: "PASS" | "WARN" | "FAIL",
    label: string,
    data?: Record<string, unknown>
  ): void {
    if (verdict === "PASS") this.verifyPassCount++;
    else if (verdict === "WARN") this.verifyWarnCount++;
    else this.verifyFailCount++;

    const verdictColor =
      verdict === "PASS"
        ? C.green
        : verdict === "WARN"
        ? C.yellow
        : C.red;

    const msg = `${verdictColor}${verdict}${C.reset} — ${label}`;
    this.emit("VERIFY", msg, data);
  }

  warn(label: string, msg: string, data?: Record<string, unknown>): void {
    this.emit("WARN", `${label} — ${msg}`, data);
  }

  error(msg: string, err?: unknown, data?: Record<string, unknown>): void {
    this.errorCount++;
    const errStr =
      err instanceof Error
        ? `${err.message}${err.stack ? `\n${err.stack.split("\n").slice(1, 4).join("\n")}` : ""}`
        : err != null
        ? String(err)
        : undefined;
    this.emit("ERROR", msg, { ...data, ...(errStr ? { error: errStr } : {}) });
  }

  fatal(msg: string, err?: unknown, data?: Record<string, unknown>): void {
    this.fatalCount++;
    const errStr =
      err instanceof Error
        ? `${err.message}${err.stack ? `\n${err.stack.split("\n").slice(1, 6).join("\n")}` : ""}`
        : err != null
        ? String(err)
        : undefined;
    this.emit("FATAL", msg, { ...data, ...(errStr ? { error: errStr } : {}) });
  }

  // ── Phase management ───────────────────────────────────────────────────────

  enterPhase(phase: string): void {
    // Close previous phase
    if (this.currentPhase && this.currentPhase !== "INIT") {
      const phaseStart = this.phaseStartTimes.get(this.currentPhase);
      if (phaseStart) {
        const elapsed = Date.now() - phaseStart;
        this.writeRaw(
          this.formatTerminal(
            "STEP",
            `◀ END PHASE [${this.currentPhase}] — ${elapsed}ms`,
            {}
          )
        );
      }
    }

    this.currentPhase = phase;
    this.phaseStartTimes.set(phase, Date.now());
    if (!this.phases.includes(phase)) this.phases.push(phase);

    // Phase banner
    const banner = `${"─".repeat(72)}`;
    const phaseLabel = `  PHASE: ${phase}`;
    this.writeRaw(
      `${C.bold}${C.blue}${banner}${C.reset}\n` +
      `${C.bold}${C.blue}${phaseLabel}${C.reset}\n` +
      `${C.bold}${C.blue}${banner}${C.reset}\n`
    );
    this.writeFile(`\n${"─".repeat(72)}\nPHASE: ${phase}\n${"─".repeat(72)}\n`);
  }

  // ── Player tracking ────────────────────────────────────────────────────────

  playerScraped(
    name: string,
    teamAbbr: string,
    pos: string,
    statCount: number,
    index: number,
    total: number
  ): void {
    this.playersScraped++;
    const pct = Math.round((index / total) * 100);
    const bar = this.progressBar(pct, 20);
    this.emit("STATE", `[${bar}] ${pct}% | #${index}/${total} ${teamAbbr} ${name} (${pos}) — ${statCount} stats`, {
      player: name,
      team: teamAbbr,
      pos,
      statCount,
      index,
      total,
    });
  }

  // ── Run summary ────────────────────────────────────────────────────────────

  summary(outcome: RunStats["outcome"], extraData?: Record<string, unknown>): RunStats {
    const totalDurationMs = Date.now() - this.startTime;
    const stats: RunStats = {
      runId: this.runId,
      gameId: this.gameId,
      startedAt: new Date(this.startTime).toISOString(),
      completedAt: new Date().toISOString(),
      totalDurationMs,
      apiCallCount: this.apiCallCount,
      retryCount: this.retryCount,
      errorCount: this.errorCount,
      fatalCount: this.fatalCount,
      verifyPassCount: this.verifyPassCount,
      verifyWarnCount: this.verifyWarnCount,
      verifyFailCount: this.verifyFailCount,
      playersScraped: this.playersScraped,
      bytesTransferred: this.bytesTransferred,
      phases: this.phases,
      outcome,
    };

    // Write stats JSON
    try {
      let existing: RunStats[] = [];
      if (fs.existsSync(this.statsFile)) {
        try {
          existing = JSON.parse(fs.readFileSync(this.statsFile, "utf-8"));
          if (!Array.isArray(existing)) existing = [];
        } catch {
          existing = [];
        }
      }
      existing.unshift(stats); // newest first
      if (existing.length > 100) existing = existing.slice(0, 100); // keep last 100 runs
      fs.writeFileSync(this.statsFile, JSON.stringify(existing, null, 2));
    } catch {
      // non-fatal
    }

    // Print summary banner
    const outcomeColor =
      outcome === "SUCCESS"
        ? C.green
        : outcome === "PARTIAL"
        ? C.yellow
        : C.red;

    const summaryLines = [
      ``,
      `${C.bold}${"═".repeat(72)}${C.reset}`,
      `${C.bold}  ESPN SCRAPER RUN COMPLETE — ${outcomeColor}${outcome}${C.reset}`,
      `${C.bold}${"═".repeat(72)}${C.reset}`,
      `  ${C.bold}Run ID       ${C.reset}${this.runId}`,
      `  ${C.bold}Game ID      ${C.reset}${this.gameId}`,
      `  ${C.bold}Duration     ${C.reset}${this.fmtDuration(totalDurationMs)}`,
      `  ${C.bold}API Calls    ${C.reset}${this.apiCallCount}`,
      `  ${C.bold}Retries      ${C.reset}${this.retryCount > 0 ? C.yellow + this.retryCount + C.reset : "0"}`,
      `  ${C.bold}Errors       ${C.reset}${this.errorCount > 0 ? C.red + this.errorCount + C.reset : C.green + "0" + C.reset}`,
      `  ${C.bold}Fatals       ${C.reset}${this.fatalCount > 0 ? C.bgRed + C.white + this.fatalCount + C.reset : C.green + "0" + C.reset}`,
      `  ${C.bold}Verify PASS  ${C.reset}${C.green}${this.verifyPassCount}${C.reset}`,
      `  ${C.bold}Verify WARN  ${C.reset}${this.verifyWarnCount > 0 ? C.yellow + this.verifyWarnCount + C.reset : "0"}`,
      `  ${C.bold}Verify FAIL  ${C.reset}${this.verifyFailCount > 0 ? C.red + this.verifyFailCount + C.reset : C.green + "0" + C.reset}`,
      `  ${C.bold}Players      ${C.reset}${this.playersScraped}`,
      `  ${C.bold}Transferred  ${C.reset}${this.fmtBytes(this.bytesTransferred)}`,
      `  ${C.bold}Phases       ${C.reset}${this.phases.join(" → ")}`,
      ...(extraData
        ? Object.entries(extraData).map(
            ([k, v]) => `  ${C.bold}${k.padEnd(12)} ${C.reset}${String(v)}`
          )
        : []),
      `${C.bold}${"═".repeat(72)}${C.reset}`,
      ``,
    ];

    this.writeRaw(summaryLines.join("\n"));

    // Plain-text mirror to log file
    const plainSummary = [
      ``,
      `${"═".repeat(72)}`,
      `ESPN SCRAPER RUN COMPLETE — ${outcome}`,
      `${"═".repeat(72)}`,
      `Run ID:        ${this.runId}`,
      `Game ID:       ${this.gameId}`,
      `Duration:      ${this.fmtDuration(totalDurationMs)}`,
      `API Calls:     ${this.apiCallCount}`,
      `Retries:       ${this.retryCount}`,
      `Errors:        ${this.errorCount}`,
      `Fatals:        ${this.fatalCount}`,
      `Verify PASS:   ${this.verifyPassCount}`,
      `Verify WARN:   ${this.verifyWarnCount}`,
      `Verify FAIL:   ${this.verifyFailCount}`,
      `Players:       ${this.playersScraped}`,
      `Transferred:   ${this.fmtBytes(this.bytesTransferred)}`,
      `Phases:        ${this.phases.join(" → ")}`,
      `${"═".repeat(72)}`,
      ``,
    ].join("\n");

    this.writeFile(plainSummary);

    return stats;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private emit(
    level: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
    durationMs?: number
  ): void {
    const ts = new Date().toISOString();
    const entry: LogEntry = {
      ts,
      level,
      runId: this.runId,
      gameId: this.gameId,
      phase: this.currentPhase,
      msg,
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
      ...(durationMs != null ? { durationMs } : {}),
    };

    // Terminal output (colorized)
    this.writeRaw(this.formatTerminal(level, msg, data, durationMs));

    // File output (plain text)
    this.writeFile(this.formatFile(entry));
  }

  private formatTerminal(
    level: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
    durationMs?: number
  ): string {
    const cfg = LEVEL_CONFIG[level as LogLevel] ?? LEVEL_CONFIG.STATE;
    const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
    const tsStr = `${C.dim}${ts}${C.reset}`;
    const badgeStr = `${cfg.color}${C.bold}[${cfg.badge}]${C.reset}`;
    const iconStr = `${cfg.color}${cfg.icon}${C.reset}`;
    const phaseStr = `${C.dim}[${this.currentPhase}]${C.reset}`;
    const durStr =
      durationMs != null
        ? ` ${C.dim}(${this.fmtDuration(durationMs)})${C.reset}`
        : "";

    // Strip ANSI from msg for length calculation, keep original for output
    let line = `${tsStr} ${badgeStr} ${phaseStr} ${iconStr} ${msg}${durStr}`;

    // Append structured data as compact inline key=value pairs
    if (data && Object.keys(data).length > 0) {
      const kvPairs = Object.entries(data)
        .filter(([, v]) => v != null && v !== "" && v !== false)
        .map(([k, v]) => {
          const valStr =
            typeof v === "object"
              ? JSON.stringify(v).slice(0, 120)
              : String(v).slice(0, 120);
          return `${C.dim}${k}${C.reset}=${C.cyan}${valStr}${C.reset}`;
        })
        .join("  ");
      if (kvPairs) {
        line += `\n${"  ".repeat(4)}${kvPairs}`;
      }
    }

    return line + "\n";
  }

  private formatFile(entry: LogEntry): string {
    const ts = entry.ts;
    const level = entry.level.padEnd(6);
    const phase = entry.phase.padEnd(20);
    const msg = entry.msg.replace(/\x1b\[[0-9;]*m/g, ""); // strip ANSI

    let line = `[${ts}] [${level}] [${phase}] ${msg}`;

    if (entry.durationMs != null) {
      line += ` (${this.fmtDuration(entry.durationMs)})`;
    }

    const extras: string[] = [];
    if (entry.url) extras.push(`url=${entry.url}`);
    if (entry.statusCode != null) extras.push(`status=${entry.statusCode}`);
    if (entry.bytes != null) extras.push(`bytes=${entry.bytes}`);
    if (entry.attempt != null) extras.push(`attempt=${entry.attempt}`);
    if (entry.error) extras.push(`error=${entry.error.split("\n")[0]}`);

    if (entry.data) {
      for (const [k, v] of Object.entries(entry.data)) {
        if (v != null && v !== "" && v !== false && k !== "error") {
          const valStr =
            typeof v === "object"
              ? JSON.stringify(v).slice(0, 200)
              : String(v).slice(0, 200);
          extras.push(`${k}=${valStr}`);
        }
      }
    }

    if (extras.length > 0) {
      line += `  |  ${extras.join("  |  ")}`;
    }

    return line + "\n";
  }

  private writeRaw(text: string): void {
    process.stdout.write(text);
  }

  private writeFile(text: string): void {
    try {
      fs.appendFileSync(this.logFile, text);
    } catch {
      // non-fatal: never crash the scraper due to logging failure
    }
  }

  private writeFileHeader(): void {
    const header = [
      ``,
      `${"═".repeat(80)}`,
      `ESPN SCRAPER LOG — Run ID: ${this.runId}`,
      `Game ID: ${this.gameId}`,
      `Started: ${new Date(this.startTime).toISOString()}`,
      `Process: PID ${process.pid}`,
      `Node: ${process.version}`,
      `${"═".repeat(80)}`,
      ``,
    ].join("\n");

    this.writeFile(header);

    // Also print session header to terminal
    this.writeRaw(
      `\n${C.bold}${C.blue}${"═".repeat(72)}${C.reset}\n` +
      `${C.bold}${C.blue}  ESPN SCRAPER — RUN ${this.runId}${C.reset}\n` +
      `${C.bold}${C.blue}  Game: ${this.gameId}  |  Started: ${new Date(this.startTime).toISOString()}${C.reset}\n` +
      `${C.bold}${C.blue}${"═".repeat(72)}${C.reset}\n\n`
    );
  }

  private generateRunId(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `ESPN-${ts}-${rand}`;
  }

  private truncUrl(url: string): string {
    if (url.length <= 100) return url;
    const u = new URL(url);
    return `${u.hostname}${u.pathname.slice(0, 60)}…`;
  }

  private fmtBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  }

  private fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(1);
    return `${m}m${s}s`;
  }

  private progressBar(pct: number, width: number): string {
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    return `${C.green}${"█".repeat(filled)}${C.dim}${"░".repeat(empty)}${C.reset}`;
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  getRunId(): string { return this.runId; }
  getGameId(): string { return this.gameId; }
  getLogFile(): string { return this.logFile; }
  getStatsFile(): string { return this.statsFile; }
  getApiCallCount(): number { return this.apiCallCount; }
  getErrorCount(): number { return this.errorCount; }
  getRetryCount(): number { return this.retryCount; }
  getBytesTransferred(): number { return this.bytesTransferred; }
  getPlayersScraped(): number { return this.playersScraped; }
  incrementPlayersScraped(): void { this.playersScraped++; }
}

// ─── SINGLETON FACTORY ────────────────────────────────────────────────────────
// One logger per scrape run. Pass it through the call stack explicitly.

export function createEspnLogger(gameId: string): EspnLogger {
  return new EspnLogger(gameId);
}
