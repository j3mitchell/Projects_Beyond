# Tech180 Backend

FastAPI service for importing a public web URL into an editable Tech180 page snapshot.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8050
```

## API

- `GET /health`
- `POST /api/import`

```json
{
  "url": "https://example.com",
  "include_subpages": true
}
```
