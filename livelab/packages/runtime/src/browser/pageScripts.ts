/**
 * JavaScript evaluated inside inspected pages. Kept as strings so the runtime
 * compiles without DOM typings and nothing here leaks Node capabilities into
 * the page. All scripts are read-only observers — they never mutate the
 * application, and their return values are treated as untrusted data.
 */

/** ({x, y}) => ElementInfo-shaped object (locators filled in by the runtime). */
export const INSPECT_AT = `(function(args) {
  var el = args.selector ? document.querySelector(args.selector) : document.elementFromPoint(args.x, args.y);
  if (!el) return null;
  var rect = el.getBoundingClientRect();
  var style = getComputedStyle(el);
  var attributes = {};
  for (var i = 0; i < el.attributes.length; i++) {
    var a = el.attributes[i];
    if (a.value.length <= 300) attributes[a.name] = a.value;
  }
  var text = (el.textContent || '').trim().slice(0, 300);
  var explicitRole = el.getAttribute('role') || undefined;
  var name = el.getAttribute('aria-label')
    || (el.labels && el.labels[0] && el.labels[0].textContent)
    || el.getAttribute('alt') || el.getAttribute('title') || undefined;
  var vw = window.innerWidth, vh = window.innerHeight;
  var offscreen = rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw;
  var hidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  var clipped = false;
  var p = el.parentElement;
  while (p) {
    var ps = getComputedStyle(p);
    if (/(hidden|clip|scroll|auto)/.test(ps.overflow + ps.overflowX + ps.overflowY)) {
      var pr = p.getBoundingClientRect();
      if (rect.right <= pr.left || rect.left >= pr.right || rect.bottom <= pr.top || rect.top >= pr.bottom) {
        clipped = true; break;
      }
    }
    p = p.parentElement;
  }
  var issues = [];
  if (el.id && document.querySelectorAll('[id="' + CSS.escape(el.id) + '"]').length > 1) {
    issues.push({ kind: 'duplicate-id', detail: 'id "' + el.id + '" appears multiple times' });
  }
  if (clipped) issues.push({ kind: 'clipped', detail: 'element is clipped by an overflow ancestor' });
  if (hidden) issues.push({ kind: 'hidden', detail: 'display:none / visibility:hidden / opacity:0' });
  if (offscreen) issues.push({ kind: 'offscreen', detail: 'outside the viewport' });
  var interactive = /^(a|button|input|select|textarea)$/i.test(el.tagName) || explicitRole === 'button' || explicitRole === 'link';
  if (interactive && !name && !text) {
    issues.push({ kind: 'missing-accessible-name', detail: 'clickable control has no accessible name' });
  }
  if (!hidden && !offscreen && rect.width > 0 && rect.height > 0) {
    var cx = Math.min(vw - 1, Math.max(0, rect.left + rect.width / 2));
    var cy = Math.min(vh - 1, Math.max(0, rect.top + rect.height / 2));
    var top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) {
      issues.push({ kind: 'overlapped', detail: 'covered at its center by <' + top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + '>' });
    }
  }
  var testId = el.getAttribute('data-testid') || undefined;
  var placeholder = el.getAttribute('placeholder') || undefined;
  return {
    tag: el.tagName.toLowerCase(),
    role: explicitRole,
    accessibleName: name || undefined,
    text: text || undefined,
    attributes: attributes,
    box: rect.width || rect.height ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    visible: !hidden && !offscreen && rect.width > 0 && rect.height > 0,
    zIndex: style.zIndex,
    font: style.fontSize + ' ' + style.fontFamily.split(',')[0],
    color: style.color,
    backgroundColor: style.backgroundColor,
    display: style.display,
    position: style.position,
    overflowClipped: clipped,
    offscreen: offscreen,
    issues: issues,
    _hints: { testId: testId, placeholder: placeholder, id: el.id || undefined,
      labelText: (el.labels && el.labels[0] && el.labels[0].textContent || '').trim() || undefined,
      implicitRole: (function(t, type) {
        if (t === 'a' && el.hasAttribute('href')) return 'link';
        if (t === 'button') return 'button';
        if (t === 'input') {
          if (type === 'checkbox') return 'checkbox'; if (type === 'radio') return 'radio';
          if (type === 'button' || type === 'submit') return 'button';
          return 'textbox';
        }
        if (t === 'select') return 'combobox';
        if (t === 'textarea') return 'textbox';
        if (t === 'h1' || t === 'h2' || t === 'h3') return 'heading';
        if (t === 'nav') return 'navigation';
        if (t === 'main') return 'main';
        return undefined;
      })(el.tagName.toLowerCase(), el.getAttribute('type')) }
  };
})`;

/** ({selector, maxDepth, maxNodes, includeText}) => compact DOM outline. */
export const DOM_SNAPSHOT = `(function(args) {
  var count = 0;
  function walk(node, depth) {
    if (!node || count >= args.maxNodes || depth > args.maxDepth) return null;
    if (node.nodeType !== 1) return null;
    var style = getComputedStyle(node);
    if (style.display === 'none') return { tag: node.tagName.toLowerCase(), hidden: true };
    count++;
    var out = { tag: node.tagName.toLowerCase() };
    if (node.id) out.id = node.id;
    var cls = (node.getAttribute('class') || '').trim();
    if (cls) out.class = cls.split(/\\s+/).slice(0, 4).join(' ');
    var role = node.getAttribute('role'); if (role) out.role = role;
    var testid = node.getAttribute('data-testid'); if (testid) out.testId = testid;
    if (args.includeText) {
      var ownText = '';
      for (var i = 0; i < node.childNodes.length; i++) {
        var c = node.childNodes[i];
        if (c.nodeType === 3) ownText += c.textContent;
      }
      ownText = ownText.replace(/\\s+/g, ' ').trim();
      if (ownText) out.text = ownText.slice(0, 120);
    }
    var kids = [];
    for (var j = 0; j < node.children.length && count < args.maxNodes; j++) {
      var k = walk(node.children[j], depth + 1);
      if (k) kids.push(k);
    }
    if (kids.length) out.children = kids;
    return out;
  }
  var root = document.querySelector(args.selector);
  if (!root) return { error: 'selector not found: ' + args.selector };
  return { url: location.href, title: document.title, nodeCount: count, tree: walk(root, 0) };
})`;

/** () => layout health facts used by the smoke suite. */
export const LAYOUT_FACTS = `(function() {
  var doc = document.documentElement;
  var overflowX = Math.max(0, doc.scrollWidth - window.innerWidth);
  var landmark = document.querySelector('main, [role="main"]');
  var landmarkVisible = false;
  if (landmark) {
    var r = landmark.getBoundingClientRect();
    var s = getComputedStyle(landmark);
    landmarkVisible = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  }
  var interactive = Array.prototype.slice.call(
    document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"]')
  );
  var visibleInteractive = 0, unreachable = [];
  interactive.slice(0, 200).forEach(function(el) {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    var visible = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    if (visible) {
      visibleInteractive++;
      if (r.width >= 8 && r.height >= 8 && r.top >= 0 && r.top < window.innerHeight && r.left >= 0 && r.left < window.innerWidth) {
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var top = document.elementFromPoint(cx, cy);
        if (top && top !== el && !el.contains(top) && !top.contains(el)) {
          var ts = getComputedStyle(top);
          if (ts.position === 'fixed' || ts.position === 'sticky') {
            unreachable.push('<' + el.tagName.toLowerCase() + '> "' + ((el.textContent || '').trim().slice(0, 40)) + '" covered by ' + ts.position + ' <' + top.tagName.toLowerCase() + '>');
          }
        }
      }
    }
  });
  return {
    overflowX: overflowX,
    hasLandmark: !!landmark,
    landmarkVisible: landmarkVisible,
    interactiveCount: interactive.length,
    visibleInteractive: visibleInteractive,
    coveredControls: unreachable.slice(0, 5),
    scroll: {
      x: window.scrollX, y: window.scrollY,
      maxX: Math.max(0, doc.scrollWidth - window.innerWidth),
      maxY: Math.max(0, doc.scrollHeight - window.innerHeight)
    }
  };
})`;

/** () => whether the first focusable element shows a focus indicator. */
export const FOCUS_INDICATOR_CHECK = `(function() {
  var el = document.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!el) return { checked: false, reason: 'no focusable element found' };
  var before = getComputedStyle(el);
  var beforeOutline = before.outlineStyle + '|' + before.outlineWidth + '|' + before.boxShadow + '|' + before.borderColor;
  el.focus({ preventScroll: true });
  var after = getComputedStyle(el);
  var afterOutline = after.outlineStyle + '|' + after.outlineWidth + '|' + after.boxShadow + '|' + after.borderColor;
  var hasOutline = after.outlineStyle !== 'none' && parseFloat(after.outlineWidth) > 0;
  var changed = beforeOutline !== afterOutline;
  el.blur();
  return { checked: true, hasIndicator: hasOutline || changed, tag: el.tagName.toLowerCase() };
})`;

/** ({xPercent, yPercent}) => scroll the window to a percentage of its range. */
export const SCROLL_TO_PERCENT = `(function(args) {
  var doc = document.documentElement;
  var maxX = Math.max(0, doc.scrollWidth - window.innerWidth);
  var maxY = Math.max(0, doc.scrollHeight - window.innerHeight);
  window.scrollTo({ left: maxX * args.xPercent, top: maxY * args.yPercent, behavior: 'instant' });
  return { x: window.scrollX, y: window.scrollY };
})`;

/** () => visible text digest for token-efficient agent context. */
export const VISIBLE_TEXT_DIGEST = `(function() {
  var parts = [];
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var node, budget = 4000;
  while ((node = walker.nextNode()) && budget > 0) {
    var t = (node.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!t) continue;
    var el = node.parentElement;
    if (!el) continue;
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    parts.push(t);
    budget -= t.length;
  }
  return parts.join(' | ').slice(0, 4000);
})`;
