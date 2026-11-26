// Static UI integration checks for index.html (zero dependencies, no network beyond
// fetching the page itself). Guards the Ko-fi support button and the modal header.
import { test, assert } from './harness.js';
import { GAME_VERSION } from '../src/config/version.js';

async function fetchIndexHtml() {
  const response = await fetch('../index.html', { cache: 'no-store' });
  assert(response.ok, `index.html fetch failed: ${response.status}`);
  return response.text();
}

test('ui: Ko-fi overlay widget is wired with the expected options', async () => {
  const html = await fetchIndexHtml();
  assert(
    html.includes('https://storage.ko-fi.com/cdn/scripts/overlay-widget.js'),
    'missing Ko-fi overlay-widget script tag'
  );
  assert(html.includes("kofiWidgetOverlay.draw('hrodic'"), 'missing kofiWidgetOverlay.draw call');
  assert(
    html.includes("'floating-chat.donateButton.text': 'Support me'"),
    'missing Ko-fi button text'
  );
  assert(
    html.includes("'floating-chat.donateButton.background-color': '#5cb85c'"),
    'missing Ko-fi button color'
  );
  assert(
    html.includes("'floating-chat.donateButton.text-color': '#fff'"),
    'missing Ko-fi text color'
  );
  assert(
    html.includes('window.kofiWidgetOverlay'),
    'Ko-fi init must be guarded so a blocked CDN never breaks the game'
  );
});

test('ui: Ko-fi init runs after the page is ready (does not block the game)', async () => {
  const html = await fetchIndexHtml();
  const scriptTag = html.match(
    /<script[^>]+src="https:\/\/storage\.ko-fi\.com\/cdn\/scripts\/overlay-widget\.js"[^>]*>/
  );
  assert(scriptTag, 'Ko-fi script tag not found');
  assert(/\bdefer\b/.test(scriptTag[0]), 'Ko-fi script should be deferred');
  assert(
    html.includes("window.addEventListener('DOMContentLoaded'"),
    'Ko-fi init should run on DOMContentLoaded'
  );
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
