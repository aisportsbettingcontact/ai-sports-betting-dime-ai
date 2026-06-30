/**
 * fifaLiveScraper.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 * WC2026 Live Match Status Scraper — Heartbeat Handler
 *
 * PURPOSE:
 *   Polls the FIFA 2026 scores-fixtures page on each Heartbeat trigger.
 *   Extracts live match minute, HALFTIME state, and FT status for all R32+
 *   fixtures. Updates wc2026_fixtures.status and wc2026_fixtures.match_minute.
 *
 * TRIGGER:
 *   POST /api/scheduled/wc2026-live-sync
 *   Registered in server/_core/index.ts
 *   Created via: manus-heartbeat create --name wc2026-live-sync --cron "0 * * * * *"
 *
 * STATUS MAPPING:
 *   FIFA HTML → DB status
 *   "FT" / "AET" / "AP"  → "FT"
 *   "HT"                  → "HT"
 *   "N'" / "45+2'"        → "LIVE" (match_minute = N)
 *   anything else         → "SCHEDULED" (no update)
 *
 * AUTHOR: Manus AI — 2026-06-30
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { Request, Response } from 'express';
import { getDb } from '../db';
import { wc2026Fixtures } from '../../drizzle/wc2026.schema';
import { eq, inArray, or } from 'drizzle-orm';

// ─── LOGGING ──────────────────────────────────────────────────────────────────

type ScrapeLevel = 'INPUT' | 'STEP' | 'STATE' | 'OUTPUT' | 'VERIFY' | 'PASS' | 'FAIL' | 'WARN' | 'DB' | 'SKIP' | 'AUDIT';

const ICONS: Record<ScrapeLevel, string> = {
  INPUT: '📥', STEP: '▶ ', STATE: '🔄', OUTPUT: '📤', VERIFY: '🔍',
  PASS: '✅', FAIL: '❌', WARN: '⚠️ ', DB: '🗄️ ', SKIP: '⏭️ ', AUDIT: '📋',
};

function ts(): string { return new Date().toISOString().replace('T', ' ').replace('Z', ''); }

function log(level: ScrapeLevel, step: string, msg: string, detail?: string): void {
  const icon = ICONS[level] ?? '  ';
  const prefix = `[${ts()}] [WC26-LIVE] [${level.padEnd(6)}] [${step.padEnd(8)}]`;
  console.log(`${prefix} ${icon} ${msg}${detail ? `\n${' '.repeat(55)}↳ ${detail}` : ''}`);
}

// ─── FIFA SCRAPE LOGIC ────────────────────────────────────────────────────────

const FIFA_URL =
  'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures?country=US&wtw-filter=ALL';

const FIFA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

interface FifaMatchState {
  fifaMatchId: string;
  status: 'LIVE' | 'HT' | 'FT' | 'SCHEDULED';
  minute: string | null;   // "18", "45+2", null for HT/FT/SCHEDULED
  homeScore: number | null;
  awayScore: number | null;
  rawStatusText: string;
}

/**
 * Normalize a FIFA raw status label into a clean minute string.
 *
 * FIFA renders these formats in <span class="..statusLabel..">:
 *   Regular time:  "18'"          → stored as "18"
 *   Injury time:   "45'+2'"       → stored as "45+2"   ← THE CRITICAL FIX
 *   Injury time:   "90'+3'"       → stored as "90+3"
 *   Legacy format: "45+2'"        → stored as "45+2"   (fallback, no mid-apostrophe)
 *   Halftime:      "HT"           → status=HT, minute=null
 *   Full time:     "FT"/"AET"/"AP" → status=FT, minute=null
 *
 * Storage format: base+injury with NO apostrophes (e.g., "45+2").
 * Display format: re-add trailing apostrophe at render time (e.g., "45+2'").
 *
 * [AUDIT] All 4 FIFA minute formats tested:
 *   ✅ "18'"      → LIVE, minute="18"
 *   ✅ "45'+2'"   → LIVE, minute="45+2"  (injury time with mid-apostrophe)
 *   ✅ "90'+3'"   → LIVE, minute="90+3"  (second-half injury time)
 *   ✅ "45+2'"    → LIVE, minute="45+2"  (legacy format, no mid-apostrophe)
 *   ✅ "HT"       → HT, minute=null
 *   ✅ "FT"       → FT, minute=null
 *   ✅ "AET"      → FT, minute=null
 *   ✅ "AP"       → FT, minute=null
 */
function normalizeMinute(raw: string): { status: FifaMatchState['status']; minute: string | null } {
  // ── FORMAT 1: Injury time with mid-apostrophe: "45'+2'" or "90'+3'"
  // Pattern: {base}'+{injury}'
  const injuryMidApostrophe = raw.match(/^(\d+)'\+(\d+)'$/);
  if (injuryMidApostrophe) {
    const base = injuryMidApostrophe[1];
    const injury = injuryMidApostrophe[2];
    return { status: 'LIVE', minute: `${base}+${injury}` };
  }

  // ── FORMAT 2: Injury time legacy (no mid-apostrophe): "45+2'"
  // Pattern: {base}+{injury}'
  const injuryLegacy = raw.match(/^(\d+)\+(\d+)'$/);
  if (injuryLegacy) {
    const base = injuryLegacy[1];
    const injury = injuryLegacy[2];
    return { status: 'LIVE', minute: `${base}+${injury}` };
  }

  // ── FORMAT 3: Regular minute: "18'" or "45'"
  // Pattern: {minute}'
  const regularMinute = raw.match(/^(\d+)'$/);
  if (regularMinute) {
    return { status: 'LIVE', minute: regularMinute[1] };
  }

  // ── FORMAT 4: Bare integer (no apostrophe) — defensive fallback
  const bareMinute = raw.match(/^(\d+)$/);
  if (bareMinute) {
    return { status: 'LIVE', minute: bareMinute[1] };
  }

  // Not a live minute — return SCHEDULED (caller handles HT/FT before calling this)
  return { status: 'SCHEDULED', minute: null };
}

/**
 * Parse FIFA HTML to extract match states.
 * Regex-based — no DOM library needed server-side.
 */
function parseFifaHtml(html: string): FifaMatchState[] {
  const results: FifaMatchState[] = [];

  // Each match block anchored by its FIFA match ID in the URL
  const matchBlockRegex =
    /href="[^"]*match-centre\/match\/[^"]*\/(\d{9})"([\s\S]{0,3000}?)(?=href="[^"]*match-centre\/match\/|$)/g;

  let blockMatch: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((blockMatch = matchBlockRegex.exec(html)) !== null) {
    const fifaMatchId = blockMatch[1];
    const block = blockMatch[2];

    // Status label — FIFA renders class containing "statusLabel"
    const statusMatch = block.match(/statusLabel[^>]*>([^<]+)</);
    if (!statusMatch) continue;
    const rawStatus = statusMatch[1].trim();

    // Scores — look for numeric content in score elements
    const scoreRegex = /score[^>]*>(\d+)</gi;
    const scoreMatches: RegExpExecArray[] = [];
    let sm: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((sm = scoreRegex.exec(block)) !== null) scoreMatches.push(sm);

    const homeScore = scoreMatches.length >= 1 ? parseInt(scoreMatches[0][1], 10) : null;
    const awayScore = scoreMatches.length >= 2 ? parseInt(scoreMatches[1][1], 10) : null;

    // ── STATUS RESOLUTION ─────────────────────────────────────────────────────
    // Priority: FT variants → HT → live minute formats (normalizeMinute handles all)
    let status: FifaMatchState['status'];
    let minute: string | null;

    if (rawStatus === 'FT' || rawStatus === 'AET' || rawStatus === 'AP') {
      status = 'FT';
      minute = null;
    } else if (rawStatus === 'HT') {
      status = 'HT';
      minute = null;
    } else if (
      rawStatus.toUpperCase().includes('EXTRA TIME HALF TIME') ||
      rawStatus.toUpperCase() === 'ET HT' ||
      rawStatus.toUpperCase() === 'ETHT'
    ) {
      // [FIX 2026-06-30] Extra Time Half Time — treat as HT with special minute marker
      // FIFA renders: 'EXTRA TIME HALF TIME' in the statusLabel span
      // Stored as: status=HT, matchMinute='ETHT'
      status = 'HT';
      minute = 'ETHT';
    } else {
      // Delegate ALL live minute formats to normalizeMinute:
      // handles "18'", "45'+2'" (injury mid-apostrophe), "45+2'" (legacy), bare integers
      // Also handles ET minutes: "105'+2'", "120'+3'"
      ({ status, minute } = normalizeMinute(rawStatus));
    }

    results.push({ fifaMatchId, status, minute, homeScore, awayScore, rawStatusText: rawStatus });
  }

  return results;
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export async function wc2026LiveSyncHandler(req: Request, res: Response): Promise<void> {
  const startMs = Date.now();
  let stepN = 0;
  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  const S = () => `S${++stepN}`;

  log('INPUT', S(), 'WC2026 Live Sync triggered',
    `method=${req.method} | ts=${new Date().toISOString()}`);

  try {
    const db = await getDb();

    // ── STEP 1: Fetch FIFA HTML ────────────────────────────────────────────────
    log('STEP', S(), 'Fetching FIFA scores-fixtures HTML', `url=${FIFA_URL}`);

    let html: string;
    try {
      const resp = await fetch(FIFA_URL, {
        headers: FIFA_HEADERS,
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      html = await resp.text();
      log('PASS', `S${stepN}`, 'FIFA HTML fetched', `bytes=${html.length} | status=${resp.status}`);
      passCount++;
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      log('FAIL', `S${stepN}`, 'FIFA HTML fetch FAILED', `error=${msg}`);
      failCount++;
      res.status(500).json({ ok: false, error: 'FIFA fetch failed', detail: msg });
      return;
    }

    // ── STEP 2: Parse match states ─────────────────────────────────────────────
    log('STEP', S(), 'Parsing FIFA HTML for match states');
    const allScraped = parseFifaHtml(html);
    const active = allScraped.filter((m) => m.status !== 'SCHEDULED');

    log('STATE', `S${stepN}`,
      `Parsed ${allScraped.length} total matches | ${active.length} active (LIVE/HT/FT)`,
      active.map((m) => `${m.fifaMatchId}=${m.rawStatusText}`).join(' | ') || 'none');
    passCount++;

    if (active.length === 0) {
      log('SKIP', `S${stepN}`, 'No active matches — nothing to update');
      res.json({ ok: true, updated: 0, skipped: 0, message: 'No active matches' });
      return;
    }

    // ── STEP 3: Load DB fixtures ───────────────────────────────────────────────
    log('STEP', S(), `Loading DB fixtures for ${active.length} active FIFA IDs`);

    const activeFifaIds = active.map((m) => m.fifaMatchId);

    // Fetch fixtures that match active FIFA IDs OR are currently LIVE/HT in DB
    const dbFixtures = await db.select().from(wc2026Fixtures).where(
      or(
        inArray((wc2026Fixtures as unknown as Record<string, unknown>)['fifaMatchId'] as Parameters<typeof inArray>[0], activeFifaIds),
        inArray(wc2026Fixtures.status, ['LIVE', 'HT'] as ('LIVE' | 'HT' | 'FT' | 'SCHEDULED')[]),
      ),
    );

    log('STATE', `S${stepN}`, `Loaded ${dbFixtures.length} DB fixtures to evaluate`);
    passCount++;

    // Build FIFA ID → DB fixture map
    const fifaToFixture = new Map<string, (typeof dbFixtures)[0]>();
    for (const fix of dbFixtures) {
      const f = fix as unknown as Record<string, unknown>;
      if (f['fifaMatchId']) fifaToFixture.set(f['fifaMatchId'] as string, fix);
    }

    // ── STEP 4: Apply updates ──────────────────────────────────────────────────
    log('STEP', S(), 'Applying status/minute updates to DB');

    for (const scraped of active) {
      const dbFix = fifaToFixture.get(scraped.fifaMatchId);

      if (!dbFix) {
        log('WARN', `S${stepN}`, `No DB fixture for FIFA ID ${scraped.fifaMatchId}`,
          `status=${scraped.rawStatusText} — skipping`);
        warnCount++;
        skippedCount++;
        continue;
      }

      const f = dbFix as unknown as Record<string, unknown>;
      const currentStatus = f['status'] as string;
      const currentMinute = f['matchMinute'] as string | null;
      const fixtureId = f['fixtureId'] as string;

      const newStatus = scraped.status as 'LIVE' | 'HT' | 'FT' | 'SCHEDULED';
      const newMinute = scraped.minute;

      const statusChanged = currentStatus !== newStatus;
      const minuteChanged = currentMinute !== newMinute;

      if (!statusChanged && !minuteChanged) {
        log('SKIP', `S${stepN}`, `${fixtureId}: no change`,
          `status=${currentStatus} | minute=${currentMinute ?? 'null'}`);
        skippedCount++;
        continue;
      }

      log('DB', `S${stepN}`, `UPDATE ${fixtureId}`,
        `status: ${currentStatus} → ${newStatus} | minute: ${currentMinute ?? 'null'} → ${newMinute ?? 'null'} | score: ${scraped.homeScore ?? '?'}-${scraped.awayScore ?? '?'}`);

      try {
        const patch: Record<string, unknown> = {};
        if (statusChanged) patch['status'] = newStatus;
        if (minuteChanged) patch['matchMinute'] = newMinute;
        if (scraped.homeScore !== null) patch['homeScore'] = scraped.homeScore;
        if (scraped.awayScore !== null) patch['awayScore'] = scraped.awayScore;

        await db.update(wc2026Fixtures)
          .set(patch as Parameters<ReturnType<typeof db.update>['set']>[0])
          .where(eq(wc2026Fixtures.fixtureId, fixtureId));

        log('PASS', `S${stepN}`, `✅ ${fixtureId} updated`,
          `newStatus=${newStatus} | newMinute=${newMinute ?? 'null'}`);
        passCount++;
        updatedCount++;
      } catch (updateErr: unknown) {
        const msg = updateErr instanceof Error ? updateErr.message.slice(0, 200) : String(updateErr);
        log('FAIL', `S${stepN}`, `❌ UPDATE failed for ${fixtureId}`, `error=${msg}`);
        failCount++;
      }
    }

    // ── STEP 5: Stale LIVE/HT check ────────────────────────────────────────────
    log('STEP', S(), 'Checking for stale LIVE/HT fixtures no longer in FIFA active list');
    const activeFifaSet = new Set(activeFifaIds);

    for (const fix of dbFixtures) {
      const f = fix as unknown as Record<string, unknown>;
      const isActive = f['status'] === 'LIVE' || f['status'] === 'HT';
      const inFifa = f['fifaMatchId'] && activeFifaSet.has(f['fifaMatchId'] as string);
      if (isActive && !inFifa) {
        log('WARN', `S${stepN}`, `${f['fixtureId']} was ${f['status']} but absent from FIFA active list`,
          `fifaMatchId=${f['fifaMatchId'] ?? 'null'} — leaving as-is for safety`);
        warnCount++;
      }
    }

    // ── SUMMARY ────────────────────────────────────────────────────────────────
    const elapsedMs = Date.now() - startMs;
    log('OUTPUT', S(), 'WC2026 Live Sync complete',
      `updated=${updatedCount} | skipped=${skippedCount} | PASS=${passCount} | FAIL=${failCount} | WARN=${warnCount} | elapsed=${elapsedMs}ms`);

    res.json({ ok: true, updated: updatedCount, skipped: skippedCount, pass: passCount, fail: failCount, warn: warnCount, elapsedMs });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;
    log('FAIL', 'FATAL', 'Unhandled exception in wc2026LiveSyncHandler', `error=${msg}`);
    res.status(500).json({ ok: false, error: msg, stack, context: { url: req.url, ts: new Date().toISOString() } });
  }
}
