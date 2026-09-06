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
- Reads DOCX, text PDF, TXT, MD, and RTF resumes.
- Shows extracted sections and job-alignment keywords for review.
- Keeps the full preview editable; DOCX, PDF, and RTF exports are generated
  from the current edited value in the same request.
- Production requests require a signed-in Supabase user with a `resumeats`
  entitlement. Job-page fetching blocks private networks and oversized pages.

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
