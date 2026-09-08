# ResumeATS Capture extension

This Manifest V3 Chrome extension is the browser fallback for job pages that do not expose complete HTML to the deterministic fetcher. It reads visible text from the current tab locally, stores the capture temporarily, opens ResumeATS, fills **Paste Job Description**, and submits the existing `/generate` flow automatically.

## Install for local testing

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `ResumeATS/browser-extension` directory.
4. Pin **ResumeATS Capture** to the toolbar.

When deterministic extraction reports an incomplete result, open the job page and click the extension icon. It focuses an existing ResumeATS tab or opens `https://jisystems.net/app/resumeats/`; the captured listing is then analyzed through the same Paste Job Description handler. No resume upload is required for job-only extraction.
