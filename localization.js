chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'getLocaleMessages' || !['en', 'ja'].includes(message.language)) return;

  fetch(chrome.runtime.getURL(`_locales/${message.language}/messages.json`))
    .then((response) => response.ok ? response.json() : null)
    .then(sendResponse, () => sendResponse(null));
  return true;
});
