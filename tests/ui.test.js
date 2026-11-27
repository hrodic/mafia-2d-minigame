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

test('ui: radar canvas is larger and square', async () => {
  const html = await fetchIndexHtml();
  const match = html.match(/id="minimapCanvas"[^>]*width="(\d+)"[^>]*height="(\d+)"/);
  assert(match, 'minimap canvas not found');
  const width = Number(match[1]);
  const height = Number(match[2]);
  assertEqual(width, height);
  assert(width >= 160, `radar should be at least 160px, got ${width}`);
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
