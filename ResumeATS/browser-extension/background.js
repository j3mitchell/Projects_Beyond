const CAPTURE_KEY = 'resumeats.latestCapture';
const RESUMEATS_URLS = [
  'https://jisystems.net/app/resumeats/',
  'http://localhost:3000/',
  'http://127.0.0.1:3000/',
];

function isResumeATSUrl(url = '') {
  return RESUMEATS_URLS.some((prefix) => url.startsWith(prefix));
}

function captureVisiblePage() {
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME', 'TEMPLATE']);
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION',
    'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI',
    'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR',
    'UL',
  ]);

  function visible(element) {
    if (element === document.body) return true;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  const lines = [];
  let pending = '';
  function flush() {
    const value = pending.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (value) lines.push(value);
    pending = '';
  }
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      pending += `${node.nodeValue || ''} `;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node;
    if (SKIP_TAGS.has(element.tagName) || !visible(element)) return;
    const block = BLOCK_TAGS.has(element.tagName);
    if (block) flush();
    for (const child of element.childNodes) walk(child);
    if (block) flush();
  }

  walk(document.body);
  flush();
  const seen = new Set();
  const text = lines
    .map((line) => line.replace(/^[•●▪◦‣⁃]\s*/, '').trim())
    .filter((line) => line && !seen.has(line) && seen.add(line))
    .join('\n')
    .slice(0, 30000);
  return { text, title: document.title || '', sourceUrl: window.location.href };
}

async function openResumeATS() {
  const tabs = await chrome.tabs.query({});
  const receiver = tabs.find((tab) => isResumeATSUrl(tab.url || ''));
  if (receiver?.id) {
    await chrome.tabs.update(receiver.id, { active: true });
    if (receiver.windowId) await chrome.windows.update(receiver.windowId, { focused: true });
    return receiver;
  }
  return chrome.tabs.create({ url: RESUMEATS_URLS[0] });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureTab(tabId) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: captureVisiblePage });
  const capture = results?.[0]?.result;
  if (!capture?.text) throw new Error('No visible text was found on this page.');
  return {
    ...capture,
    id: crypto.randomUUID(),
    capturedAt: Date.now(),
  };
}

async function storeCapture(capture) {
  await chrome.storage.session.set({ [CAPTURE_KEY]: capture });
}

async function notifyResumeATS(tab) {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'resumeats:deliver-capture' });
  } catch {
    // A new tab may not have loaded its bridge yet; the app requests on load.
  }
}

async function waitForTabComplete(tabId) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('The job page did not finish loading.'));
    }, 20000);
    function onUpdated(updatedId, changeInfo) {
      if (updatedId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function captureUrl(url) {
  const tab = await chrome.tabs.create({ url, active: true });
  if (!tab.id) throw new Error('Could not open the job page.');
  await waitForTabComplete(tab.id);
  await delay(1500);
  const capture = await captureTab(tab.id);
  await storeCapture(capture);
  const receiver = await openResumeATS();
  await notifyResumeATS(receiver);
  return { ok: true };
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) return;
  try {
    const capture = await captureTab(tab.id);
    await storeCapture(capture);
    const receiver = await openResumeATS();
    await notifyResumeATS(receiver);
  } catch (error) {
    console.warn('ResumeATS capture failed:', error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'resumeats:capture-url') {
    const url = String(message.url || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      sendResponse({ ok: false, error: 'Enter a valid http(s) job URL.' });
      return undefined;
    }
    captureUrl(url)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Browser capture failed.' }));
    return true;
  }
  if (message?.type !== 'resumeats:get-capture') return undefined;
  chrome.storage.session.get(CAPTURE_KEY)
    .then(async (result) => {
      const capture = result[CAPTURE_KEY] || null;
      if (capture) await chrome.storage.session.remove(CAPTURE_KEY);
      sendResponse(capture);
    })
    .catch(() => sendResponse(null));
  return true;
});
