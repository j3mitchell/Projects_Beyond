# ResumeATS Capture extension

This Manifest V3 Chrome extension is the browser fallback for job pages that do not expose complete HTML to the deterministic fetcher. It reads visible text from the current tab locally, stores the capture temporarily, opens ResumeATS, fills **Paste Job Description**, and submits the existing `/generate` flow automatically.

## Install for local testing

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `ResumeATS/browser-extension` directory.
4. Pin **ResumeATS Capture** to the toolbar.

When deterministic extraction reports an incomplete result, install the
extension and click **Capture visible job page** in ResumeATS. The extension
opens the submitted URL, reads the visible DOM, returns to ResumeATS, and
submits the text through the existing Paste Job Description handler. You can
also click the pinned extension icon directly while viewing the job page. No
resume upload is required for job-only extraction.
