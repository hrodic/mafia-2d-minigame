// Ko-fi support: the top-bar link opens the official overlay popup instead of
// navigating away. The widget's floating launcher is hidden in styles.css.

function findKofiLauncher() {
  const frames = document.querySelectorAll(
    'iframe.floatingchat-container, iframe.floatingchat-container-mobi'
  );
  for (const frame of frames) {
    const doc = frame.contentDocument;
    if (!doc) continue;
    const button = doc.querySelector('.floatingchat-donate-button');
    if (button) return button;
  }
  return null;
}

export function initSupport() {
  const link = document.getElementById('btn-support');
  if (!link) return;

  link.addEventListener('click', (event) => {
    const launcher = findKofiLauncher();
    if (!launcher) return; // Fall back to the normal Ko-fi link.
    event.preventDefault();
    launcher.click();
  });
}
