const enabledControl = document.querySelector('#enabled');
const statusMessage = document.querySelector('#status');
let copy = systemCopy;

function renderCopy() {
  document.documentElement.lang = copy.language;
  document.title = copy.t('extension_short_name');
  for (const element of document.querySelectorAll('[data-message]')) {
    element.textContent = copy.t(element.dataset.message);
  }
}

renderCopy();

async function initialize() {
  try {
    const { enabled, language } = await chrome.storage.local.get(defaultSettings);
    copy = await loadCopy(language);
    renderCopy();
    enabledControl.checked = enabled !== false;
    enabledControl.disabled = false;
  } catch {
    statusMessage.textContent = copy.t('load_failed');
  }
}

enabledControl.addEventListener('change', async () => {
  const enabled = enabledControl.checked;
  enabledControl.disabled = true;
  statusMessage.textContent = '';
  try {
    await chrome.storage.local.set({ enabled });
  } catch {
    enabledControl.checked = !enabled;
    statusMessage.textContent = copy.t('save_failed');
  } finally {
    enabledControl.disabled = false;
  }
});

document.querySelector('#details').addEventListener('click', async () => {
  try {
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch {
    statusMessage.textContent = copy.t('load_failed');
  }
});

initialize();
