(() => {
  let copy = systemCopy;
  const t = (key) => copy.t(key);

  function renderCopy() {
    document.documentElement.lang = copy.language;
    document.title = t('settings_title');
    for (const element of document.querySelectorAll('[data-message]')) {
      element.textContent = t(element.dataset.message);
    }
  }
  renderCopy();

  const form = document.querySelector('form');
  const fields = form.elements;
  const save = form.querySelector('button');
  const status = form.querySelector('[role="status"]');
  const fieldsets = form.querySelectorAll('fieldset');
  fields.unlockSeconds.min = minUnlockSeconds;
  fields.unlockSeconds.max = maxUnlockSeconds;
  const toggles = Object.keys(defaultSettings).filter((key) => typeof defaultSettings[key] === 'boolean');
  let savedSettings;

  function setBusy(busy) {
    for (const fieldset of fieldsets) fieldset.disabled = busy;
    save.disabled = busy;
  }

  function updateTimerField() {
    fields.unlockSeconds.disabled = !fields.autoRelock.checked;
  }

  fields.autoRelock.addEventListener('change', updateTimerField);
  form.addEventListener('input', () => { status.textContent = ''; });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const settings = {
      ...Object.fromEntries(toggles.map((key) => [key, fields[key].checked])),
      unlockSeconds: fields.autoRelock.checked ? fields.unlockSeconds.valueAsNumber : savedSettings.unlockSeconds,
      language: fields.language.value
    };
    const changes = Object.fromEntries(
      Object.entries(settings).filter(([key, value]) => value !== savedSettings[key])
    );
    setBusy(true);
    try {
      await chrome.storage.local.set(changes);
      Object.assign(savedSettings, changes);
      copy = await loadCopy(settings.language);
      renderCopy();
      status.textContent = t('saved');
    } catch {
      status.textContent = t('save_failed');
    } finally {
      setBusy(false);
    }
  });

  chrome.storage.local.get(defaultSettings).then(async (settings) => {
    savedSettings = settings;
    fields.language.value = ['en', 'ja'].includes(settings.language) ? settings.language : 'system';
    copy = await loadCopy(fields.language.value);
    renderCopy();
    for (const key of toggles) {
      fields[key].checked = settings[key];
    }
    if (!isValidUnlockTime(settings.unlockSeconds)) settings.unlockSeconds = defaultSettings.unlockSeconds;
    fields.unlockSeconds.value = settings.unlockSeconds;
    updateTimerField();
    setBusy(false);
  }).catch(() => { status.textContent = t('load_failed'); });
})();
