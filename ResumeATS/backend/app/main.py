from __future__ import annotations

import re
from collections import Counter
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from uuid import uuid4

import requests
from bs4 import BeautifulSoup
from docx import Document
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from striprtf.striprtf import rtf_to_text

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

ALLOWED_FORMATS = {"all", "docx", "pdf", "rtf"}

app = FastAPI(title="Resume ATS Refactor API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateResponse(BaseModel):
    job_title: str
    company: str
    preview: str
    thumbnail: str
    files: dict[str, str]


class ResumeJob(BaseModel):
    number: int
    job: str = ""
    company: str = ""
    descriptions: list[str] = Field(default_factory=list)


class ResumeExtractionResponse(BaseModel):
    target_position_title: str
    executive_summary: str
    skills: list[str]
    experience: list[ResumeJob]
    education: list[str]


SECTION_ALIASES = {
    "executive_summary": {
        "executive summary", "professional summary", "summary", "profile",
        "professional profile", "career summary", "career profile",
    },
    "skills": {
        "skills", "technical skills", "core skills", "core competencies", "competencies",
        "areas of expertise", "key skills", "technical proficiencies",
    },
    "experience": {
        "experience", "professional experience", "work experience", "employment history",
        "career experience", "professional history",
    },
    "education": {
        "education", "education and certifications", "education & certifications",
        "academic background", "academic experience", "training and education",
    },
}

TITLE_WORDS = {
    "administrator", "analyst", "architect", "assistant", "banker", "consultant", "coordinator",
    "developer", "director", "engineer", "executive", "founder", "lead", "manager", "officer",
    "president", "principal", "programmer", "recruiter", "representative", "specialist", "supervisor",
    "technician", "vp", "ceo", "cio", "cfo", "cto", "owner", "designer", "accountant",
    "associate", "advisor", "strategist", "scientist", "operator", "sales", "marketing", "support",
    "dba", "database", "data", "project", "program", "product", "systems", "system", "network",
}

COMPANY_WORDS = {
    "inc", "llc", "corp", "corporation", "company", "group", "solutions", "services",
    "technologies", "technology", "university", "college", "bank", "partners", "associates",
    "consulting", "enterprises", "industries", "international", "federal", "government", "agency",
    "department", "commission", "labs", "laboratory", "health", "capital", "holdings", "space",
}

ACTION_VERBS = {
    "administered", "architected", "automated", "built", "collaborated", "configured", "coordinated",
    "created", "deployed", "designed", "developed", "directed", "documented", "drove", "engineered",
    "established", "executed", "implemented", "improved", "integrated", "led", "maintained", "managed",
    "migrated", "modernized", "monitored", "optimized", "partnered", "performed", "provided", "reduced",
    "resolved", "supported", "troubleshot", "upgraded", "delivered", "oversaw", "trained", "installed",
    "assisted", "analyzed", "tested", "secured", "streamlined", "introduced", "supervised",
}

DESCRIPTION_PREFIXES = (
    "clients:", "client:", "environment:", "responsibilities:", "responsibility:", "technologies:",
    "technology:", "tools:", "achievements:", "achievement:", "highlights:", "projects:", "project:",
)

MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
DATE_VALUE = rf"(?:{MONTH}\s+)?(?:19|20)\d{{2}}"
DATE_RANGE_RE = re.compile(rf"\b{DATE_VALUE}\s*(?:[-–—]|to)\s*(?:{DATE_VALUE}|present|current)\b", re.I)
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b", re.I)
BULLET_RE = re.compile(r"^[•●▪◦‣∙\-–—]\s*")


def _slugify(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9\s-]", "", value).strip().lower()
    return re.sub(r"\s+", "-", value)[:40] or "resume"


def _validate_job_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="job_url must be a valid http/https URL.")


def _extract_job(url: str) -> tuple[str, str, str]:
    _validate_job_url(url)
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to fetch job URL: {exc}") from exc

    soup = BeautifulSoup(response.text, "html.parser")
    title = (soup.title.string if soup.title and soup.title.string else "Job Opportunity").strip()
    headings = [h.get_text(" ", strip=True) for h in soup.select("h1, h2")]
    body_text = " ".join(p.get_text(" ", strip=True) for p in soup.select("p"))
    description = " ".join(headings + [body_text])[:4500]
    company_meta = soup.find("meta", attrs={"property": "og:site_name"})
    company = company_meta.get("content", "Unknown Company") if company_meta else "Unknown Company"
    return title, company, description


def _docx_paragraph_text(paragraph) -> str:
    text = re.sub(r"\s+", " ", paragraph.text or "").strip()
    if not text:
        return ""
    ppr = paragraph._p.pPr
    is_numbered = bool(ppr is not None and ppr.numPr is not None)
    style_name = (paragraph.style.name or "").lower() if paragraph.style else ""
    is_list = is_numbered or "list" in style_name or "bullet" in style_name
    if is_list and not BULLET_RE.match(text):
        return f"• {text}"
    return text


def _read_resume(file: UploadFile, raw_bytes: bytes) -> tuple[str, Optional[Document]]:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix == ".docx":
        doc = Document(BytesIO(raw_bytes))
        lines = [_docx_paragraph_text(p) for p in doc.paragraphs]
        text = "\n".join(line for line in lines if line)
        return text, doc
    if suffix == ".rtf":
        return rtf_to_text(raw_bytes.decode("utf-8", errors="ignore")), None
    return raw_bytes.decode("utf-8", errors="ignore"), None


def _normalize_heading(line: str) -> str:
    return re.sub(r"[^a-z0-9& ]+", "", line.lower()).strip()


def _section_name(line: str) -> Optional[str]:
    normalized = _normalize_heading(line)
    if len(normalized) > 40:
        return None
    for section, aliases in SECTION_ALIASES.items():
        if normalized in aliases:
            return section
    return None


def _resume_sections(text: str) -> tuple[list[str], dict[str, list[str]]]:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    sections = {name: [] for name in SECTION_ALIASES}
    current: Optional[str] = None
    preamble: list[str] = []

    for line in lines:
        section = _section_name(line)
        if section:
            current = section
            continue
        if current:
            sections[current].append(line)
        else:
            preamble.append(line)
    return preamble, sections


def _looks_like_contact(line: str) -> bool:
    lowered = line.lower()
    return bool(
        "@" in line
        or re.search(r"(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}", line)
        or "linkedin.com" in lowered
        or "github.com" in lowered
        or re.search(r"https?://", lowered)
    )


def _guess_target_position_title(preamble: list[str], experience_lines: list[str]) -> str:
    target_rx = re.compile(r"^(?:target(?:ed)?\s+(?:position|role|title)|desired\s+(?:position|role))\s*[:\-]\s*(.+)$", re.I)
    for line in preamble[:12]:
        match = target_rx.match(line)
        if match:
            return match.group(1).strip()

    for line in preamble[1:10]:
        if _looks_like_contact(line) or not 3 <= len(line) <= 80:
            continue
        if re.search(r"\b(summary|profile|skills|experience|education)\b", line, re.I) or YEAR_RE.search(line):
            continue
        return line

    for line in experience_lines[:8]:
        clean = _strip_bullet(line)
        if _looks_like_title(clean) and not _is_description_line(line):
            return clean
    return ""


def _extract_summary(preamble: list[str], summary_lines: list[str]) -> str:
    source = summary_lines or [
        line for line in preamble[1:10]
        if not _looks_like_contact(line) and len(line) > 45
    ]
    return " ".join(source[:4]).strip()


def _extract_skills(skill_lines: list[str]) -> list[str]:
    if not skill_lines:
        return []
    combined = " | ".join(skill_lines[:12])
    parts = re.split(r"[|•·;,\n]+", combined)
    cleaned: list[str] = []
    seen: set[str] = set()
    for part in parts:
        skill = re.sub(r"\s+", " ", part).strip(" -–—:•")
        if not 1 < len(skill) <= 80:
            continue
        key = skill.lower()
        if key not in seen:
            seen.add(key)
            cleaned.append(skill)
    return cleaned[:24]


def _is_bullet(line: str) -> bool:
    return bool(BULLET_RE.match(line.strip()))


def _strip_bullet(line: str) -> str:
    return BULLET_RE.sub("", line.strip()).strip()


def _starts_with_action_verb(line: str) -> bool:
    first = re.sub(r"[^a-z]", "", _strip_bullet(line).split(" ", 1)[0].lower())
    return first in ACTION_VERBS


def _has_job_date(line: str) -> bool:
    if DATE_RANGE_RE.search(line):
        return True
    lowered = line.lower()
    if ("present" in lowered or "current" in lowered) and YEAR_RE.search(line):
        return True
    # A lone year can be a date line, but only when the line is short or clearly a header.
    return bool(YEAR_RE.search(line) and (len(line) <= 35 or " | " in line))


def _strip_dates(line: str) -> str:
    cleaned = DATE_RANGE_RE.sub("", line)
    cleaned = re.sub(rf"\b{DATE_VALUE}\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\b(?:present|current)\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s*[-–—]\s*$", "", cleaned)
    return re.sub(r"\s{2,}", " ", cleaned).strip(" |,-–—")


def _looks_like_title(line: str) -> bool:
    lowered = line.lower()
    if _starts_with_action_verb(line) or lowered.startswith(DESCRIPTION_PREFIXES):
        return False
    return any(re.search(rf"\b{re.escape(word)}\b", lowered) for word in TITLE_WORDS)


def _looks_like_company(line: str) -> bool:
    clean = _strip_bullet(line).strip()
    lowered = clean.lower()
    if not clean or _starts_with_action_verb(clean) or lowered.startswith(DESCRIPTION_PREFIXES):
        return False
    if len(clean.split()) > 12 or clean.endswith((".", ";")):
        return False
    return any(re.search(rf"\b{re.escape(word)}\b", lowered) for word in COMPANY_WORDS)


def _is_description_line(line: str) -> bool:
    clean = _strip_bullet(line).strip()
    lowered = clean.lower()
    if not clean:
        return False
    if _is_bullet(line) or lowered.startswith(DESCRIPTION_PREFIXES) or _starts_with_action_verb(clean):
        return True
    if len(clean.split()) >= 15:
        return True
    if clean.endswith((".", ";")) and not _has_job_date(clean):
        return True
    return False


def _header_start(lines: list[str], anchor: int) -> int:
    line = lines[anchor]
    # Most resumes keep title/company/date on one pipe-delimited line.
    if " | " in line and (_looks_like_title(_strip_dates(line)) or len(line.split("|")) >= 3):
        return anchor

    start = anchor
    for pos in range(anchor - 1, max(-1, anchor - 3), -1):
        candidate = lines[pos].strip()
        if not candidate or _has_job_date(candidate) or _is_description_line(candidate):
            break
        if len(candidate) > 120:
            break
        start = pos
    return start


def _header_candidates(header_lines: list[str]) -> list[str]:
    values: list[str] = []
    for line in header_lines:
        if _is_bullet(line) or _is_description_line(line):
            continue
        cleaned = _strip_dates(line)
        if not cleaned:
            continue
        parts = re.split(r"\s+\|\s+", cleaned)
        for part in parts:
            value = part.strip(" ,|-–—")
            if not value or len(value) > 120 or value in values:
                continue
            if _is_description_line(value):
                continue
            values.append(value)
    return values


def _split_header_values(header_lines: list[str]) -> tuple[str, str]:
    values = _header_candidates(header_lines)
    if not values:
        return "", ""

    title_scores = [
        sum(1 for word in TITLE_WORDS if re.search(rf"\b{re.escape(word)}\b", value.lower()))
        for value in values
    ]
    title_index = max(range(len(values)), key=lambda i: title_scores[i])
    job = values[title_index] if title_scores[title_index] > 0 else ""

    if not job:
        # If nothing resembles a role title, do not promote a sentence into a job field.
        candidate = values[0]
        if len(candidate.split()) <= 10 and not _is_description_line(candidate):
            job = candidate
            title_index = 0
        else:
            title_index = -1

    remaining = [value for i, value in enumerate(values) if i != title_index]
    company = ""

    # Explicit org-looking candidate wins.
    for value in remaining:
        if _looks_like_company(value):
            company = value
            break

    # In the canonical TITLE | COMPANY | DATE form, the value adjacent to the title is the company.
    if not company and title_index >= 0:
        adjacent_indices = [title_index + 1, title_index - 1]
        for idx in adjacent_indices:
            if 0 <= idx < len(values):
                value = values[idx]
                if value != job and not _looks_like_title(value) and not _is_description_line(value):
                    company = value
                    break

    # Better to leave company blank than mislabel a duty sentence as a company.
    return job, company


def _extract_jobs(experience_lines: list[str]) -> list[ResumeJob]:
    if not experience_lines:
        return []

    lines = [line.strip() for line in experience_lines if line.strip()]
    anchors = [idx for idx, line in enumerate(lines) if _has_job_date(line)]
    if not anchors:
        return _extract_jobs_without_dates(lines)

    starts: list[int] = []
    anchor_for_start: dict[int, int] = {}
    for anchor in anchors:
        start = _header_start(lines, anchor)
        # Ignore duplicate date references that fall inside the same header.
        if start in anchor_for_start:
            continue
        starts.append(start)
        anchor_for_start[start] = anchor

    starts = sorted(set(starts))
    jobs: list[ResumeJob] = []
    seen: set[tuple[str, str]] = set()

    for idx, start in enumerate(starts):
        anchor = anchor_for_start[start]
        next_start = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
        if anchor >= next_start:
            continue

        header_lines = lines[start : anchor + 1]
        job_title, company = _split_header_values(header_lines)
        body_lines = lines[anchor + 1 : next_start]
        descriptions = []
        for body_line in body_lines:
            clean = _strip_bullet(body_line)
            if not clean:
                continue
            # Anything between two verified job headers belongs to the current job body.
            # This intentionally includes labels such as Clients: and Environment:.
            descriptions.append(clean)

        if not job_title and not company:
            continue

        key = (job_title.lower(), company.lower())
        if key in seen:
            continue
        seen.add(key)
        jobs.append(
            ResumeJob(
                number=len(jobs) + 1,
                job=job_title,
                company=company,
                descriptions=descriptions[:16],
            )
        )
        if len(jobs) >= 12:
            break

    return jobs


def _extract_jobs_without_dates(lines: list[str]) -> list[ResumeJob]:
    jobs: list[ResumeJob] = []
    current: Optional[ResumeJob] = None

    for line in lines:
        clean = _strip_bullet(line)
        if not clean:
            continue
        if not _is_description_line(line) and _looks_like_title(clean):
            if current:
                jobs.append(current)
            current = ResumeJob(number=len(jobs) + 1, job=clean, company="", descriptions=[])
            continue
        if current is None:
            continue
        if not current.company and not _is_description_line(line) and not _looks_like_title(clean):
            current.company = clean
        else:
            current.descriptions.append(clean)

    if current:
        jobs.append(current)
    for index, job in enumerate(jobs[:12], start=1):
        job.number = index
    return jobs[:12]


def _extract_education(education_lines: list[str]) -> list[str]:
    if not education_lines:
        return []
    items: list[str] = []
    buffer: list[str] = []
    degree_rx = re.compile(
        r"\b(bachelor|master|associate|doctor|ph\.?d|mba|b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?|degree|diploma|certificate|university|college|institute|school)\b",
        re.I,
    )
    for line in education_lines[:16]:
        if degree_rx.search(line) and buffer:
            items.append(" | ".join(buffer))
            buffer = [line]
        else:
            buffer.append(line)
        if len(buffer) >= 3:
            items.append(" | ".join(buffer))
            buffer = []
    if buffer:
        items.append(" | ".join(buffer))
    return [item for item in items if item][:8]


def _extract_resume_elements(text: str) -> ResumeExtractionResponse:
    preamble, sections = _resume_sections(text)
    return ResumeExtractionResponse(
        target_position_title=_guess_target_position_title(preamble, sections["experience"]),
        executive_summary=_extract_summary(preamble, sections["executive_summary"]),
        skills=_extract_skills(sections["skills"]),
        experience=_extract_jobs(sections["experience"]),
        education=_extract_education(sections["education"]),
    )


def _extract_top_keywords(job_desc: str, n: int = 12) -> list[str]:
    words = re.findall(r"\b[A-Za-z][A-Za-z+/#.-]{3,}\b", job_desc)
    stop = {
        "with", "from", "your", "that", "have", "will", "this", "about", "their", "which", "would", "role",
        "team", "years", "experience", "skills", "work", "ability", "using", "build", "across", "including",
    }
    counts = Counter(w.lower() for w in words if w.lower() not in stop)
    return [w for w, _ in counts.most_common(n)]


def _build_bullets(resume_lines: list[str], keywords: list[str]) -> list[str]:
    candidates = [ln.strip("•- ") for ln in resume_lines if len(ln.strip()) > 25]
    selected = candidates[:3] if candidates else ["Delivered measurable business value across core initiatives."]
    enriched = []
    for idx, bullet in enumerate(selected, start=1):
        kw = keywords[idx - 1] if idx - 1 < len(keywords) else "execution"
        enriched.append(f"• {bullet} (Aligned keyword: {kw})")
    return enriched


def _ats_refactor(original_text: str, job_desc: str) -> str:
    keywords = _extract_top_keywords(job_desc)
    resume_lines = [ln for ln in original_text.split("\n") if ln.strip()]
    summary_lines = [
        "ATS-Optimized Resume", "", "Professional Summary",
        "Results-driven professional with proven delivery and role-aligned impact.",
        f"Targeted ATS keywords: {', '.join(keywords[:10]) or 'N/A'}.",
        "", "Experience Highlights",
    ]
    summary_lines.extend(_build_bullets(resume_lines, keywords))
    summary_lines.extend(["", "Original Resume Content (preserved)", original_text.strip()])
    return "\n".join(summary_lines)


def _write_docx(content: str, template: Optional[Document], target: Path) -> None:
    doc = Document()
    sample = None
    if template and template.paragraphs and template.paragraphs[0].runs:
        sample = template.paragraphs[0].runs[0]
    for line in content.split("\n"):
        para = doc.add_paragraph(line)
        if sample and para.runs:
            run = para.runs[0]
            run.font.name = sample.font.name
            run.bold = sample.bold
            run.italic = sample.italic
            if sample.font.size:
                run.font.size = sample.font.size
    doc.save(target)


def _write_pdf(content: str, target: Path) -> None:
    from html import escape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    font = "Helvetica"
    for candidate in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/Library/Fonts/Arial Unicode.ttf"):
        if Path(candidate).exists():
            font = "ResumeATSUnicode"
            if font not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(font, candidate))
            break
    style = ParagraphStyle("resume", fontName=font, fontSize=10, leading=14, splitLongWords=True)
    story = [Paragraph(escape(line), style) if line.strip() else Spacer(1, 8)
             for line in content.splitlines()]
    SimpleDocTemplate(str(target), pagesize=letter, leftMargin=40, rightMargin=40,
                      topMargin=40, bottomMargin=40).build(story)


def _write_rtf(content: str, target: Path) -> None:
    chunks = []
    for character in content:
        if character in "\\{}":
            chunks.append("\\" + character)
        elif character == "\n":
            chunks.append("\\par\n")
        elif ord(character) < 128:
            chunks.append(character)
        else:
            encoded = character.encode("utf-16-le")
            for index in range(0, len(encoded), 2):
                unit = int.from_bytes(encoded[index:index + 2], "little", signed=True)
                chunks.append(f"\\u{unit}?")
    target.write_text("{\\rtf1\\ansi\\uc1\n" + "".join(chunks) + "\n}", encoding="ascii")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract", response_model=ResumeExtractionResponse)
async def extract_resume(resume: UploadFile = File(...)) -> ResumeExtractionResponse:
    raw = await resume.read()
    text, _ = _read_resume(resume, raw)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Resume appears to be empty.")
    return _extract_resume_elements(text)


@app.post("/generate", response_model=GenerateResponse)
async def generate_resume(
    resume: UploadFile = File(...),
    job_url: str = Form(...),
    output_format: str = Form("all"),
) -> GenerateResponse:
    if output_format not in ALLOWED_FORMATS:
        raise HTTPException(status_code=400, detail=f"output_format must be one of: {sorted(ALLOWED_FORMATS)}")

    raw = await resume.read()
    text, template_doc = _read_resume(resume, raw)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Resume appears to be empty.")

    job_title, company, job_desc = _extract_job(job_url)
    optimized = _ats_refactor(text, job_desc)
    date_tag = datetime.utcnow().strftime("%Y%m%d")
    id_tag = str(uuid4())[:8]
    stem = f"{_slugify(job_title)}_{date_tag}_{id_tag}"

    files: dict[str, str] = {}
    formats = {"docx", "pdf", "rtf"} if output_format == "all" else {output_format}
    if "docx" in formats:
        docx_path = OUTPUT_DIR / f"{stem}.docx"
        _write_docx(optimized, template_doc, docx_path)
        files["docx"] = f"/download/{docx_path.name}"
    if "pdf" in formats:
        pdf_path = OUTPUT_DIR / f"{stem}.pdf"
        _write_pdf(optimized, pdf_path)
        files["pdf"] = f"/download/{pdf_path.name}"
    if "rtf" in formats:
        rtf_path = OUTPUT_DIR / f"{stem}.rtf"
        _write_rtf(optimized, rtf_path)
        files["rtf"] = f"/download/{rtf_path.name}"

    preview = optimized[:2200]
    thumbnail = "\n".join(preview.splitlines()[:6])
    return GenerateResponse(job_title=job_title, company=company, preview=preview, thumbnail=thumbnail, files=files)


@app.get("/download/{filename}")
def download_file(filename: str):
    safe_name = Path(filename).name
    file_path = OUTPUT_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=file_path, filename=safe_name)
