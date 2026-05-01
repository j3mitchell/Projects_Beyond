# Resume ATS Dashboard (Local)

A local-first app that takes a resume + job URL and outputs ATS-focused versions in DOCX, PDF, and/or RTF.

## Stack
- Backend: FastAPI (Python)
- Frontend: React
- Hosting: local machine (localhost)

## Features
- Web dashboard with upload form.
- Pulls job page content from URL.
- Generates ATS-refactored resume text.
- Downloads generated files from local file structure (`backend/output`).
- Auto naming convention: `<job-title>_<YYYYMMDD>_<short-id>.<ext>`.
- Preview panel + small thumbnail excerpt.
- Basic style inheritance from original DOCX (font name, size, bold, italic from first run).

## Run locally
### One-click launcher
```bash
./start-resumeats.command
```

To stop it:
```bash
./stop-resumeats.command
```

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm start
```

Then open `http://localhost:3000`.
