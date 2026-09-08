function isResumeATSPage() {
  return window.location.hostname === 'jisystems.net'
    ? window.location.pathname.startsWith('/app/resumeats/')
    : true;
}

if (isResumeATSPage()) {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type === 'resumeats:job-capture:start') {
      const sourceUrl = String(event.data.payload?.sourceUrl || '').trim();
      chrome.runtime.sendMessage({ type: 'resumeats:capture-url', url: sourceUrl }, (result) => {
        if (chrome.runtime.lastError) {
          window.postMessage({
            type: 'resumeats:job-capture:status',
            payload: { ok: false, error: 'ResumeATS Capture extension is unavailable.' },
          }, window.location.origin);
          return;
        }
        window.postMessage({
          type: 'resumeats:job-capture:status',
          payload: result || { ok: false, error: 'Browser capture did not start.' },
        }, window.location.origin);
      });
      return;
    }
    if (event.data?.type !== 'resumeats:job-capture:request') return;

    chrome.runtime.sendMessage({ type: 'resumeats:get-capture' }, (capture) => {
      if (chrome.runtime.lastError || !capture?.text) return;
      window.postMessage({ type: 'resumeats:job-capture', payload: capture }, window.location.origin);
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'resumeats:deliver-capture') {
      window.postMessage({ type: 'resumeats:job-capture:request' }, window.location.origin);
    }
  });
}
