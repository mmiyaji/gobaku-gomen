const defaultSettings = Object.freeze({
  enabled: true,
  twitchEnabled: true,
  youtubeEnabled: true,
  niconicoEnabled: true,
  twitcastingEnabled: true,
  kickEnabled: true,
  confirmUnlock: true,
  confirmPaste: true,
  relockOnLeave: true,
  guardEnter: false,
  autoRelock: true,
  unlockSeconds: 30,
  language: 'system'
});

const minUnlockSeconds = 5;
const maxUnlockSeconds = 600;

function isValidUnlockTime(seconds) {
  return Number.isInteger(seconds) && seconds >= minUnlockSeconds && seconds <= maxUnlockSeconds;
}

const systemLanguage = /^ja(?:-|$)/i.test(chrome.i18n.getUILanguage()) ? 'ja' : 'en';
const systemCopy = {
  language: systemLanguage,
  t: (key, ...values) => chrome.i18n.getMessage(key, values)
};

function resolveLanguage(preference) {
  return preference === 'en' || preference === 'ja' ? preference : systemLanguage;
}

async function loadCopy(preference) {
  const language = resolveLanguage(preference);
  if (language === systemLanguage) return systemCopy;

  try {
    const messages = await chrome.runtime.sendMessage({ type: 'getLocaleMessages', language });
    if (messages) {
      return {
        language,
        t(key, ...values) {
          const entry = messages[key];
          if (!entry) return systemCopy.t(key, ...values);
          return entry.message.replace(/\$([a-z_]+)\$/gi, (_match, name) => {
            const index = Number(entry.placeholders?.[name.toLowerCase()]?.content.slice(1));
            return values[index - 1] ?? '';
          });
        }
      };
    }
  } catch {
    // The extension's standard translations remain available if the worker is unavailable.
  }
  return systemCopy;
}
