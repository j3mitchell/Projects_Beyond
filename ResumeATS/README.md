# ResumeATS

ResumeATS is the J.I. Systems resume review workspace. It accepts a resume and
either a public job URL or pasted job description, preserves the applicant's
source facts, and lets the user edit the complete preview before exporting.

## Stack
- Backend: FastAPI (Python)
- Frontend: React
- Hosting: React on Cloudflare, FastAPI on Google Cloud Run

## Features
- Web dashboard with upload form.
- Reads DOCX, legacy DOC, ODT, text PDF, TXT, MD, RTF, HTML, JSON, XML, Pages packages, and ZIP archives containing readable resume files.
- Shows extracted sections and job-alignment keywords for review.
- Job URL analysis can be switched with the slider: Deterministic mode uses
  bounded scraping, rules/regex, taxonomy matching, and explainable skill
  ranking; AI mode extracts page text and metadata, then returns inferred
  industry, work location/type, short work/task summaries, qualifications,
  minimum and preferred skills, pay, and ranked skills as structured JSON.
- The target-job preview keeps `[desc]` under ten words, uses `[loc]` for the
  location, limits list items to six words, and labels skill groups `[skMin]`
  and `[skMax]` with `[skMin01]` and `[skMax01]` items. Numeric compensation
  remains formatted as two amounts plus a term.
- Keeps the full preview editable; DOCX, PDF, and RTF exports are generated
  from the current edited value in the same request.
- Production requests require a signed-in Supabase user with a `resumeats`
  entitlement. Job-page fetching blocks private networks and oversized pages.

AI mode runs only from the Cloud Run backend. Configure `OPENAI_API_KEY` and,
optionally, `OPENAI_MODEL` or `OPENAI_BASE_URL` on that service; without a key,
the API returns a clear configuration error and Deterministic mode remains
available. Supabase is used for access and entitlements, not as the scraping or
AI runtime.

## Run locally

```bash
./start-resumeats.command
```

To stop it:

```bash
./stop-resumeats.command
```

Then open `http://localhost:3000`.

The production workspace is at
`https://jisystems.net/app/gateway/?tool=resumeats`. Sign in through the
gateway; it will launch `https://jisystems.net/app/resumeats/` after access is
verified.

## Safe auto-pull every 10 minutes (macOS)

Run once:

```bash
./setup-auto-pull.command
```

This installs a macOS LaunchAgent that checks GitHub every 10 minutes and fast-forwards only when the local working tree is clean. Local edits are never overwritten.
