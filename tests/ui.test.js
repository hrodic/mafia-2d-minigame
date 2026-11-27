// Static UI integration checks for index.html (zero dependencies, no network beyond
// fetching the page itself). Guards the Ko-fi support button and the modal header.
import { test, assert, assertEqual } from './harness.js';
import { GAME_VERSION } from '../src/config/version.js';

async function fetchIndexHtml() {
  const response = await fetch('../index.html', { cache: 'no-store' });
  assert(response.ok, `index.html fetch failed: ${response.status}`);
  return response.text();
}

test('ui: top bar separates brand, critical telemetry and session controls', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const left = doc.getElementById('hud-zone-left');
  const center = doc.getElementById('hud-zone-center');
  const right = doc.getElementById('hud-zone-right');

  assert(left && center && right, 'top bar must have left, center and right zones');
  assert(left.contains(doc.getElementById('btn-hud-info')), 'brand zone needs the info button');
  assert(left.contains(doc.getElementById('btn-support')), 'Tip me must stay visible in the top bar');
  assert(left.textContent.includes('Tip me'), 'Tip me must be readable, not icon-only');
  assertEqual(doc.querySelector('.hud-brand-tag'), null, 'the 2D badge is removed');
  assert(center.contains(doc.getElementById('hp-text')), 'HP belongs in the center telemetry');
  assert(center.contains(doc.getElementById('cash-text')), 'cash belongs in the center telemetry');
  assert(center.contains(doc.getElementById('hour-text')), 'hour belongs in the center telemetry');
  assert(center.contains(doc.getElementById('tick-bar-fill')), 'tick bar belongs in the center');
  assert(right.contains(doc.getElementById('btn-toggle-music')), 'music belongs in session controls');
  assert(right.contains(doc.getElementById('btn-toggle-sound')), 'SFX belongs in session controls');
  assert(right.contains(doc.getElementById('btn-reset')), 'reset belongs in session controls');

  const infoBtn = doc.getElementById('btn-hud-info');
  const popover = doc.getElementById('hud-info-popover');
  assert(infoBtn && popover, 'session info popover and trigger must exist');
  assertEqual(infoBtn.getAttribute('aria-controls'), 'hud-info-popover');
  assertEqual(infoBtn.getAttribute('aria-expanded'), 'false');
  assert(popover.classList.contains('hidden'), 'session info starts collapsed');
  assert(popover.contains(doc.getElementById('hud-version-label')), 'version belongs in the popover');
  assert(popover.contains(doc.getElementById('world-seed-hud')), 'seed belongs in the popover');
  assert(!popover.contains(doc.getElementById('btn-support')), 'Tip me stays outside the popover');

  const support = doc.getElementById('btn-support');
  assertEqual(support.getAttribute('href'), 'https://ko-fi.com/hrodic');
  assert(support.textContent.includes('Tip me'));

  assert(
    html.includes('storage.ko-fi.com/cdn/scripts/overlay-widget.js'),
    'Ko-fi popup widget script should be loaded'
  );
  assert(html.includes("kofiWidgetOverlay.draw('hrodic'"), 'Ko-fi popup init missing');

  const cssResponse = await fetch('../styles.css', { cache: 'no-store' });
  assert(cssResponse.ok, `styles.css fetch failed: ${cssResponse.status}`);
  const css = await cssResponse.text();
  assert(
    /\.floatingchat-container-wrap[\s\S]*opacity:\s*0\s*!important/.test(css),
    'Ko-fi floating launcher should be hidden'
  );
  assert(
    /\.floatingchat-container-wrap[\s\S]*pointer-events:\s*none\s*!important/.test(css),
    'Ko-fi floating launcher should not be clickable'
  );
});

test('ui: crew panel exposes switches, cap hit targets and tier accents', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const panel = doc.getElementById('management-panel');
  const body = doc.getElementById('management-body');
  const collapse = doc.getElementById('btn-management-collapse');
  assert(panel && body && collapse, 'crew panel needs a collapsible body and trigger');
  assertEqual(collapse.getAttribute('aria-controls'), 'management-body');
  assertEqual(collapse.getAttribute('aria-expanded'), 'true');

  for (const rank of ['soldier', 'captain', 'underboss']) {
    const toggle = doc.getElementById(`btn-toggle-${rank}`);
    assertEqual(toggle.getAttribute('role'), 'switch');
    assert(toggle.hasAttribute('aria-checked'), `${rank} switch needs aria-checked`);
    assert(toggle.querySelector('.mgmt-switch-knob'), `${rank} switch needs a knob`);
    const inc = doc.getElementById(`btn-cap-${rank}-inc`);
    const dec = doc.getElementById(`btn-cap-${rank}-dec`);
    const min = doc.getElementById(`btn-cap-${rank}-min`);
    const max = doc.getElementById(`btn-cap-${rank}-max`);
    assert(inc.classList.contains('mgmt-cap-btn'), `${rank} + needs a cap hit target`);
    assert(dec.classList.contains('mgmt-cap-btn'), `${rank} - needs a cap hit target`);
    assert(min.classList.contains('mgmt-cap-preset'), `${rank} MIN needs a preset button`);
    assert(max.classList.contains('mgmt-cap-preset'), `${rank} MAX needs a preset button`);
    assert(doc.getElementById(`mgmt-price-${rank}`), `${rank} price element missing`);
    assert(doc.getElementById(`mgmt-upkeep-${rank}`), `${rank} upkeep element missing`);
  }
  assertEqual(doc.querySelectorAll('.mgmt-cap-btn').length, 12);
  assertEqual(doc.querySelectorAll('.mgmt-cap-preset').length, 6);
  assertEqual(doc.querySelectorAll('.mgmt-tier-economy').length, 3);
  assert(doc.querySelector('.mgmt-tier-soldier'), 'soldier tier accent missing');
  assert(doc.querySelector('.mgmt-tier-captain'), 'captain tier accent missing');
  assert(doc.querySelector('.mgmt-tier-underboss'), 'underboss tier accent missing');

  const cssResponse = await fetch('../styles.css', { cache: 'no-store' });
  const css = await cssResponse.text();
  assert(
    /\.mgmt-cap-btn\s*\{[^}]*min-width:\s*24px/s.test(css) &&
      /\.mgmt-cap-btn\s*\{[^}]*min-height:\s*24px/s.test(css),
    'cap buttons need compact 24px hit targets'
  );
  assert(
    /\.mgmt-tier-economy\s*\{[^}]*flex-direction:\s*column/s.test(css),
    'price and upkeep must stack in one column'
  );
  assert(/\.mgmt-tier-soldier\s*\{[^}]*border-left-color:\s*#b87333/s.test(css), 'soldier copper accent missing');
  assert(/\.mgmt-tier-captain\s*\{[^}]*border-left-color:\s*#c0c0c0/s.test(css), 'captain silver accent missing');
  assert(/\.mgmt-tier-underboss\s*\{[^}]*border-left-color:\s*#d4af37/s.test(css), 'underboss gold accent missing');
});

test('ui: action dock uses bottom keybinds and transform cooldown fills', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  assertEqual(doc.querySelectorAll('#action-bar .action-key').length, 4);
  assertEqual(doc.querySelectorAll('#action-bar .action-cooldown').length, 4);

  const cssResponse = await fetch('../styles.css', { cache: 'no-store' });
  const css = await cssResponse.text();
  assert(/\.action-key\s*\{[^}]*bottom:/s.test(css), 'keybinds must sit at the bottom');
  assert(/\.action-cooldown\s*\{[^}]*transform:\s*scaleY\(var\(--progress/s.test(css), 'cooldown overlay must use --progress');
  assert(/\.action-cooldown\s*\{[^}]*transform-origin:\s*bottom/s.test(css), 'cooldown overlay must grow from the bottom');
  assert(/\.action-btn\[data-state='ready'\]/s.test(css), 'ready-state styling missing');
  assert(/\.action-btn\[data-state='affordable'\]/s.test(css), 'affordable-state styling missing');
});

test('ui: setup screen has a visible CTA, tabbed manual and live impact summary', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cta = doc.getElementById('setup-cta-bar');
  const start = doc.getElementById('btn-start-game');
  assert(cta && start, 'setup CTA bar and start button must exist');
  assert(cta.contains(start), 'start button must live in the sticky CTA bar');
  assertEqual(doc.querySelectorAll('#btn-start-game').length, 1);

  const tabs = doc.querySelectorAll('.manual-tab');
  const panels = doc.querySelectorAll('.manual-panel');
  assertEqual(tabs.length, 3);
  assertEqual(panels.length, 3);
  assertEqual(tabs[0].getAttribute('aria-selected'), 'true');
  assertEqual(tabs[0].getAttribute('role'), 'tab');
  assertEqual(doc.getElementById('manual-panel-controls').getAttribute('role'), 'tabpanel');
  assert(doc.getElementById('manual-panel-hierarchy').classList.contains('hidden'));
  assert(doc.getElementById('manual-panel-multiplayer').classList.contains('hidden'));
  assert(doc.getElementById('match-impact-summary'), 'live match impact summary missing');

  const cssResponse = await fetch('../styles.css', { cache: 'no-store' });
  const css = await cssResponse.text();
  assert(/\.setup-cta-bar\s*\{[^}]*position:\s*sticky/s.test(css), 'CTA bar must be sticky');
  assert(/\.setup-cta-bar\s*\{[^}]*top:\s*0/s.test(css), 'CTA bar must stick to the top');
  assert(/\.manual-tab\[aria-selected='true'\]/s.test(css), 'active manual tab style missing');
});

test('ui: multiplayer manual is player-facing and step based', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const panel = doc.getElementById('manual-panel-multiplayer');
  assert(panel, 'multiplayer manual panel missing');
  const text = panel.textContent;
  for (const phrase of ['Host Multiplayer', 'Create Room', 'Copy Invitation', 'Join Multiplayer', 'Connect']) {
    assert(text.includes(phrase), `multiplayer manual should mention "${phrase}"`);
  }
  assert(!/WebRTC|Trystero|P2P|host-authoritative|snapshot/i.test(text), 'manual should avoid engine jargon');
  assertEqual(panel.querySelectorAll('.manual-step').length, 3);
});

test('ui: hierarchy manual is a scannable rank table', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const panel = doc.getElementById('manual-panel-hierarchy');
  assert(panel, 'hierarchy manual panel missing');
  const table = panel.querySelector('table.manual-table');
  assert(table, 'hierarchy rank table missing');
  assertEqual(table.querySelectorAll('tbody tr').length, 4);

  const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
  for (const header of ['rank', 'hp', 'dmg', 'hire', 'upkeep', 'cap']) {
    assert(headers.includes(header), `missing "${header}" column`);
  }

  const text = table.textContent;
  for (const value of ['$3,800', '$2,200', '$1,200', '480', '340', '180', '×1', '×2', '×10']) {
    assert(text.includes(value), `rank table should show ${value}`);
  }

  const css = await (await fetch('../styles.css', { cache: 'no-store' })).text();
  assert(/\.manual-table\s*\{[^}]*border-collapse/s.test(css), 'rank table styling missing');
  assert(/\.manual-table-wrap\s*\{[^}]*overflow-x:\s*auto/s.test(css), 'rank table needs horizontal fallback');
});

test('ui: setup modal grows on large screens so the manual avoids side scroll', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const card = doc.querySelector('#setup-modal .setup-modal-card');
  assert(card, 'setup modal card needs a dedicated sizing class');
  assert(!card.className.includes('max-w-4xl'), 'fixed 4xl cap should be removed');

  const manual = doc.getElementById('manual-column');
  assert(manual, 'manual column needs an id');
  assert(manual.className.includes('lg:col-span-7'), 'manual column keeps 7/12 at lg');
  assert(manual.className.includes('xl:col-span-8'), 'manual column grows to 8/12 at xl');

  const css = await (await fetch('../styles.css', { cache: 'no-store' })).text();
  assert(
    /\.setup-modal-card\s*\{[^}]*width:\s*100%/s.test(css),
    'modal should fill the available width'
  );
  assert(
    /\.setup-modal-card\s*\{[^}]*max-width:\s*78rem/s.test(css),
    'modal max width should be raised on wide screens'
  );
});

test('ui: hierarchy tiers use the same metals as the crew panel', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('#manual-panel-hierarchy table.manual-table');
  const rows = [...table.querySelectorAll('tbody tr')];
  assertEqual(rows.length, 4);
  assert(rows[0].classList.contains('tier-diamond'), 'Supreme Leader should be diamond');
  assert(rows[1].classList.contains('tier-gold'), 'Second-in-Command should be gold');
  assert(rows[2].classList.contains('tier-silver'), 'Middle Management should be silver');
  assert(rows[3].classList.contains('tier-copper'), 'Street Enforcers should be copper');

  const css = await (await fetch('../styles.css', { cache: 'no-store' })).text();
  const metal = (name) => css.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))?.[1] || '';
  assert(metal('tier-diamond').includes('--tier-ink: #f8fafc'), 'diamond ink missing');
  assert(metal('tier-gold').includes('--tier-ink: #fcd34d'), 'gold ink missing');
  assert(metal('tier-silver').includes('--tier-ink: #e5e7eb'), 'silver ink missing');
  assert(metal('tier-copper').includes('--tier-ink: #e6b07c'), 'copper ink missing');
});

test('ui: critical HUD values are tabular and bars are transform-driven', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const id of ['hp-text', 'armor-text', 'cash-text', 'hour-text']) {
    assert(doc.getElementById(id).classList.contains('hud-num'), `${id} needs tabular numerals`);
  }
  for (const id of ['hp-bar-fill', 'armor-bar-fill', 'tick-bar-fill']) {
    const bar = doc.getElementById(id);
    assert(bar.classList.contains('hud-bar-fill'), `${id} needs the transform fill class`);
    assertEqual(bar.style.width, '', `${id} must not animate width`);
    assert(bar.style.transform.includes('scaleX'), `${id} must use scaleX`);
  }

  const cssResponse = await fetch('../styles.css', { cache: 'no-store' });
  const css = await cssResponse.text();
  assert(/\.hud-num\s*\{[^}]*tabular-nums/s.test(css), 'tabular numerals need a CSS rule');
  assert(/\.hud-bar-fill\s*\{[^}]*transform-origin:\s*left/s.test(css), 'bars must grow from the left');
  assert(/\.hud-bar-fill\s*\{[^}]*transition:\s*transform/s.test(css), 'bars must transition transform');
});

test('ui: action bar uses the position indicator, compact icons, larger keys and no Free text', async () => {
  const html = await fetchIndexHtml();
  assert(html.includes('<span class="action-icon">⌖</span>'), 'pistol should use U+2316 position indicator');
  assert(!html.includes('>Free</span>'), 'Free action-bar labels should be removed');

  const cssResponse = await fetch('../styles.css', { cache: 'no-store' });
  assert(cssResponse.ok, `styles.css fetch failed: ${cssResponse.status}`);
  const css = await cssResponse.text();
  assert(/\.action-icon\s*\{[^}]*font-size:\s*15px/s.test(css), 'action icons should be 15px');
  assert(/\.action-key\s*\{[^}]*font-size:\s*9px/s.test(css), 'action key badges should be 9px');
});

test('ui: removed build/border controls are not present', async () => {
  const html = await fetchIndexHtml();
  for (const id of ['btn-toggle-expand-click', 'btn-expand-ring', 'btn-toggle-grid']) {
    assert(!html.includes(`id="${id}"`), `${id} should be removed`);
  }
});

test('ui: radar canvas is larger, square and click-discoverable', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const canvas = doc.getElementById('minimapCanvas');
  assert(canvas, 'minimap canvas not found');
  assertEqual(canvas.width, canvas.height);
  assert(canvas.width >= 160, `radar should be at least 160px, got ${canvas.width}`);
  assert(canvas.classList.contains('cursor-crosshair'), 'radar should use a crosshair cursor');
  assert(doc.getElementById('minimap-coords').classList.contains('hud-num'), 'radar coordinates must be tabular');
});

test('ui: setup modal shows the version in place of the old edition label', async () => {
  const html = await fetchIndexHtml();
  assert(!html.includes('Criminal Empire Edition'), 'old "Criminal Empire Edition" text still present');
  const label = html.match(/id="modal-version-label"[^>]*>\s*([^<]*?)\s*</);
  assert(label, 'modal version label not found');
  assert(
    !html.includes(GAME_VERSION),
    'index.html must not hardcode GAME_VERSION; applyVersionLabels() sets it at runtime'
  );
  assert(
    !html.includes('4 SYNDICATES · 1 CITY · BETA'),
    'version should only appear once in the modal header (moved to the label)'
  );
});
