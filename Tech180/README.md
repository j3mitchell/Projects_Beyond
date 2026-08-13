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

## Notes

This first pass imports server-rendered/static HTML best. A later version should add Playwright-based rendering for JavaScript-heavy sites and local asset persistence for full offline export.
