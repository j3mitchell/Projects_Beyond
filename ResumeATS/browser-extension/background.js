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
    return;
  }
  await chrome.tabs.create({ url: RESUMEATS_URLS[0] });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) return;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureVisiblePage });
    const capture = results?.[0]?.result;
    if (!capture?.text) throw new Error('No visible text was found on this page.');
    await chrome.storage.session.set({
      [CAPTURE_KEY]: {
        ...capture,
        id: crypto.randomUUID(),
        capturedAt: Date.now(),
      },
    });
    await openResumeATS();
  } catch (error) {
    console.warn('ResumeATS capture failed:', error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
