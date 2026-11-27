// Static UI integration checks for index.html (zero dependencies, no network beyond
// fetching the page itself). Guards the Ko-fi support button and the modal header.
import { test, assert, assertEqual, assertDeepEqual } from './harness.js';
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

test('ui: setup screen has a visible CTA, unified manual and live impact summary', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cta = doc.getElementById('setup-cta-bar');
  const start = doc.getElementById('btn-start-game');
  assert(cta && start, 'setup CTA bar and start button must exist');
  assert(cta.contains(start), 'start button must live in the sticky CTA bar');
  assertEqual(doc.querySelectorAll('#btn-start-game').length, 1);
  assert(cta.classList.contains('hidden'), 'CTA should start hidden behind the Field Manual');

  const setupTabs = doc.querySelectorAll('.setup-tab');
  assertEqual(setupTabs.length, 4);
  assertEqual(setupTabs[0].dataset.setupTab, 'manual');
  assertEqual(setupTabs[0].getAttribute('role'), 'tab');
  assertEqual(setupTabs[0].getAttribute('aria-selected'), 'true');
  assert(!doc.getElementById('setup-panel-manual').classList.contains('hidden'));
  assert(doc.getElementById('setup-panel-play').classList.contains('hidden'));
  assert(doc.getElementById('btn-manual-play'), 'Field Manual needs a Play button');
  assertEqual(doc.getElementById('btn-manual-play').textContent.trim(), 'Play');

  assertEqual(doc.querySelectorAll('#setup-panel-manual .manual-tab').length, 0);
  assertEqual(doc.querySelectorAll('#setup-panel-manual .manual-section').length, 2);
  const guide = doc.getElementById('multiplayer-guide');
  assert(guide, 'multiplayer guide missing');
  assert(doc.getElementById('mp-join-panel').contains(guide), 'multiplayer guide belongs in the Join tab');
  assert(doc.getElementById('match-impact-summary'), 'live match impact summary missing');
  assertEqual(doc.querySelector('.match-impact-label').textContent.trim(), 'YOUR SETUP');

  const cssResponse = await fetch('../styles.css', { cache: 'no-store' });
  const css = await cssResponse.text();
  assert(/\.setup-cta-bar\s*\{[^}]*position:\s*sticky/s.test(css), 'CTA bar must be sticky');
  assert(/\.setup-cta-bar\s*\{[^}]*top:\s*0/s.test(css), 'CTA bar must stick to the top');
  assert(/\.setup-tab\[aria-selected='true'\]/s.test(css), 'active setup tab style missing');
});

test('ui: multiplayer guide is player-facing and lives in the Join tab', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const panel = doc.getElementById('multiplayer-guide');
  assert(panel, 'multiplayer guide missing');
  const text = panel.textContent;
  for (const phrase of ['Host Multiplayer', 'Create Room', 'Copy Invitation', 'Join Multiplayer', 'Connect']) {
    assert(text.includes(phrase), `multiplayer guide should mention "${phrase}"`);
  }
  assert(!/WebRTC|Trystero|P2P|host-authoritative|snapshot/i.test(text), 'guide should avoid engine jargon');
  assertEqual(panel.querySelectorAll('.manual-step').length, 3);
});

test('ui: hierarchy manual is a scannable rank table', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const panel = doc.getElementById('setup-panel-manual');
  assert(panel, 'field manual panel missing');
  const table = panel.querySelector('table.manual-rank-table');
  assert(table, 'hierarchy rank table missing');
  assert(table.textContent.includes('Don · Pakhan'), 'rank table should keep per-syndicate titles');
  assert(table.textContent.includes('Sottocapo · Avtoritet'), 'underboss titles missing');
  assert(panel.textContent.includes('Critical hits'), 'critical-hit explanation missing');
  assert(panel.textContent.includes('20%'), 'back-hit critical chance missing');
  const pistolIcon = panel.querySelector('.manual-card-amber .manual-card-icon');
  assertEqual(pistolIcon.textContent.trim(), '⌖', 'pistol card should use the crosshair icon');
  assertEqual(table.querySelectorAll('tbody tr').length, 4);

  const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
  for (const header of ['rank', 'hp', 'dmg', 'regen', 'hire', 'upkeep', 'cap']) {
    assert(headers.includes(header), `missing "${header}" column`);
  }

  const text = table.textContent;
  for (const value of ['$4,000', '$2,500', '$1,000', '800', '600', '300', '5/s', '4/s', '2/s', '1/s', '×1', '×2', '×10']) {
    assert(text.includes(value), `rank table should show ${value}`);
  }

  const css = await (await fetch('../styles.css', { cache: 'no-store' })).text();
  assert(/\.manual-table\s*\{[^}]*border-collapse/s.test(css), 'rank table styling missing');
  assert(/\.manual-table-wrap\s*\{[^}]*overflow-x:\s*auto/s.test(css), 'rank table needs horizontal fallback');
  for (const value of ['Mobility & Capture', 'Attack Timing', '1 capture point/tick', '0.8s cooldown', '1.6× for 2.0s']) {
    assert(panel.textContent.includes(value), `manual should expose ${value}`);
  }
});

test('ui: setup modal is top-aligned with a stable height', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const card = doc.querySelector('#setup-modal .setup-modal-card');
  assert(card, 'setup modal card needs a dedicated sizing class');
  assert(!card.className.includes('max-w-4xl'), 'fixed 4xl cap should be removed');
  assert(doc.getElementById('setup-modal').className.includes('items-start'), 'modal should align to the top');
  assert(doc.getElementById('setup-scroll'), 'modal needs an inner scroll region');

  const manual = doc.getElementById('setup-panel-manual');
  assert(manual, 'manual panel needs an id');
  assert(!manual.className.includes('lg:col-span-7'), 'manual should take the full panel width');
  assert(manual.querySelector('#btn-manual-play'), 'manual needs a Play button');

  const css = await (await fetch('../styles.css', { cache: 'no-store' })).text();
  assert(
    /\.setup-modal-card\s*\{[^}]*width:\s*100%/s.test(css),
    'modal should fill the available width'
  );
  assert(
    /\.setup-modal-card\s*\{[^}]*max-width:\s*78rem/s.test(css),
    'modal max width should be raised on wide screens'
  );
  assert(
    /\.setup-modal-card\s*\{[^}]*height:\s*min\(92vh,\s*62rem\)/s.test(css),
    'modal needs a stable height across tabs'
  );
});

test('ui: hierarchy tiers use the same metals as the crew panel', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('#setup-panel-manual table.manual-rank-table');
  const rows = [...table.querySelectorAll('tbody tr')];
  assertEqual(rows.length, 4);
  assert(rows[0].classList.contains('tier-diamond'), 'Boss should be diamond');
  assert(rows[1].classList.contains('tier-gold'), 'Underboss should be gold');
  assert(rows[2].classList.contains('tier-silver'), 'Captain should be silver');
  assert(rows[3].classList.contains('tier-copper'), 'Soldier should be copper');

  const css = await (await fetch('../styles.css', { cache: 'no-store' })).text();
  const metal = (name) => css.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))?.[1] || '';
  assert(metal('tier-diamond').includes('--tier-ink: #f8fafc'), 'diamond ink missing');
  assert(metal('tier-gold').includes('--tier-ink: #fcd34d'), 'gold ink missing');
  assert(metal('tier-silver').includes('--tier-ink: #e5e7eb'), 'silver ink missing');
  assert(metal('tier-copper').includes('--tier-ink: #e6b07c'), 'copper ink missing');
});

test('ui: settings cards are grouped by priority with the seed last', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const wrapper = doc.getElementById('match-settings-wrapper');
  const cards = [...wrapper.children];
  const last = cards[cards.length - 1];
  assert(last.querySelector('label[for="world-seed-input"]'), 'World Seed should be the last settings card');
  assertEqual(doc.getElementById('crew-limits-card').className.includes('xl:col-span-2'), true);
  const summary = doc.getElementById('match-impact-summary');
  assertEqual(summary.querySelector('.match-impact-label').textContent.trim(), 'YOUR SETUP');
  assert(summary.querySelector('#match-impact-text').textContent.includes('Soldiers'));
  assert(summary.querySelector('#match-impact-text').textContent.includes('Captains'));
  assert(summary.querySelector('#match-impact-text').textContent.includes('Underbosses'));

  const presets = [...summary.querySelectorAll('.match-preset')];
  assertEqual(presets.length, 3);
  assertEqual(presets[0].dataset.preset, 'turbo');
  assertEqual(presets[1].dataset.preset, 'normal');
  assertEqual(presets[2].dataset.preset, 'long');
  assertEqual(presets[1].getAttribute('aria-pressed'), 'true');
  assertEqual(doc.getElementById('tick-speed-slider').value, '15');
  assertEqual(doc.getElementById('tick-speed-display').textContent.trim(), '15s (Normal)');
  assert(doc.getElementById('income-tier-display').textContent.includes('$1,000'));
  assert(doc.querySelector('.income-tier-btn[data-income="MID"]').className.includes('bg-emerald-500/20'));
  assert(summary.querySelector('#match-impact-text').textContent.includes('15s ticks'));
});

test('ui: floating HUD panels use noir glass and pass map clicks through', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const overlay = doc.getElementById('hud-overlay');
  assert(overlay, 'hud overlay wrapper missing');
  assert(!overlay.contains(doc.getElementById('gameCanvas')), 'canvas must stay outside the HUD overlay');
  assert(overlay.querySelector('#management-panel'), 'crew panel should live in the HUD overlay');
  assert(overlay.querySelector('#action-bar'), 'action bar should live in the HUD overlay');
  assert(overlay.querySelector('#radar-panel'), 'radar should live in the HUD overlay');
  assertEqual(doc.querySelectorAll('.hud-interactive').length, 5);

  const css = await (await fetch('../styles.css', { cache: 'no-store' })).text();
  assert(
    /\.glass-panel\s*\{[^}]*background:\s*rgba\(15,\s*18,\s*24,\s*0\.82\)/s.test(css),
    'floating panels need the dark noir surface'
  );
  assert(/\.glass-panel\s*\{[^}]*backdrop-filter:\s*blur\(8px\)/s.test(css), 'floating panels need blur');
  assert(
    /\.glass-panel\s*\{[^}]*border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.12\)/s.test(css),
    'floating panels need the light hairline border'
  );
  assert(/\.hud-overlay\s*\{[^}]*pointer-events:\s*none/s.test(css), 'HUD overlay must not block the map');
  assert(/\.hud-interactive\s*\{[^}]*pointer-events:\s*auto/s.test(css), 'interactive panels must accept input');
});

test('ui: weather is normal gameplay without a Noir toggle', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  assertEqual(doc.getElementById('btn-toggle-noir'), null);
  assertEqual(doc.querySelectorAll('#hud-zone-right .hud-util-btn').length, 3);
});

test('ui: crew totals, collapsible leaderboard and expandable radar', async () => {
  const html = await fetchIndexHtml();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const board = doc.getElementById('faction-board');
  assert(board, 'faction board missing');
  assert(board.classList.contains('hud-interactive'));
  assert(board.contains(doc.getElementById('btn-faction-collapse')), 'leaderboard collapse button missing');
  assert(doc.getElementById('faction-board-body'), 'leaderboard body missing');

  const radar = doc.getElementById('radar-panel');
  assert(radar.contains(doc.getElementById('btn-radar-expand')), 'radar expand button missing');

  const totals = doc.querySelector('.mgmt-totals');
  assert(totals, 'crew totals missing');
  for (const id of ['mgmt-total-turf', 'mgmt-total-crew', 'mgmt-total-gross', 'mgmt-total-upkeep', 'mgmt-total-corruption', 'mgmt-corruption-breakdown', 'mgmt-total-net']) {
    assert(totals.querySelector(`#${id}`), `${id} missing`);
  }
  assert(totals.textContent.includes('Gross'), 'gross total label missing');
  assert(totals.textContent.includes('Corruption'), 'corruption total label missing');
  const corruption = totals.querySelector('.mgmt-total-corruption');
  const corruptionHead = corruption.querySelector('.mgmt-total-head').textContent;
  assert(corruptionHead.includes('Turf 0% · Crew 0%'), 'corruption breakdown should sit beside the title');
  assert(!corruptionHead.includes('$0 (0%)'), 'corruption money should not sit beside the title');
  assertEqual(corruption.querySelector('#mgmt-total-corruption').textContent, '$0 (0%)');
  const labels = [...totals.querySelectorAll('.mgmt-total-label')].map((el) => el.textContent.trim());
  assertDeepEqual(labels, ['Turf', 'Crew', 'Upkeep', 'Corruption', 'Gross', 'Net']);

  const css = await (await fetch('../styles.css', { cache: 'no-store' })).text();
  assert(/#radar-panel\.is-expanded canvas/s.test(css), 'expanded radar sizing missing');
  assert(!/\.mgmt-total-net\s*\{[^}]*grid-column/s.test(css), 'net total should share the last row');
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
  assert(html.includes('id="ammo-pistol"'), 'pistol should show bullets left');
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
