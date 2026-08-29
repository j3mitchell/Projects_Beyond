# Tech180

Tech180 is a Python + React MVP for importing a public webpage and turning it into an editable recreation.

## Current Capabilities

- URL import through a FastAPI backend.
- Same-origin subpage discovery for the dropdown.
- HTML asset URL rewriting for images, links, CSS, media, and frames.
- Script stripping so the editor can control the recreated page.
- Editable text, image, and link element detection.
- React editor with iframe preview, element selection, replacement fields, and HTML export.

## Run Locally

The launcher creates a private project-root `.env` with a random development
API credential on first run. `.env` is ignored by Git; `.env.example` documents
the allowed setting names without containing secrets.

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8050
```

Frontend:

```bash
cd frontend
npm install
npm start
```

The React app runs at `http://localhost:4050` and expects the API at `http://localhost:8050`.

## Security baseline

- Every `/api/*` route requires authentication; anonymous calls return `401`.
- CORS accepts only origins listed in `TECH180_ALLOWED_ORIGINS`.
- Development and production configuration are separate.
- Production validates the Supabase session and Tech180 entitlement on every
  protected API call, and fails closed when either check fails.
- The Supabase publishable browser key may use `REACT_APP_*`; private service,
  Stripe, Resend, and OpenAI keys must never use browser-visible variables.
- Future OpenAI calls must run in the backend and read `OPENAI_API_KEY` from the
  hosting environment; the browser must never receive that key.

## Notes

This first pass imports server-rendered/static HTML best. A later version should add Playwright-based rendering for JavaScript-heavy sites and local asset persistence for full offline export.
