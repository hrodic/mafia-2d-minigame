// Static UI integration checks for index.html (zero dependencies, no network beyond
// fetching the page itself). Guards the Ko-fi support button and the modal header.
import { test, assert, assertEqual } from './harness.js';
import { GAME_VERSION } from '../src/config/version.js';

async function fetchIndexHtml() {
  const response = await fetch('../index.html', { cache: 'no-store' });
  assert(response.ok, `index.html fetch failed: ${response.status}`);
  return response.text();
}

test('ui: compact top-bar Tip me opens the Ko-fi popup, launcher hidden', async () => {
  const html = await fetchIndexHtml();
  const versionIndex = html.indexOf('id="hud-version-label"');
  const supportIndex = html.indexOf('id="btn-support"');
  const seedIndex = html.indexOf('id="world-seed-hud"');
  assert(
    versionIndex >= 0 && supportIndex > versionIndex && seedIndex > supportIndex,
    'support link should sit between the version label and the world seed'
  );

  const supportTagEnd = html.indexOf('>', supportIndex);
  const supportTag = html.slice(supportIndex, supportTagEnd + 1);
  assert(supportTag.includes('href="https://ko-fi.com/hrodic"'), 'Ko-fi link missing');
  assert(supportTag.includes('text-[9px]'), 'support link should be compact (9px)');
  assert(supportTag.includes('Tip me'), 'support link should say Tip me');

  assert(
    html.includes('storage.ko-fi.com/cdn/scripts/overlay-widget.js'),
    'Ko-fi popup widget script should be loaded'
  );
  assert(html.includes("kofiWidgetOverlay.draw('hrodic'"), 'Ko-fi popup init missing');
  assert(
    html.includes("'floating-chat.donateButton.text': 'Tip me'"),
    'Ko-fi launcher text should be Tip me'
  );

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
