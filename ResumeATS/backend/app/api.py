from __future__ import annotations

import os
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app import main as legacy
from app.access import require_access
from app.contracts import ResumeExtractionResponse
from app.job_source import analyze_job, analyze_job_text
from app.parser_pipeline import pipeline
from app.resume_io import SUPPORTED_INPUT_EXTENSIONS, read_resume_text

APP_VERSION = "platform-v1"
MAX_UPLOAD = 10 * 1024 * 1024
FORMATS = {"docx", "pdf", "rtf"}
app = FastAPI(title="ResumeATS API", version=APP_VERSION)


@app.middleware("http")
async def protect_requests(request, call_next):
    # Authenticate before parsing uploads, including malformed multipart bodies.
    if request.method != "OPTIONS" and request.url.path != "/health":
        try:
            request.state.user = await run_in_threadpool(require_access, request.headers.get("authorization"))
        except HTTPException as exc:
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    if request.method == "POST":
        # Bound the complete body before the multipart parser allocates files.
        from fastapi.responses import JSONResponse
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_UPLOAD + 65536:
                return JSONResponse({"detail": "Upload exceeds the 10 MB limit."}, status_code=413)
        request._body = bytes(body)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _read(raw: bytes, filename: str) -> str:
    if Path(filename).suffix.lower() in {".docx", ".odt", ".pages", ".zip"}:
        try:
            with ZipFile(BytesIO(raw)) as archive:
                if sum(item.file_size for item in archive.infolist()) > 30 * 1024 * 1024:
                    raise HTTPException(413, "The expanded document exceeds the 30 MB limit.")
        except BadZipFile:
            extension = Path(filename).suffix.lower().lstrip(".").upper()
            raise HTTPException(400, f"This {extension} file is damaged or invalid.")
    try:
        text = read_resume_text(UploadFile(filename=filename, file=BytesIO(raw)), raw)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, "Unable to read this document. Try DOCX, PDF, TXT, MD, RTF, HTML, DOC, ODT, JSON, XML, PAGES, or ZIP.") from exc
    if not text.strip():
        raise HTTPException(400, "No text was found. Scanned PDFs require OCR; try a text-based PDF or DOCX.")
    if len(text) > 100000:
        raise HTTPException(413, "Resume text exceeds the 100,000 character limit.")
    return text


async def read_upload(resume: UploadFile) -> str:
    if Path(resume.filename or "").suffix.lower() not in SUPPORTED_INPUT_EXTENSIONS:
        raise HTTPException(400, "Use a DOCX, PDF, TXT, MD, RTF, HTML, DOC, ODT, JSON, XML, PAGES, or ZIP resume.")
    raw = await resume.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "Resume files must be 10 MB or smaller.")
    return await run_in_threadpool(_read, raw, resume.filename or "resume.txt")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "app": "ResumeATS", "version": APP_VERSION,
            "parser": pipeline.status(), "input_formats": [extension[1:] for extension in SUPPORTED_INPUT_EXTENSIONS]}


@app.get("/access")
def access() -> dict:
    return {"authenticated": True, "authorized": True, "tool": "resumeats"}


@app.post("/extract", response_model=ResumeExtractionResponse)
async def extract_resume(resume: UploadFile = File(...)) -> ResumeExtractionResponse:
    text = await read_upload(resume)
    return await run_in_threadpool(pipeline.parse, text)


class RankedSkill(BaseModel):
    name: str
    score: float = Field(ge=0, le=100)
    evidence: list[str] = Field(default_factory=list)
    source: str


class JobAnalysisResponse(BaseModel):
    mode: Literal["deterministic", "ai"]
    source_url: str = ""
    title: str
    company: str
    industry: str
    description: str = ""
    location: str = ""
    type: str = ""
    work: str = ""
    task: str = ""
    qual: list[str] = Field(default_factory=list)
    skills_min: list[str] = Field(default_factory=list)
    skills_max: list[str] = Field(default_factory=list)
    pay: str = ""
    summary: str
    raw_text: str
    metadata: dict[str, str] = Field(default_factory=dict)
    skills: list[RankedSkill] = Field(default_factory=list)


class GenerateResponse(legacy.GenerateResponse):
    keywords: list[dict[str, str]] = Field(default_factory=list)
    analysis: JobAnalysisResponse | None = None


@app.post("/generate", response_model=GenerateResponse)
async def generate_resume(
    resume: UploadFile | None = File(None),
    job_url: str = Form("", max_length=2048),
    job_description: str = Form("", max_length=30000),
    output_format: str = Form("all"),
    job_model: str = Form("deterministic"),
) -> GenerateResponse:
    if output_format not in FORMATS | {"all"}:
        raise HTTPException(400, "Choose DOCX, PDF, RTF, or all formats.")
    if job_model not in {"deterministic", "ai"}:
        raise HTTPException(400, "Choose Deterministic or AI job analysis.")
    text = await read_upload(resume) if resume is not None else ""
    if job_description.strip():
        analysis = await run_in_threadpool(analyze_job_text, job_description.strip(), job_model)
    elif job_url.strip():
        analysis = await run_in_threadpool(analyze_job, job_url.strip(), job_model)
    else:
        raise HTTPException(400, "Enter a job URL or paste the job description.")
    title = analysis["title"]
    company = analysis["company"]
    description = analysis["summary"]
    # Keep the applicant's factual content intact. Keyword suggestions belong
    # beside the resume and must never become invented qualifications.
    preview = "\n".join(line.rstrip() for line in text.strip().splitlines())
    suggested = [skill["name"] for skill in analysis.get("skills", []) if skill.get("name")]
    if not suggested:
        suggested = legacy._extract_top_keywords(description)
    keywords = [{"keyword": word, "status": "present" if word.lower() in text.lower() else "review"}
                for word in suggested]
    return GenerateResponse(job_title=title, company=company, preview=preview,
                            thumbnail="\n".join(preview.splitlines()[:6]), files={}, keywords=keywords,
                            analysis=analysis)


class ExportRequest(BaseModel):
    content: str = Field(min_length=1, max_length=100000)
    job_title: str = Field(default="Resume", max_length=200)
    output_format: str


def render_export(payload: ExportRequest) -> Response:
    if payload.output_format not in FORMATS:
        raise HTTPException(400, "Choose DOCX, PDF, or RTF.")
    if not payload.content.strip():
        raise HTTPException(400, "The resume preview is empty.")
    extension = payload.output_format
    filename = f"{legacy._slugify(payload.job_title)}_{uuid4().hex[:8]}.{extension}"
    with TemporaryDirectory(prefix="resumeats-") as temp:
        path = Path(temp) / filename
        if extension == "docx":
            legacy._write_docx(payload.content, None, path)
        elif extension == "pdf":
            legacy._write_pdf(payload.content, path)
        else:
            legacy._write_rtf(payload.content, path)
        raw = path.read_bytes()
    media = {"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
             "pdf": "application/pdf", "rtf": "application/rtf"}[extension]
    return Response(raw, media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/export")
def export_resume(payload: ExportRequest) -> Response:
    # Bytes are returned in the same request; no cross-instance filesystem or
    # public download URL is involved, and temporary files are removed first.
    return render_export(payload)


# Keep CORS outside access checks so browsers can read expired-session errors.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("RESUMEATS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
)
