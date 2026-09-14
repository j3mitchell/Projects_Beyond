# ResumeATS Architecture

ResumeATS uses a stable API entrypoint and an explicit parsing pipeline. Version-specific FastAPI wrapper modules are no longer part of the runtime architecture.

## Runtime

- `backend/app/api.py` — stable FastAPI entrypoint and HTTP contract
- `backend/app/resume_io.py` — resume ingestion, including DOCX paragraph/table order
- `backend/app/parser_pipeline.py` — deterministic parsing pipeline
- `backend/app/classifier.py` — O*NET + spaCy classification services
- `backend/app/organization_aliases.py` — organization acronym/alias normalization
- `backend/app/main.py` — legacy resume-generation helpers retained behind the API boundary
- `frontend/src/validation.js` — Zod frontend contract validation

Job analysis tiers are explicit: Deterministic is the free, explainable path;
AI is the paid-member path. Production access reads the user's membership tier
from Supabase before allowing AI requests. Affinda is selected automatically
when its credentials are configured; the OpenAI-compatible adapter remains a
migration fallback.

## Parsing pipeline

1. **Ingest** — read DOCX, legacy DOC, ODT, PDF, RTF, HTML, JSON, XML, Pages packages, ZIP archives, and text while preserving document order where the source format exposes it.
2. **Normalize** — normalize whitespace and bullet representation.
3. **Section detection** — identify summary, skills, experience, and education sections.
4. **Entity classification** — classify job titles, organizations, descriptions, and locations.
5. **Relationship linking** — associate title/company/date/body records into job blocks.
6. **Validation** — Pydantic rejects malformed backend output; Zod validates frontend payloads.
7. **Output** — return the stable extraction schema expected by the React UI.

## Classification policy

- O*NET is the strongest job-title signal.
- Grammar rules are a controlled fallback for legitimate titles missing from O*NET.
- Action/duty sentences are explicitly rejected as titles.
- spaCy NER, organization aliases, company suffixes, and structural position classify employers.
- Known acronyms such as DHS are preserved exactly as written but linked internally to canonical organization names.
- Locations are excluded from employer selection.
- Missing companies may be recovered only from the first few context lines of the same job block.
- The parser leaves uncertain fields blank rather than inventing values.

## Stability rule

New parsing behavior belongs in `parser_pipeline.py` or classifier services. Do not create `main_vN.py` wrapper modules for parser changes.
