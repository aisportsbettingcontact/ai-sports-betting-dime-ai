async page => {
  const BASE = 'http://localhost:5273';
  const OUT = '/private/tmp/claude-501/-Users-danielwalker-Developer-ai-sports-betting-dime-ai/3538e186-6f12-4238-9763-a937461c2b10/scratchpad/chat-matrix';
  const results = { cells: [], consoleLog: [], abortedRequests: [], unmockedTrpc: [], themeMethod: null };
  let cellTag = 'setup';

  page.on('console', m => {
    const t = m.type();
    if (t === 'error' || t === 'warning') {
      const text = m.text().replace(/(key|token|secret|password|authorization)[=:]\S+/gi, '$1=[REDACTED]').slice(0, 240);
      results.consoleLog.push({ cell: cellTag, type: t, text });
    }
  });
  page.on('pageerror', e => results.consoleLog.push({ cell: cellTag, type: 'pageerror', text: String(e).slice(0, 240) }));

  await page.route('**/*', async route => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.includes('/api/trpc/')) {
      const procs = url.split('/api/trpc/')[1].split('?')[0].split(',');
      if (url.includes('appUsers.me')) {
        const user = { id: 1, username: 'verify-owner', name: 'verify-owner', role: 'owner', hasAccess: true, pendingSetup: false, discordId: null, discordUsername: null, email: 'owner@example.test', tokenVersion: 1 };
        const body = JSON.stringify(procs.map(p => ({ result: { data: { json: p.endsWith('appUsers.me') ? user : null } } })));
        return route.fulfill({ status: 200, contentType: 'application/json', body });
      }
      results.unmockedTrpc.push(method + ' ' + url.slice(0, 160));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(procs.map(() => ({ result: { data: { json: null } } }))) });
    }
    if (url.includes('/api/dime/chat')) {
      const frames = [
        { type: 'meta', dataFreshness: 'none' },
        { type: 'delta', text: 'Mock verification response. ' },
        { type: 'delta', text: 'This text was served by an intercepted in-browser fixture; no backend was contacted. ' },
        { type: 'delta', text: 'A second sentence stretches the bubble to multiple lines so wrapping, spacing, and scroll behavior can be judged.\n\nSecond paragraph for measurement.' },
        { type: 'done' },
      ];
      const body = frames.map(f => 'data: ' + JSON.stringify(f)).join('\n\n') + '\n\n';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
    }
    const sameOrigin = url.startsWith(BASE);
    if (sameOrigin || method === 'GET') return route.continue();
    results.abortedRequests.push(method + ' ' + url.slice(0, 160));
    return route.abort();
  });

  const setTheme = async want => {
    const current = await page.evaluate(() => document.querySelector('[data-theme]')?.getAttribute('data-theme') || null);
    if (current === want) return 'already-' + want;
    // try a directly visible theme control first
    const direct = page.getByRole('button', { name: /theme|dark mode|light mode|appearance/i }).first();
    if (await direct.count()) {
      await direct.click();
      const now = await page.evaluate(() => document.querySelector('[data-theme]')?.getAttribute('data-theme'));
      if (now === want) return 'direct-toggle';
    }
    // then via the Account settings menu
    const acct = page.locator('[aria-label="Account settings"]').first();
    if (await acct.count()) {
      await acct.click();
      await page.waitForTimeout(250);
      const item = page.getByRole('menuitem', { name: /theme|light|dark|appearance/i }).first();
      const btn = (await item.count()) ? item : page.getByRole('button', { name: /light|dark|theme|appearance/i }).last();
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(250);
        const now = await page.evaluate(() => document.querySelector('[data-theme]')?.getAttribute('data-theme'));
        await page.keyboard.press('Escape');
        if (now === want) return 'account-menu';
      } else {
        await page.keyboard.press('Escape');
      }
    }
    const now2 = await page.evaluate(() => document.querySelector('[data-theme]')?.getAttribute('data-theme'));
    return now2 === want ? 'ok' : 'FAILED(current=' + now2 + ')';
  };

  const collect = () => page.evaluate(() => {
    const out = {};
    const de = document.documentElement;
    out.hOverflow = { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, overflow: de.scrollWidth > window.innerWidth + 1 };
    const ta = document.querySelector('input[placeholder*="dime"]');
    if (ta) {
      const r = ta.getBoundingClientRect();
      out.composer = {
        visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 1,
        fontSize: getComputedStyle(ta).fontSize,
        rect: { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) },
        disabled: ta.disabled,
      };
    } else out.composer = { visible: false, missing: true };
    // gradients
    const grads = [];
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length && grads.length < 6; i++) {
      const cs = getComputedStyle(all[i]);
      const v = (cs.backgroundImage || '') + '|' + (cs.maskImage || '') + '|' + (cs.webkitMaskImage || '');
      if (v.includes('gradient(')) grads.push((all[i].tagName + '.' + String(all[i].className).slice(0, 50)));
    }
    out.gradients = grads;
    out.elementCount = all.length;
    // viewport gate remnants
    out.gateRemnant = /switch to (a )?desktop|desktop.only|not supported on (this )?(mobile|viewport)|screen too small/i.test(document.body.innerText) || !!document.querySelector('[class*="viewport-gate"], [class*="viewportGate"]');
    // wordmark
    out.wordmark = { dotless: document.body.innerText.includes('Dıme'), logoNode: !!document.querySelector('[class*="logo"], [class*="wordmark"]') };
    // scroll-snap pill containers
    const snaps = [];
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.scrollSnapType && cs.scrollSnapType.includes('x') && el.children.length > 1) {
        const kids = [...el.children];
        const aligns = kids.map(k => getComputedStyle(k).scrollSnapAlign);
        const truncated = kids.filter(k => k.scrollWidth > k.clientWidth + 1).length;
        const hits = kids.slice(0, 8).map(k => {
          const b = k.querySelector('button, a, [role="button"]') || k;
          const r = b.getBoundingClientRect();
          let after = 0;
          try { after = parseFloat(getComputedStyle(b, '::after').height) || 0; } catch {}
          return { w: Math.round(r.width), h: Math.round(r.height), afterH: Math.round(after) };
        });
        snaps.push({
          cls: String(el.className).slice(0, 60), kids: kids.length,
          snapType: cs.scrollSnapType, aligns: [...new Set(aligns)],
          overflowX: cs.overflowX, truncatedLabels: truncated,
          scrollable: el.scrollWidth > el.clientWidth + 1,
          padRight: cs.paddingRight, hits,
        });
      }
    }
    out.snapContainers = snaps;
    // fixed bottom navs (owner tabs) + composer overlap
    const fixedBottom = [];
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') {
        const r = el.getBoundingClientRect();
        if (r.height > 28 && r.height < 160 && Math.abs(window.innerHeight - r.bottom) < 24 && r.width > window.innerWidth * 0.5)
          fixedBottom.push({ cls: String(el.className).slice(0, 50), t: Math.round(r.top), h: Math.round(r.height) });
      }
    }
    out.fixedBottomBars = fixedBottom;
    if (ta && fixedBottom.length) {
      const taR = ta.getBoundingClientRect();
      out.composerTabOverlap = fixedBottom.some(fb => taR.bottom > fb.t + 2);
    } else out.composerTabOverlap = false;
    // drawer / sidebar state
    const sb = document.querySelector('.dc-sidebar');
    if (sb) {
      const r = sb.getBoundingClientRect();
      out.sidebar = { drawerMode: sb.classList.contains('dc-drawer'), role: sb.getAttribute('role'), hidden: sb.getAttribute('aria-hidden'), left: Math.round(r.left), w: Math.round(r.width) };
    }
    // menu control size
    const menuBtn = [...document.querySelectorAll('button')].find(b => /open navigation|menu/i.test(b.getAttribute('aria-label') || b.textContent || ''));
    if (menuBtn) {
      const r = menuBtn.getBoundingClientRect();
      const cs = getComputedStyle(menuBtn, '::after');
      out.menuControl = { w: Math.round(r.width), h: Math.round(r.height), afterH: parseFloat(cs.height) || 0, afterW: parseFloat(cs.width) || 0 };
    }
    // theme + last message
    out.theme = document.querySelector('[data-theme]')?.getAttribute('data-theme') || null;
    return out;
  });

  const cls = () => page.evaluate(() => new Promise(res => {
    let total = 0;
    try {
      const po = new PerformanceObserver(() => {});
      po.observe({ type: 'layout-shift', buffered: true });
      for (const r of po.takeRecords()) if (!r.hadRecentInput) total += r.value;
      po.disconnect();
    } catch (e) {}
    res(Math.round(total * 1000) / 1000);
  }));

  const cells = [];
  for (const theme of ['dark', 'light']) {
    for (const [w, h] of [[375, 812], [768, 1024], [1024, 768], [1440, 900]]) {
      for (const state of ['home', 'conversation']) cells.push({ theme, w, h, state });
    }
  }

  for (const c of cells) {
    cellTag = `${c.theme}-${c.w}-${c.state}`;
    const cell = { ...c, tag: cellTag };
    try {
      await page.setViewportSize({ width: c.w, height: c.h });
      await page.goto(BASE + '/chat', { waitUntil: 'networkidle' });
      await page.waitForSelector('input[placeholder*="dime"]', { timeout: 15000 });
      await page.waitForTimeout(500);
      cell.themeSwitch = await setTheme(c.theme);
      await page.waitForTimeout(300);
      if (c.state === 'conversation') {
        const ta = page.locator('input[placeholder*="dime"]').first();
        await ta.fill('Verification fixture message (intercepted locally — no backend).');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.body.innerText.includes('no backend was contacted'), null, { timeout: 10000 });
        await page.waitForTimeout(600);
      }
      cell.checks = await collect();
      cell.cls = await cls();
      const shot = `${OUT}/${cellTag.replace('conversation', 'conv')}-${c.w}x${c.h}.png`;
      await page.screenshot({ path: shot });
      cell.screenshot = shot;
      cell.renders = true;
    } catch (e) {
      cell.renders = false;
      cell.error = String(e).slice(0, 300);
      try { const shot = `${OUT}/FAIL-${cellTag}.png`; await page.screenshot({ path: shot }); cell.screenshot = shot; } catch {}
    }
    results.cells.push(cell);
  }
  cellTag = 'done';
  try {
    const fs = require('fs');
    fs.writeFileSync(OUT + '/matrix-results.json', JSON.stringify(results, null, 1));
    return 'WROTE ' + OUT + '/matrix-results.json  cells=' + results.cells.length + ' consoleEntries=' + results.consoleLog.length;
  } catch (e) {
    return JSON.stringify(results).slice(0, 6000);
  }
}
