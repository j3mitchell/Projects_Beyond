function isResumeATSPage() {
  return window.location.hostname === 'jisystems.net'
    ? window.location.pathname.startsWith('/app/resumeats/')
    : true;
}

if (isResumeATSPage()) {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type !== 'resumeats:job-capture:request') return;

    chrome.runtime.sendMessage({ type: 'resumeats:get-capture' }, (capture) => {
      if (chrome.runtime.lastError || !capture?.text) return;
      window.postMessage({ type: 'resumeats:job-capture', payload: capture }, window.location.origin);
    });
  });
}
