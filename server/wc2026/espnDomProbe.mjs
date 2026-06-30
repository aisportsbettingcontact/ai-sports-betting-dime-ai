/**
 * ESPN DOM PROBE v2 — Maps every selector needed for the 13 required tables
 * Run: node server/wc2026/espnDomProbe.mjs
 */
import { chromium } from 'playwright';
import * as fs from 'fs';

const TARGET_URL = 'https://www.espn.com/soccer/player-stats/_/gameId/760487';
const OUT = '/home/ubuntu/ai-sports-betting/.manus-logs/espn-dom-probe.json';
const CHROMIUM_PATH = '/home/ubuntu/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';

const STEALTH_SCRIPTS = [
  `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });`,
  `window.chrome = { runtime: {} };`,
  `Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });`,
  `Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });`,
];

function cls(el) {
  // Safe className extraction — handles SVGAnimatedString and other non-string types
  const c = el.className;
  if (typeof c === 'string') return c;
  if (c && typeof c.baseVal === 'string') return c.baseVal;
  return Array.from(el.classList || []).join(' ');
}

async function probe() {
  console.log('[PROBE] Launching Chromium headless browser...');
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage', '--no-first-run', '--no-zygote',
      '--disable-gpu', '--window-size=1920,1080',
    ],
    executablePath: CHROMIUM_PATH,
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"macOS"',
    },
  });

  for (const script of STEALTH_SCRIPTS) {
    await context.addInitScript(script);
  }

  const page = await context.newPage();

  // Block images/fonts/ads to speed up load
  await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf,ico}', r => r.abort());
  await page.route('**/ads/**', r => r.abort());
  await page.route('**/analytics/**', r => r.abort());
  await page.route('**/tracking/**', r => r.abort());

  console.log(`[PROBE] Navigating to: ${TARGET_URL}`);
  const t0 = Date.now();

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log(`[PROBE] DOM loaded in ${Date.now() - t0}ms — waiting for dynamic content...`);
  await page.waitForTimeout(12000);
  console.log(`[PROBE] Total wait: ${Date.now() - t0}ms`);

  // Take screenshot for visual inspection
  const screenshotPath = '/home/ubuntu/ai-sports-betting/.manus-logs/espn-probe-screenshot.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`[PROBE] Screenshot saved: ${screenshotPath}`);

  // ── FULL DOM AUDIT ──────────────────────────────────────────────────────────
  const domAudit = await page.evaluate(() => {
    function safeClass(el) {
      const c = el.className;
      if (typeof c === 'string') return c;
      if (c && typeof c.baseVal === 'string') return c.baseVal;
      return Array.from(el.classList || []).join(' ');
    }
    function safeText(el, maxLen = 120) {
      return (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, maxLen);
    }

    const result = {};
    result.pageTitle = document.title;
    result.pageUrl = window.location.href;
    result.bodyLength = document.body?.innerHTML?.length || 0;

    // 1. All unique class names with keyword match
    const classMap = {};
    for (const el of document.querySelectorAll('*')) {
      const c = safeClass(el);
      for (const part of c.split(/\s+/)) {
        if (!part) continue;
        if (/table|boxscore|stat|player|team|shot|goal|pass|defense|attack|formation|lineup|strip|score|pitch|tab|nav|pill/i.test(part)) {
          classMap[part] = (classMap[part] || 0) + 1;
        }
      }
    }
    result.relevantClasses = classMap;

    // 2. All headings and labels
    result.headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .map(el => ({ tag: el.tagName, cls: safeClass(el).slice(0, 80), text: safeText(el, 80) }))
      .filter(h => h.text).slice(0, 60);

    // 3. All table-like structures
    result.tables = Array.from(document.querySelectorAll('table'))
      .map(el => ({
        cls: safeClass(el).slice(0, 100),
        id: el.id,
        rows: el.querySelectorAll('tr').length,
        headers: Array.from(el.querySelectorAll('th')).map(th => safeText(th, 30)).slice(0, 15),
        firstRow: Array.from(el.querySelectorAll('tr:first-child td')).map(td => safeText(td, 20)).slice(0, 10),
        text: safeText(el, 150),
      })).slice(0, 40);

    // 4. Tab navigation
    result.tabs = Array.from(document.querySelectorAll('[role="tab"], [class*="Tab__Item"], [class*="TabItem"], [class*="tab-item"], [class*="Pill"]'))
      .map(el => ({ cls: safeClass(el).slice(0, 80), text: safeText(el, 60), role: el.getAttribute('role') || '' }))
      .filter(t => t.text).slice(0, 40);

    // 5. Score / game strip
    result.scoreElements = Array.from(document.querySelectorAll('[class*="Score"], [class*="Linescore"], [class*="GameStrip"], [class*="Competitor"]'))
      .map(el => ({ cls: safeClass(el).slice(0, 80), text: safeText(el, 100) }))
      .filter(s => s.text).slice(0, 20);

    // 6. Formation / lineup elements
    result.formationElements = Array.from(document.querySelectorAll('[class*="Formation"], [class*="Lineup"], [class*="Pitch"], [class*="lineup"], [class*="formation"]'))
      .map(el => ({ cls: safeClass(el).slice(0, 80), text: safeText(el, 100) }))
      .filter(f => f.text).slice(0, 20);

    // 7. All data-* attributes
    const dataAttrs = {};
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) {
          dataAttrs[attr.name] = (dataAttrs[attr.name] || 0) + 1;
        }
      }
    }
    result.dataAttributes = dataAttrs;

    // 8. Body text (first 3000 chars)
    result.bodyText = (document.body?.innerText || '').slice(0, 3000);

    // 9. All soccer/player/stats links
    result.soccerLinks = [...new Set(
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.getAttribute('href'))
        .filter(h => h && (h.includes('soccer') || h.includes('player') || h.includes('stats') || h.includes('gameId')))
    )].slice(0, 30);

    // 10. Boxscore container structure
    result.boxscoreContainers = Array.from(document.querySelectorAll('[class*="Boxscore"], [class*="boxscore"]'))
      .map(el => ({
        cls: safeClass(el).slice(0, 100),
        childCount: el.children.length,
        text: safeText(el, 200),
        children: Array.from(el.children).slice(0, 5).map(c => ({
          tag: c.tagName, cls: safeClass(c).slice(0, 60), text: safeText(c, 60)
        }))
      })).slice(0, 15);

    // 11. All div/section with stat-related content
    result.statSections = Array.from(document.querySelectorAll('[class*="Stat"], [class*="stat"]'))
      .map(el => ({ cls: safeClass(el).slice(0, 80), text: safeText(el, 100) }))
      .filter(s => s.text).slice(0, 30);

    // 12. React/app detection
    result.hasReactRoot = !!document.querySelector('#root, #app, [data-reactroot]');
    result.hasNextData = !!document.querySelector('#__NEXT_DATA__');
    result.scriptCount = document.querySelectorAll('script').length;

    // 13. All visible text nodes that look like stat numbers
    const statPattern = /^\d+\.?\d*%?$/;
    const statTexts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent?.trim();
      if (t && statPattern.test(t) && node.parentElement) {
        const parentCls = safeClass(node.parentElement).slice(0, 60);
        if (/stat|score|value|num/i.test(parentCls)) {
          statTexts.push({ val: t, cls: parentCls });
        }
      }
    }
    result.statValues = statTexts.slice(0, 50);

    return result;
  });

  const elapsed = Date.now() - t0;
  console.log(`\n[PROBE] ═══════════════════════════════════════════════════`);
  console.log(`[PROBE] DOM AUDIT COMPLETE — ${elapsed}ms`);
  console.log(`[PROBE] Page title: "${domAudit.pageTitle}"`);
  console.log(`[PROBE] Body length: ${domAudit.bodyLength} chars`);
  console.log(`[PROBE] Relevant classes: ${Object.keys(domAudit.relevantClasses).length}`);
  console.log(`[PROBE] Tables (HTML): ${domAudit.tables.length}`);
  console.log(`[PROBE] Tabs: ${domAudit.tabs.length}`);
  console.log(`[PROBE] Boxscore containers: ${domAudit.boxscoreContainers.length}`);
  console.log(`[PROBE] Formation elements: ${domAudit.formationElements.length}`);
  console.log(`[PROBE] Stat sections: ${domAudit.statSections.length}`);

  console.log('\n[PROBE] ─── TABS ───────────────────────────────────────────');
  for (const t of domAudit.tabs) {
    console.log(`  "${t.text}" | cls=${t.cls.slice(0,50)}`);
  }

  console.log('\n[PROBE] ─── HTML TABLES ────────────────────────────────────');
  for (const t of domAudit.tables) {
    console.log(`  rows=${t.rows} headers=[${t.headers.join('|')}] cls=${t.cls.slice(0,60)}`);
  }

  console.log('\n[PROBE] ─── HEADINGS ───────────────────────────────────────');
  for (const h of domAudit.headings) {
    console.log(`  <${h.tag}> "${h.text}"`);
  }

  console.log('\n[PROBE] ─── SCORE ELEMENTS ─────────────────────────────────');
  for (const s of domAudit.scoreElements) {
    console.log(`  "${s.text}" | cls=${s.cls.slice(0,60)}`);
  }

  console.log('\n[PROBE] ─── BOXSCORE CONTAINERS ────────────────────────────');
  for (const b of domAudit.boxscoreContainers) {
    console.log(`  cls=${b.cls.slice(0,80)} children=${b.childCount}`);
    console.log(`  text="${b.text?.slice(0,100)}"`);
  }

  console.log('\n[PROBE] ─── RELEVANT CLASSES ───────────────────────────────');
  const sortedClasses = Object.entries(domAudit.relevantClasses).sort((a,b) => b[1]-a[1]).slice(0,40);
  for (const [cls, count] of sortedClasses) {
    console.log(`  .${cls} (${count}x)`);
  }

  console.log('\n[PROBE] ─── DATA ATTRIBUTES ────────────────────────────────');
  for (const [attr, count] of Object.entries(domAudit.dataAttributes).sort((a,b) => b[1]-a[1]).slice(0,20)) {
    console.log(`  ${attr} (${count}x)`);
  }

  console.log('\n[PROBE] ─── BODY TEXT SAMPLE ───────────────────────────────');
  console.log(domAudit.bodyText.slice(0, 1500));

  // Save full audit
  fs.mkdirSync('/home/ubuntu/ai-sports-betting/.manus-logs', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(domAudit, null, 2));
  console.log(`\n[PROBE] Full DOM audit saved: ${OUT}`);

  // Save full HTML
  const html = await page.content();
  const htmlPath = '/home/ubuntu/ai-sports-betting/.manus-logs/espn-page.html';
  fs.writeFileSync(htmlPath, html);
  console.log(`[PROBE] Full HTML saved: ${htmlPath} (${(html.length/1024).toFixed(0)}KB)`);

  await browser.close();
  console.log(`[PROBE] Done. Total: ${Date.now() - t0}ms`);
}

probe().catch(err => {
  console.error('[PROBE] FATAL:', err.message);
  process.exit(1);
});
