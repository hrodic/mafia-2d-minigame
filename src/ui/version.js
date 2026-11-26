// Applies the single GAME_VERSION to the document title and UI labels.

import { GAME_VERSION } from '../config/version.js';

export function applyVersionLabels(version = GAME_VERSION) {
  document.title = `Hrodic's Mafia 2D — ${version}`;

  const hudLabel = document.getElementById('hud-version-label');
  if (hudLabel) hudLabel.textContent = version;

  const modalLabel = document.getElementById('modal-version-label');
  if (modalLabel) modalLabel.textContent = version;
}
