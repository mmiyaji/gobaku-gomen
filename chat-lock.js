(() => {
  const youtube = self.origin === 'https://www.youtube.com';
  if (youtube && window === top) {
    document.addEventListener('gobaku-dialog-open', watchEmbeddedDialog);
  }
  // YouTube can populate an initially blank iframe and set its chat URL afterward.
  if (youtube && location.pathname !== '/live_chat' && window.frameElement?.id !== 'chatframe' &&
      location.href !== 'about:blank' && location.href !== 'about:srcdoc') return;

  const site = youtube ? {
    siteKey: 'youtubeEnabled',
    composerSelector: 'yt-live-chat-message-input-renderer',
    editorSelector: 'yt-live-chat-message-input-renderer #input[contenteditable]:not([contenteditable="false"])',
    sendSelector: 'yt-live-chat-message-input-renderer #send-button'
  } : ({
    'www.twitch.tv': {
      siteKey: 'twitchEnabled',
      composerSelector: '.chat-input',
      editorSelector: '[data-a-target="chat-input"]:is(textarea, input, [contenteditable])',
      sendSelector: '[data-a-target="chat-send-button"]'
    },
    'live.nicovideo.jp': {
      siteKey: 'niconicoEnabled',
      composerSelector: '.ga-ns-comment-post-form',
      editorSelector: '.ga-ns-comment-post-form :is(input, textarea):is(.comment-text-box, [name="comment"])',
      sendSelector: '.ga-ns-comment-post-form button[type="submit"]'
    },
    'twitcasting.tv': {
      siteKey: 'twitcastingEnabled',
      composerSelector: 'form.tw-comment-post',
      editorSelector: 'form.tw-comment-post textarea.tw-textarea',
      sendSelector: 'form.tw-comment-post .tw-comment-post-operations button.tw-button-primary'
    },
    'kick.com': {
      siteKey: 'kickEnabled',
      composerSelector: '#chat-input-wrapper',
      editorSelector: '#chat-input-wrapper :is(#chat-input, [data-testid="chat-input"], [data-lexical-editor="true"]):is(input, textarea, [contenteditable]:not([contenteditable="false"]))',
      sendSelector: '#send-message-button'
    }
  })[location.hostname.replace(/^www\.kick\.com$/, 'kick.com')];
  if (!site) return;
  const { siteKey, composerSelector, editorSelector, sendSelector } = site;
  let copy = systemCopy;
  const t = (key, ...values) => copy.t(key, ...values);
  const buttons = new Map();
  let settings = defaultSettings;
  let enabled;
  let settingsRequest = 0;
  let pendingDialog;
  let pasteAllowedUntil = 0;
  let unlockSession;
  let eventRoot;
  let unlockDeadline = Infinity;
  let lockTimer;
  let countdownText;
  let composing = false;
  let unlockedEditor = null;
  let chatPage = currentChatPage();

  function currentChatPage() {
    return youtube ? location.pathname + location.search : location.pathname;
  }

  function buttonAnchor(editor) {
    return editor.closest(composerSelector) ??
      editor.closest('.chat-input__textarea') ?? editor.parentElement;
  }

  function lock() {
    if (!unlockedEditor) return;

    unlockSession.abort();
    clearPastePermission();
    unlockSession = undefined;
    if (pendingDialog?.dataset.gobakuConfirm === 'paste') pendingDialog.close();
    unlockedEditor.removeAttribute('data-gobaku-unlocked');
    const button = buttons.get(unlockedEditor);
    if (button) {
      button.textContent = t('unlock');
      button.removeAttribute('data-gobaku-open');
      if (settings.confirmUnlock) button.setAttribute('aria-haspopup', 'dialog');
    }
    clearTimeout(lockTimer);
    unlockDeadline = Infinity;
    countdownText = undefined;
    composing = false;
    unlockedEditor = null;
  }

  function watchFocusLoss(signal) {
    const hostDocument = window.frameElement?.ownerDocument ?? document;
    hostDocument.addEventListener('visibilitychange', () => {
      if (hostDocument.hidden) lock();
    }, { signal });

    hostDocument.defaultView.addEventListener('blur', () => {
      // A dialog in the watch page can move focus out of the embedded chat.
      setTimeout(() => {
        if (!signal.aborted && !hostDocument.hasFocus()) lock();
      }, 0);
    }, { signal });
  }

  function checkLockState() {
    const page = currentChatPage();
    if (chatPage !== page) {
      pendingDialog?.close();
      chatPage = page;
      lock();
    }
    if (!composing && Date.now() >= unlockDeadline) lock();
  }

  function updateCountdown() {
    checkLockState();
    if (!countdownText || composing) return;

    const remaining = unlockDeadline - Date.now();
    if (remaining <= 0) {
      lock();
      return;
    }
    countdownText.data = t('time_remaining', String(Math.ceil(remaining / 1000)));
    lockTimer = setTimeout(updateCountdown, remaining % 1000 || 1000);
  }

  function restartCountdown() {
    clearTimeout(lockTimer);
    unlockDeadline = Date.now() + settings.unlockSeconds * 1000;
    updateCountdown();
  }

  function trackChatInput(event) {
    if (event.type === 'focusout' && unlockedEditor?.contains(event.target)) clearPastePermission();
    if (!event.isTrusted || !countdownText || !unlockedEditor.contains(event.target)) return;

    checkLockState();
    if (!countdownText) return;

    if (event.type === 'compositionstart') {
      composing = true;
      clearTimeout(lockTimer);
      countdownText.data = t('composing');
    } else if (event.type === 'compositionend' ||
        (event.type === 'focusout' && composing) ||
        (event.type === 'input' && !event.isComposing)) {
      composing = false;
      restartCountdown();
    }
  }

  function watchEmbeddedDialog(event) {
    const dialog = event.target;
    const frame = document.querySelector('iframe#chatframe');
    if (!frame || !(dialog instanceof HTMLDialogElement) || !dialog.matches('dialog[data-gobaku-confirm]:modal')) return;

    const frameDocument = frame.contentDocument;
    const page = location.href;
    // Keep this observer in the watch page so it survives removal of the chat frame.
    const observer = new MutationObserver(() => {
      if (!dialog.isConnected) {
        observer.disconnect();
      } else if (!frame.isConnected || frame.contentDocument !== frameDocument || location.href !== page) {
        observer.disconnect();
        dialog.close();
        dialog.remove();
      }
    });
    dialog.addEventListener('close', () => observer.disconnect(), { once: true });
    observer.observe(document, { childList: true, subtree: true });
  }

  function renderDialogCopy(dialog) {
    dialog.lang = copy.language;
    const paste = dialog.dataset.gobakuConfirm === 'paste';
    dialog.querySelector('#gobaku-confirm-title').textContent = t(paste ? 'paste_title' : 'confirm_title');
    dialog.querySelector('#gobaku-confirm-message').textContent = paste ? t('paste_description')
      : settings.autoRelock ? t('confirm_timed', String(settings.unlockSeconds))
      : t('confirm_manual');
    dialog.querySelector('[value="cancel"]').textContent = t('cancel');
    dialog.querySelector('[value="agree"]').textContent = t(paste ? 'paste_apply'
      : settings.autoRelock ? 'unlock_chat' : 'unlock');
  }

  function useCopy(nextCopy) {
    if (copy.language === nextCopy.language) return;

    copy = nextCopy;
    for (const [editor, button] of buttons) {
      button.lang = copy.language;
      button.firstChild.textContent = t(editor === unlockedEditor ? 'lock_now' : 'unlock');
    }
    if (pendingDialog?.open) renderDialogCopy(pendingDialog);
    if (countdownText) {
      countdownText.data = composing ? t('composing')
        : t('time_remaining', String(Math.max(0, Math.ceil((unlockDeadline - Date.now()) / 1000))));
    }
  }

  function requestConfirmation(kind) {
    return new Promise((resolve) => {
      const frame = youtube && window.frameElement?.id === 'chatframe' ? window.frameElement : null;
      const dialogDocument = frame?.ownerDocument ?? document;
      const dialog = dialogDocument.createElement('dialog');
      pendingDialog = dialog;
      dialog.dataset.gobakuConfirm = kind;
      dialog.setAttribute('aria-labelledby', 'gobaku-confirm-title');
      dialog.setAttribute('aria-describedby', 'gobaku-confirm-message');

      const form = dialogDocument.createElement('form');
      form.method = 'dialog';

      const title = dialogDocument.createElement('h2');
      title.id = 'gobaku-confirm-title';

      const message = dialogDocument.createElement('p');
      message.id = 'gobaku-confirm-message';

      const cancel = dialogDocument.createElement('button');
      cancel.value = 'cancel';
      cancel.autofocus = true;

      const agree = dialogDocument.createElement('button');
      agree.value = 'agree';

      const actions = dialogDocument.createElement('div');
      actions.setAttribute('data-gobaku-actions', '');
      actions.append(cancel, agree);
      form.append(title, message, actions);
      dialog.append(form);
      renderDialogCopy(dialog);
      dialog.addEventListener('close', () => {
        pendingDialog = undefined;
        dialog.remove();
        resolve(dialog.returnValue === 'agree');
      }, { once: true });
      dialogDocument.body.append(dialog);
      dialog.showModal();
      if (frame) dialog.dispatchEvent(new Event('gobaku-dialog-open', { bubbles: true }));
    });
  }

  function syncEditors() {
    bindPageEvents();
    document.documentElement?.setAttribute('data-gobaku-active', siteKey);
    checkLockState();

    for (const [editor, button] of buttons) {
      if (editor.isConnected && editor.matches(editorSelector) &&
          button.isConnected && button.parentElement === buttonAnchor(editor)?.parentElement) continue;

      if (editor === unlockedEditor) lock();
      button.remove();
      buttons.delete(editor);
    }

    for (const editor of document.querySelectorAll(editorSelector)) {
      if (buttons.has(editor)) continue;
      const anchor = buttonAnchor(editor);
      if (!anchor?.parentElement) continue;

      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-gobaku-unlock', '');
      button.textContent = t('unlock');
      button.lang = copy.language;
      if (settings.confirmUnlock) button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', async (event) => {
        if (!event.isTrusted || !enabled || pendingDialog || !editor.isConnected) return;

        checkLockState();
        if (editor === unlockedEditor) {
          lock();
          return;
        }

        const page = currentChatPage();
        const agreed = !settings.confirmUnlock || await requestConfirmation('unlock');
        if (!agreed || buttons.get(editor) !== button || !editor.isConnected ||
            !editor.matches(editorSelector) || currentChatPage() !== page) return;

        lock();
        unlockedEditor = editor;
        unlockSession = new AbortController();
        if (settings.relockOnLeave) watchFocusLoss(unlockSession.signal);
        editor.setAttribute('data-gobaku-unlocked', '');
        button.textContent = t('lock_now');
        button.setAttribute('data-gobaku-open', '');
        button.removeAttribute('aria-haspopup');
        if (settings.autoRelock) {
          const countdown = document.createElement('span');
          countdown.setAttribute('data-gobaku-countdown', '');
          countdownText = document.createTextNode('');
          countdown.append(countdownText);
          button.append(countdown);
          restartCountdown();
        }
        editor.focus();
      });
      buttons.set(editor, button);
      anchor.before(button);
    }
  }

  function clearPastePermission() {
    pasteAllowedUntil = 0;
  }

  async function confirmChatPaste(event, editor) {
    if (event.isTrusted && !pendingDialog && performance.now() < pasteAllowedUntil) {
      clearPastePermission();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.isTrusted || pendingDialog) return;

    const signal = unlockSession.signal;
    const textField = editor.matches('input, textarea');
    const selection = document.getSelection();
    const range = !textField && selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const start = textField ? editor.selectionStart : null;
    const end = textField ? editor.selectionEnd : null;
    const agreed = await requestConfirmation('paste');
    checkLockState();
    if (signal.aborted || !editor.isConnected || !editor.matches(editorSelector)) return;

    editor.focus();
    if (document.activeElement !== editor) return;
    if (start !== null && end !== null) {
      editor.setSelectionRange(start, end);
    } else if (range && editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (agreed) pasteAllowedUntil = performance.now() + 10000;
  }

  function guardChatEnter(event, editor) {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || composing) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'keydown' || !event.isTrusted || event.repeat || event.shiftKey || event.altKey ||
        !(event.ctrlKey || event.metaKey) || pendingDialog) return;

    const send = editor.closest(composerSelector)?.querySelector(sendSelector) ??
      (siteKey === 'kickEnabled' ? document.querySelector(sendSelector) : null);
    if (!send || send.matches(':disabled, [aria-disabled="true"]')) return;
    const controlSelector = 'button, input[type="submit"], [role="button"]';
    const control = send.matches(controlSelector) ? send
      : send.querySelector(controlSelector) ?? send.querySelector('yt-icon-button');
    if (control && control.getClientRects().length &&
        !control.matches(':disabled, [aria-disabled="true"]')) control.click();
  }

  function protectChatInput(event) {
    checkLockState();
    if (enabled === false || !(event.target instanceof Element)) return;

    const editor = event.target.closest(editorSelector);
    const lockedEditor = editor && editor !== unlockedEditor;
    const lockedSend = !unlockedEditor && event.target.closest(sendSelector);
    const lockedForm = event.type === 'submit' &&
      event.target.querySelector(editorSelector) && !event.target.contains(unlockedEditor);

    if (!lockedEditor && !lockedSend && !lockedForm) {
      if (editor && editor === unlockedEditor) {
        if (event.type === 'paste' && settings.confirmPaste) confirmChatPaste(event, editor);
        if (settings.confirmPaste && (event.type === 'drop' || event.inputType === 'insertFromDrop')) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        if (event instanceof KeyboardEvent && settings.guardEnter) guardChatEnter(event, editor);
      }
      return;
    }
    if (event.type === 'keydown' && event.key === 'Tab') return;

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onPageHide() {
    pendingDialog?.close();
    lock();
  }

  function bindPageEvents() {
    // document.open() replaces the root and clears the iframe's event listeners.
    if (eventRoot === document.documentElement) return;
    eventRoot = document.documentElement;
    window.addEventListener('focus', checkLockState);
    window.addEventListener('blur', clearPastePermission);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('popstate', checkLockState);
    for (const type of ['input', 'compositionstart', 'compositionend', 'focusout']) {
      window.addEventListener(type, trackChatInput, true);
    }
    for (const type of ['keydown', 'keypress', 'keyup', 'beforeinput', 'paste', 'drop', 'click', 'submit']) {
      window.addEventListener(type, protectChatInput, true);
    }
  }
  bindPageEvents();

  const observer = new MutationObserver(syncEditors);
  const observerOptions = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-a-target', 'contenteditable', 'id', 'data-testid', 'data-lexical-editor']
  };

  function applySettings(next) {
    if (!isValidUnlockTime(next.unlockSeconds)) next.unlockSeconds = defaultSettings.unlockSeconds;
    const nextEnabled = next.enabled !== false && next[siteKey];
    if (enabled === nextEnabled && ['confirmUnlock', 'autoRelock', 'unlockSeconds', 'confirmPaste', 'relockOnLeave', 'guardEnter']
      .every((key) => settings[key] === next[key])) return;

    pendingDialog?.close();
    lock();
    observer.disconnect();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
    settings = next;
    enabled = nextEnabled;

    if (enabled) {
      observer.observe(document, observerOptions);
      syncEditors();
    } else {
      document.documentElement?.removeAttribute('data-gobaku-active');
    }
  }

  async function reloadSettings() {
    const request = ++settingsRequest;
    let next;
    try {
      next = await chrome.storage.local.get(defaultSettings);
    } catch {
      next = { ...defaultSettings };
    }
    if (request !== settingsRequest) return;
    applySettings(next);

    if (copy.language !== resolveLanguage(next.language)) {
      const nextCopy = await loadCopy(next.language);
      if (request === settingsRequest) useCopy(nextCopy);
    }
  }

  chrome.storage.local.onChanged.addListener(reloadSettings);
  reloadSettings();
})();
