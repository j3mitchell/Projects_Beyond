from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app import main as base
from app.classifier import classifier
from app.contracts import ResumeClearance, ResumeEducation, ResumeExtractionResponse, ResumeJob
from app.organization_aliases import ORGANIZATION_ALIASES

PARSER_VERSION = "pipeline-v4-record-boundaries"

EntityKind = Literal["title", "company", "description", "location", "unknown"]

ROLE_NOUNS = {
    "administrator", "analyst", "architect", "assistant", "banker", "consultant", "coordinator",
    "developer", "director", "engineer", "executive", "founder", "lead", "manager", "officer",
    "president", "principal", "programmer", "recruiter", "representative", "specialist", "supervisor",
    "technician", "vp", "ceo", "cio", "cfo", "cto", "owner", "designer", "accountant", "associate",
    "advisor", "strategist", "scientist", "operator", "dba",
}

TITLE_CONNECTORS = {"of", "and", "for", "to", "the", "&"}
TITLE_MODIFIERS = {
    "senior", "sr", "junior", "jr", "lead", "principal", "staff", "chief", "associate", "assistant",
    "data", "database", "oracle", "sql", "cloud", "web", "application", "applications", "software",
    "systems", "system", "network", "security", "cyber", "technical", "technology", "it", "enterprise",
    "business", "program", "project", "product", "operations", "infrastructure", "platform", "solutions",
    "digital", "analytics", "engineering", "development", "information", "machine", "learning", "ai",
    "financial", "logistics", "sharepoint", "accounting",
}

STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
    "VA", "WA", "WV", "WI", "WY", "DC",
}

SECTION_ALIASES = {
    "executive_summary": {
        "executive summary", "experience summary", "professional summary", "summary", "profile",
        "professional profile", "career summary", "career profile", "qualifications summary",
        "summary of qualifications",
    },
    "skills": {
        "skills", "skill sets", "technical skill sets", "technical skills", "core skills",
        "core competencies", "competencies", "areas of expertise", "key skills",
        "technical proficiencies", "technology skills", "technical expertise",
    },
    "experience": {
        "experience", "professional experience", "work experience", "employment history",
        "career experience", "professional history", "employment experience",
    },
    "education": {
        "education", "academic background", "academic experience", "training and education",
    },
    "clearances": {
        "clearance", "clearances", "security clearance", "security clearances", "active clearance",
        "active clearances", "government clearance", "government clearances",
    },
    "certifications": {
        "certification", "certifications", "professional certifications", "technical certifications",
        "licenses and certifications", "licenses & certifications", "credentials", "certificates",
    },
}

IGNORE_HEADINGS = {
    "references", "professional references", "references furnished upon request",
    "additional information", "interests",
}

ACTION_VERBS = set(base.ACTION_VERBS) | {
    "offer", "offering", "provide", "providing", "assist", "assisting", "analyze", "develop",
    "design", "deliver", "support", "supporting", "manage", "managing", "maintain", "maintaining",
    "troubleshoot", "troubleshooting", "harden", "hardening", "resolve", "resolving",
}

MONTH_WORD = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
DATE_TOKEN = rf"(?:{MONTH_WORD}\s+(?:19|20)\d{{2}}|(?:0?[1-9]|1[0-2])[/.-](?:\d{{2}}|(?:19|20)\d{{2}})|(?:19|20)\d{{2}})"
DATE_RANGE_RE = re.compile(
    rf"\b{DATE_TOKEN}\s*(?:[-–—]|to)\s*(?:{DATE_TOKEN}|present|current|now)\b",
    re.I,
)

EMAIL_RE = re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9._%+-])")
PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?1[\s.-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)"
)
LINKEDIN_RE = re.compile(r"(?i)(?:(?:https?://)?(?:www\.)?linkedin\.com/in/[A-Za-z0-9][^\s|<>()]*)")
URL_RE = re.compile(r"(?i)https?://[^\s|<>()]+")
BARE_SITE_RE = re.compile(r"(?i)(?<![@\w])(?:www\.)?(?:github\.com|gitlab\.com)/[^\s|<>()]+")
LOCATION_RE = re.compile(
    r"^(?P<city>[A-Za-z][A-Za-z .'-]{1,50}?),\s*(?P<state>[A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$"
)
NAME_SUFFIX_RE = re.compile(r"(?i),?\s*(Jr\.?|Sr\.?|II|III|IV|V|Esq\.?|CPA|MD|Ph\.?D\.?)$")

TITLE_LABEL_RE = re.compile(r"^(?:title|position|role)\s*:\s*(.+)$", re.I)
COMPANY_LABEL_RE = re.compile(r"^(?:employer|company|organization|agency)\s*:\s*(.+)$", re.I)
ORG_CONTEXT_LABEL_RE = re.compile(
    r"^(?:employer|company|organization|agency|client|customer|contract|program|environment)\s*:\s*(.+)$",
    re.I,
)
CONTRACT_SPLIT_RE = re.compile(r"\s+(?:SME\s+)?Contract\s*:\s*", re.I)
DOTTED_ACRONYM_RE = re.compile(r"(?<![A-Za-z])(?:[A-Za-z]\.){2,}(?![A-Za-z])")

CLEARANCE_RE = re.compile(
    r"\b(?:clearance|public trust|secret|top secret|ts[-/\s]?sci|sci|polygraph|counterintelligence polygraph|"
    r"full scope polygraph|q clearance|l clearance|dod secret|dod top secret)\b",
    re.I,
)
CERTIFICATION_RE = re.compile(
    r"\b(?:certified|certification|certificate|credential|license|licensed|pmp|cissp|cism|cisa|security\+|"
    r"network\+|a\+|ccna|ccnp|itil|scrum master|aws certified|azure certified|oracle certified|ocp|oca|"
    r"comptia|six sigma|safe|togaf)\b",
    re.I,
)
EDUCATION_RE = re.compile(
    r"\b(?:bachelor|master|associate|doctor|doctorate|ph\.?d|mba|b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?|"
    r"degree|university|college|institute|school|major|minor|gpa|graduat)\b",
    re.I,
)


@dataclass(frozen=True)
class EntityCandidate:
    text: str
    kind: EntityKind
    confidence: float
    evidence: str


@dataclass
class JobBlock:
    title: str
    company: str
    date_range: str
    descriptions: list[str]
    title_confidence: float
    company_confidence: float


def _normalize_line(value: str) -> str:
    value = (value or "").replace("\xa0", " ")
    value = re.sub(r"[ \f\v]+", " ", value)
    value = re.sub(r"\s*\|\s*", " | ", value)
    return value.strip()


def _strip_bullet(value: str) -> str:
    return base._strip_bullet(value).strip()


def _normalize_heading(value: str) -> str:
    value = _strip_bullet(value)
    value = re.sub(r"\([^)]*(?:cont|continued)[^)]*\)", "", value, flags=re.I)
    value = re.sub(r"\b(?:cont|continued)\b\.{0,3}", "", value, flags=re.I)
    value = value.replace("|", " | ")
    value = re.sub(r"[^a-zA-Z0-9&| ]+", " ", value)
    return re.sub(r"\s+", " ", value.lower()).strip(" :|")


def _single_section_name(value: str) -> str | None:
    normalized = _normalize_heading(value)
    if not normalized or len(normalized) > 70:
        return None
    if normalized in IGNORE_HEADINGS:
        return "__ignore__"
    for section, aliases in SECTION_ALIASES.items():
        if normalized in aliases:
            return section
    if normalized.startswith("professional experience"):
        return "experience"
    if normalized.startswith("technical skill"):
        return "skills"
    if normalized.startswith("experience summary"):
        return "executive_summary"
    return None


def _heading_sections(value: str) -> tuple[str, ...] | None:
    clean = _strip_bullet(value).strip().rstrip(":")
    direct = _single_section_name(clean)
    if direct:
        return (direct,)

    parts = [part.strip() for part in re.split(r"\s+\|\s+|\s+&\s+|\s+AND\s+", clean, flags=re.I) if part.strip()]
    if len(parts) > 1:
        mapped = tuple(section for section in (_single_section_name(part) for part in parts) if section)
        if len(mapped) == len(parts):
            return mapped
    return None


def _route_compound_line(line: str, sections: tuple[str, ...]) -> str:
    if "clearances" in sections and CLEARANCE_RE.search(line):
        return "clearances"
    if "certifications" in sections and CERTIFICATION_RE.search(line):
        return "certifications"
    if "education" in sections and EDUCATION_RE.search(line):
        return "education"
    if "education" in sections:
        return "education"
    return sections[0]


def _resume_sections(text: str) -> tuple[list[str], dict[str, list[str]]]:
    lines = [_normalize_line(line) for line in text.splitlines()]
    lines = [line for line in lines if line]
    sections = {name: [] for name in SECTION_ALIASES}
    current: tuple[str, ...] | None = None
    preamble: list[str] = []

    for line in lines:
        heading = _heading_sections(line)
        if heading:
            current = heading
            continue

        if current is None:
            preamble.append(line)
            continue
        if current == ("__ignore__",):
            continue

        destination = current[0] if len(current) == 1 else _route_compound_line(line, current)
        if destination in sections:
            sections[destination].append(line)

    return preamble, sections


def _has_job_date(value: str) -> bool:
    return bool(DATE_RANGE_RE.search(value))


def _job_date_range(value: str) -> str:
    """Return the first position date range in a stable ``mm/yy - mm/yy`` form."""
    match = DATE_RANGE_RE.search(value or "")
    if not match:
        return ""
    clean = re.sub(r"\s+", " ", match.group(0)).strip()
    return re.sub(r"\s*(?:[-–—]|to)\s*", " - ", clean, flags=re.I)


def _strip_job_dates(value: str) -> str:
    cleaned = DATE_RANGE_RE.sub("", value)
    return re.sub(r"\s{2,}", " ", cleaned).strip(" |,;-–—")


def _description_like(value: str) -> bool:
    clean = _strip_bullet(value)
    if not clean:
        return False
    lowered = clean.lower()
    if lowered.startswith(("environment:", "clientele:", "clients:", "projects:", "responsibilities:", "achievements:")):
        return True
    words = re.findall(r"[A-Za-z]+", clean.lower())
    if not words:
        return False
    if words[0] in ACTION_VERBS:
        return True
    if len(words) >= 16:
        return True
    if clean.endswith((".", ";")) and not _has_job_date(clean):
        return True
    return False


def _location_like(value: str) -> bool:
    clean = value.strip()
    if not clean:
        return False
    lowered = clean.lower()
    if lowered in {"remote", "hybrid", "onsite", "on-site"}:
        return True
    if re.search(r"\b\d{5}(?:-\d{4})?\b", clean):
        return True
    match = re.search(r",\s*([A-Z]{2})(?:\s|$)", clean)
    if match and match.group(1) in STATE_CODES:
        return True
    words = clean.replace(",", " ").split()
    return len(words) <= 4 and any(word in STATE_CODES for word in words)


def _normalize_punctuated_acronyms(value: str) -> str:
    """Normalize U.S./D.C.-style acronyms for classification, preserving display text."""
    return DOTTED_ACRONYM_RE.sub(lambda match: match.group(0).replace(".", ""), value)


def _clean_title_label(value: str) -> str:
    clean = _strip_bullet(value)
    match = TITLE_LABEL_RE.match(clean)
    if match:
        clean = match.group(1).strip()
    parts = CONTRACT_SPLIT_RE.split(clean, maxsplit=1)
    clean = parts[0].strip(" |,-–—")
    return clean


def _strict_title_fallback(value: str) -> bool:
    clean = _clean_title_label(value)
    if not clean or len(clean) > 120 or clean.endswith((".", ";", ":")):
        return False
    grammar = re.sub(r"[|/]", " ", clean)
    words = [re.sub(r"[^a-z0-9+#.&-]", "", word.lower()) for word in grammar.split()]
    words = [word for word in words if word]
    if not words or len(words) > 14:
        return False
    if words[0] in ACTION_VERBS or any(word in ACTION_VERBS for word in words):
        return False

    noun_ing = {"engineering", "marketing", "accounting", "consulting", "banking", "training"}
    adjective_ed = {"certified", "licensed", "advanced", "distributed", "embedded"}
    first = words[0]
    if first.endswith("ing") and first not in noun_ing:
        return False
    if first.endswith("ed") and first not in adjective_ed:
        return False
    if not any(word in ROLE_NOUNS for word in words):
        return False

    allowed = ROLE_NOUNS | TITLE_MODIFIERS | TITLE_CONNECTORS
    unknown_count = sum(1 for word in words if word not in allowed)
    return unknown_count <= max(3, len(words) // 2)


def classify_title(value: str) -> EntityCandidate:
    clean = _clean_title_label(value)
    if not clean or _description_like(clean) or _location_like(clean) or _has_job_date(clean):
        return EntityCandidate(clean, "unknown", 0.0, "rejected")

    onet = classifier.job_title_match(clean)
    if onet.get("valid"):
        return EntityCandidate(clean, "title", float(onet.get("confidence", 0.0)), str(onet.get("source", "onet")))
    if _strict_title_fallback(clean):
        return EntityCandidate(clean, "title", 0.80, "grammar")
    return EntityCandidate(clean, "unknown", 0.0, "no-title-match")


def _embedded_organization(value: str) -> EntityCandidate | None:
    clean = value.strip()
    for alias, canonical in ORGANIZATION_ALIASES.items():
        alias_match = re.search(rf"(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])", clean, re.I)
        if alias_match:
            text = clean[alias_match.start():alias_match.end()]
            return EntityCandidate(text, "company", 0.99, f"alias:{canonical}")
        canonical_match = re.search(re.escape(canonical), clean, re.I)
        if canonical_match:
            text = clean[canonical_match.start():canonical_match.end()]
            return EntityCandidate(text, "company", 0.99, "canonical-org")

    for token in re.findall(r"\b[A-Z][A-Z0-9&.-]{1,9}\b", clean):
        org = classifier.organization_match(_normalize_punctuated_acronyms(token))
        score = float(org.get("confidence", 0.0))
        if org.get("valid") and score >= 0.70:
            return EntityCandidate(token, "company", score, str(org.get("source", "acronym")))
    return None


def classify_company(value: str) -> EntityCandidate:
    clean = _strip_bullet(value)
    match = COMPANY_LABEL_RE.match(clean)
    if match:
        clean = match.group(1).strip()
    if not clean or _description_like(clean) or _location_like(clean) or _has_job_date(clean):
        return EntityCandidate(clean, "unknown", 0.0, "rejected")

    embedded = _embedded_organization(clean)
    if embedded and embedded.text == clean:
        return embedded

    org = classifier.organization_match(clean)
    score = float(org.get("confidence", 0.0))
    if not org.get("valid"):
        normalized = _normalize_punctuated_acronyms(clean)
        if normalized != clean:
            org = classifier.organization_match(normalized)
            score = float(org.get("confidence", 0.0))
    if org.get("valid") and score >= 0.55:
        return EntityCandidate(clean, "company", score, str(org.get("source", "organization")))
    return EntityCandidate(clean, "unknown", 0.0, "no-company-match")


def _strip_trailing_location(value: str) -> str:
    clean = value.strip(" |,;-–—")
    location_tail = re.compile(r"(?:[;,]\s*)[A-Za-z][A-Za-z .'-]{1,50},\s*(?:%s)\s*$" % "|".join(STATE_CODES))
    previous = None
    while previous != clean:
        previous = clean
        clean = location_tail.sub("", clean).strip(" |,;-–—")
    return clean


def _company_from_header(value: str, structural: bool = False) -> EntityCandidate | None:
    """Resolve the employer from a job header even when its date is missing or split."""
    clean = _strip_job_dates(value) if _has_job_date(value) else _strip_bullet(value)
    if not clean:
        return None

    parts = [part.strip() for part in re.split(r"\s+\|\s+", clean) if part.strip()]
    for part in parts:
        candidate_text = _strip_trailing_location(part)
        if not candidate_text or _location_like(candidate_text) or TITLE_LABEL_RE.match(candidate_text):
            continue

        company = classify_company(candidate_text)
        if company.kind == "company":
            return company
        if candidate_text.lower() == "independent contractor":
            return EntityCandidate(candidate_text, "company", 0.90, "self-employed-header")

        # A short line immediately followed by an explicit Title: field is
        # structurally an employer header even when NER does not recognize it.
        if structural and 1 <= len(candidate_text.split()) <= 18 and not _description_like(candidate_text):
            if classify_title(candidate_text).kind != "title":
                return EntityCandidate(candidate_text, "company", 0.76, "structural-job-header")

        if _has_job_date(value) and 1 <= len(candidate_text.split()) <= 14 and classify_title(candidate_text).kind != "title":
            return EntityCandidate(candidate_text, "company", 0.72, "date-header")
    return None


def _company_from_anchor(line: str) -> EntityCandidate | None:
    if not _has_job_date(line):
        return None
    return _company_from_header(line)


def _parse_explicit_title(line: str) -> tuple[EntityCandidate | None, str]:
    clean = _strip_bullet(line)
    match = TITLE_LABEL_RE.match(clean)
    if not match:
        return None, ""
    body = match.group(1).strip()
    parts = CONTRACT_SPLIT_RE.split(body, maxsplit=1)
    title_text = parts[0].strip(" |,-–—")
    contractor = parts[1].strip() if len(parts) > 1 else ""
    title = classify_title(title_text)
    return (title if title.kind == "title" else None), contractor


def _organization_from_context(value: str) -> EntityCandidate | None:
    clean = _strip_bullet(value)
    if not clean:
        return None
    label_match = ORG_CONTEXT_LABEL_RE.match(clean)
    if label_match:
        payload = label_match.group(1).strip()
        embedded = _embedded_organization(payload)
        if embedded:
            return embedded
        company = classify_company(payload)
        if company.kind == "company" and company.confidence >= 0.75:
            return company
    return _embedded_organization(clean)


def _find_title_in_block(block_lines: list[str]) -> tuple[EntityCandidate | None, int, str]:
    for index, line in enumerate(block_lines[:4]):
        title, contractor = _parse_explicit_title(line)
        if title:
            return title, index, contractor

    for index, line in enumerate(block_lines[:3]):
        if _description_like(line):
            continue
        search_line = _strip_job_dates(line) if _has_job_date(line) else line
        for part in [p.strip() for p in re.split(r"\s+\|\s+", search_line) if p.strip()]:
            candidate = classify_title(part)
            if candidate.kind == "title":
                return candidate, index, ""
    return None, -1, ""


def _recover_company(company: EntityCandidate | None, block_lines: list[str], contractor: str) -> EntityCandidate | None:
    if company:
        return company

    for line in block_lines[:5]:
        match = COMPANY_LABEL_RE.match(_strip_bullet(line))
        if match:
            candidate = classify_company(match.group(1))
            if candidate.kind == "company":
                return candidate

    # If this block has an explicit Title: field, its first non-title line is
    # strong structural evidence for an employer, even if spaCy/O*NET cannot
    # name the organization (e.g. "U.S. Pentagon – Joint Chiefs of Staff").
    has_explicit_title = any(TITLE_LABEL_RE.match(_strip_bullet(line)) for line in block_lines[:4])
    if has_explicit_title:
        for line in block_lines[:3]:
            if TITLE_LABEL_RE.match(_strip_bullet(line)):
                continue
            candidate = _company_from_header(line, structural=True)
            if candidate:
                return candidate

    for line in block_lines[:5]:
        candidate = _organization_from_context(line)
        if candidate:
            return candidate

    if contractor:
        candidate = classify_company(contractor)
        if candidate.kind == "company":
            return EntityCandidate(candidate.text, "company", max(candidate.confidence, 0.70), "contractor-fallback")
    return None


def _is_structural_job_start(lines: list[str], index: int) -> bool:
    """Detect a job record from employer/header + nearby explicit Title: field."""
    line = _strip_bullet(lines[index])
    if not line or TITLE_LABEL_RE.match(line) or _description_like(line):
        return False

    # A date range is always a strong job-record anchor.
    if _has_job_date(line):
        return True

    # PDF/Word extraction can split or drop the date column. Do not merge the
    # next employer into the current job when an explicit Title: follows it.
    if len(line.split()) > 22:
        return False
    for offset in (1, 2):
        next_index = index + offset
        if next_index >= len(lines):
            break
        candidate = _strip_bullet(lines[next_index])
        if not candidate:
            continue
        title, _ = _parse_explicit_title(candidate)
        if title:
            return True
        if _description_like(candidate) or _has_job_date(candidate):
            break
    return False


def _find_job_record_starts(lines: list[str]) -> list[int]:
    return [index for index in range(len(lines)) if _is_structural_job_start(lines, index)]


def _extract_jobs_with_anchors(lines: list[str], anchors: list[int]) -> list[JobBlock]:
    jobs: list[JobBlock] = []
    seen: set[tuple[str, str]] = set()

    for position, anchor in enumerate(anchors):
        next_anchor = anchors[position + 1] if position + 1 < len(anchors) else len(lines)
        block_lines = lines[anchor:next_anchor]

        anchor_company = _company_from_header(lines[anchor], structural=True)
        if not anchor_company and anchor > 0:
            previous = lines[anchor - 1]
            if not _description_like(previous) and not _has_job_date(previous) and len(previous.split()) <= 14:
                candidate = classify_company(_strip_trailing_location(previous))
                if candidate.kind == "company":
                    anchor_company = candidate

        title, title_index, contractor = _find_title_in_block(block_lines)
        if not title:
            continue

        company = _recover_company(anchor_company, block_lines, contractor)

        body_start = max(1, title_index + 1)
        descriptions: list[str] = []
        for line in block_lines[body_start:]:
            clean = _strip_bullet(line)
            if not clean or TITLE_LABEL_RE.match(clean) or COMPANY_LABEL_RE.match(clean):
                continue
            if _has_job_date(clean):
                continue
            descriptions.append(clean)

        block = JobBlock(
            title=title.text,
            company=company.text if company else "",
            date_range=_job_date_range(lines[anchor]),
            descriptions=descriptions[:20],
            title_confidence=title.confidence,
            company_confidence=company.confidence if company else 0.0,
        )
        key = (block.title.lower(), block.company.lower())
        if key not in seen:
            seen.add(key)
            jobs.append(block)
        if len(jobs) >= 16:
            break
    return jobs


def _extract_jobs_without_dates(lines: list[str]) -> list[JobBlock]:
    jobs: list[JobBlock] = []
    current: JobBlock | None = None

    for line in lines:
        clean = _strip_bullet(line)
        if not clean:
            continue

        explicit, contractor = _parse_explicit_title(clean)
        title = explicit or classify_title(clean)
        if title and title.kind == "title":
            if current:
                jobs.append(current)
            current = JobBlock(title.text, "", "", [], title.confidence, 0.0)
            if contractor:
                company = classify_company(contractor)
                if company.kind == "company":
                    current.company = company.text
                    current.company_confidence = company.confidence
            continue

        if current is None:
            continue

        if not current.company:
            company = classify_company(clean)
            if company.kind == "company" and company.confidence >= 0.70:
                current.company = company.text
                current.company_confidence = company.confidence
                continue

        current.descriptions.append(clean)

    if current:
        jobs.append(current)
    return jobs[:16]


def extract_jobs(experience_lines: list[str]) -> list[JobBlock]:
    lines = [_normalize_line(line) for line in experience_lines if _normalize_line(line)]
    if not lines:
        return []
    anchors = _find_job_record_starts(lines)
    return _extract_jobs_with_anchors(lines, anchors) if anchors else _extract_jobs_without_dates(lines)


def _extract_summary(lines: list[str]) -> str:
    return " ".join(_strip_bullet(line) for line in lines[:8] if _strip_bullet(line)).strip()


def _clean_contact_value(value: str) -> str:
    return value.strip().strip(".,;:()[]<>")


def _clean_phone_value(value: str) -> str:
    return value.strip().strip(".,;:[]<>")


def _contact_fragments(lines: list[str]) -> list[str]:
    fragments: list[str] = []
    for line in lines[:20]:
        clean = _strip_bullet(line)
        if not clean:
            continue
        fragments.append(clean)
        fragments.extend(part.strip() for part in re.split(r"\s+[|·•]\s+", clean) if part.strip())
    return fragments


def _looks_like_name(value: str) -> bool:
    clean = _clean_contact_value(re.sub(r"^(?:name|full name)\s*:\s*", "", value, flags=re.I))
    clean = NAME_SUFFIX_RE.sub("", clean).strip(" ,")
    words = clean.split()
    if not 2 <= len(words) <= 5 or any(any(character.isdigit() for character in word) for word in words):
        return False
    if _single_section_name(clean) or EMAIL_RE.search(clean) or PHONE_RE.search(clean) or "," in clean:
        return False
    return all(re.fullmatch(r"[A-Za-z][A-Za-z.'-]*", word) for word in words)


def _name_parts(value: str) -> dict[str, str]:
    clean = re.sub(r"^(?:name|full name)\s*:\s*", "", value, flags=re.I).strip().strip("[]<>")
    suffix_match = NAME_SUFFIX_RE.search(clean)
    suffix = suffix_match.group(1) if suffix_match else ""
    if suffix_match:
        clean = clean[:suffix_match.start()].strip(" ,")
    words = clean.split()
    if not _looks_like_name(clean) or len(words) < 2:
        return {"name": "", "name_first": "", "name_last": "", "suffix": ""}
    return {
        "name": clean,
        "name_first": words[0],
        "name_last": words[-1],
        "suffix": suffix,
    }


def _normalize_link(value: str) -> str:
    clean = _clean_contact_value(value)
    if clean and not re.match(r"(?i)^https?://", clean):
        return f"https://{clean}"
    return clean


def _extract_contact(preamble: list[str]) -> dict[str, str]:
    fragments = _contact_fragments(preamble)
    contact = {"name": "", "name_first": "", "name_last": "", "suffix": "", "phone": "", "city": "", "state": "", "email": "", "linkedin": "", "site": ""}

    for fragment in fragments:
        email = EMAIL_RE.search(fragment)
        if email and not contact["email"]:
            contact["email"] = email.group(0)

        phone = PHONE_RE.search(fragment)
        if phone and not contact["phone"]:
            contact["phone"] = _clean_phone_value(phone.group(0))

        linked = LINKEDIN_RE.search(fragment)
        if linked and not contact["linkedin"]:
            contact["linkedin"] = _normalize_link(linked.group(0))

        location = LOCATION_RE.match(_clean_contact_value(fragment))
        if location and location.group("state").upper() in STATE_CODES and not contact["city"]:
            contact["city"] = location.group("city").strip()
            contact["state"] = location.group("state").upper()

        if not contact["site"]:
            site = next((candidate for candidate in URL_RE.findall(fragment)
                         if "linkedin.com/" not in candidate.lower()), "")
            if not site:
                site = next((candidate for candidate in BARE_SITE_RE.findall(fragment)
                             if "linkedin.com/" not in candidate.lower()), "")
            if site:
                contact["site"] = _normalize_link(site)

    for fragment in fragments:
        if not contact["name"] and _looks_like_name(fragment):
            contact.update(_name_parts(fragment))
            break
    return contact


def _extract_credentials(lines: list[str]) -> str:
    """Collect professional credential lines for the single ``[cred]`` field."""
    values: list[str] = []
    seen: set[str] = set()
    for line in lines[:30]:
        clean = _strip_bullet(line)
        if not clean or not CERTIFICATION_RE.search(clean):
            continue
        key = clean.lower()
        if key not in seen:
            seen.add(key)
            values.append(clean)
    return " | ".join(values[:8])


def _extract_skills(lines: list[str]) -> list[str]:
    skills: list[str] = []
    seen: set[str] = set()
    for line in lines[:30]:
        clean = _strip_bullet(line)
        if ":" in clean:
            _, payload = clean.split(":", 1)
        else:
            payload = clean
        payload = payload.strip(" |")
        for part in re.split(r"[,;|•]+", payload):
            skill = re.sub(r"\s+", " ", part).strip(" -–—")
            if not 1 < len(skill) <= 80:
                continue
            key = skill.lower()
            if key not in seen:
                seen.add(key)
                skills.append(skill)
    return skills[:40]


DEGREE_LEVEL_RE = re.compile(
    r"\b(?P<level>"
    r"(?:associate|bachelor|master)(?:'s)?(?:\s+of\s+(?:arts|science|fine arts|applied science|business administration|engineering|education|technology))?(?:\s+degree)?"
    r"|(?:doctorate|doctoral|ph\.?\s*d\.?|mba|m\.?\s*b\.?\s*a\.?|j\.?\s*d\.?|m\.?\s*d\.?|b\.?\s*s\.?|b\.?\s*a\.?|m\.?\s*s\.?|m\.?\s*a\.?|a\.?\s*s\.?)"
    r")\b",
    re.I,
)
EDUCATION_SCHOOL_RE = re.compile(r"\b(?:university|college|institute|school)\b", re.I)
EDUCATION_MAJOR_RE = re.compile(r"\b(?:major|field\s+of\s+study|concentration)\s*[:\-]\s*([^|;]+)", re.I)
EDUCATION_MINOR_RE = re.compile(r"\bminor\s*[:\-]\s*([^|;]+)", re.I)
EDUCATION_IN_PROGRESS_RE = re.compile(
    r"\b(?:in\s+progress|in-progress|pursuing|candidate|expected|anticipated|currently\s+enrolled|ongoing)\b",
    re.I,
)
EDUCATION_FINISHED_RE = re.compile(r"\b(?:completed|graduated|awarded|earned)\b", re.I)
EDUCATION_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")


def _education_has_level(value: str) -> bool:
    return bool(DEGREE_LEVEL_RE.search(value or ""))


def _clean_education_value(value: str) -> str:
    clean = _strip_bullet(value)
    clean = re.sub(r"\b(?:major|field\s+of\s+study|concentration|minor|degree|school|status|date)\s*[:\-]\s*", "", clean, flags=re.I)
    clean = re.sub(r"\s*[\[(]?(?:19|20)\d{2}[\])]?(?=\s*(?:$|\||;))", "", clean)
    clean = re.sub(r"\s+", " ", clean).strip(" |,;:-–—")
    return clean


def _education_status(value: str, date: str) -> str:
    if EDUCATION_IN_PROGRESS_RE.search(value or ""):
        return "in progress"
    if EDUCATION_FINISHED_RE.search(value or ""):
        return "finished"
    if date:
        return "in progress" if int(date) > datetime.now().year else "finished"
    return "finished"


def _education_entry(lines: list[str]) -> ResumeEducation:
    text = " | ".join(line for line in lines if line).strip()
    parts = [part.strip() for part in re.split(r"\s*\|\s*", text) if part.strip()]
    degree_match = DEGREE_LEVEL_RE.search(text)
    level = ""
    if degree_match:
        level = degree_match.group("level").strip()
        abbreviation = re.match(r"\s*(\([^)]{1,30}\))", text[degree_match.end():])
        if abbreviation:
            level = f"{level} {abbreviation.group(1)}"

    school = ""
    for part in parts:
        if EDUCATION_SCHOOL_RE.search(part) and not DEGREE_LEVEL_RE.search(part):
            school = _clean_education_value(part)
            break
    if not school and degree_match:
        prefix = text[:degree_match.start()].strip(" |,:;-–—")
        if prefix:
            school = _clean_education_value(prefix)
    if not school:
        school_part = next((part for part in parts if EDUCATION_SCHOOL_RE.search(part)), "")
        school = _clean_education_value(school_part)

    minor_match = EDUCATION_MINOR_RE.search(text)
    minor = _clean_education_value(minor_match.group(1)) if minor_match else ""
    major_match = EDUCATION_MAJOR_RE.search(text)
    major = _clean_education_value(major_match.group(1)) if major_match else ""

    if degree_match:
        level_end = degree_match.end()
        abbreviation = re.match(r"\s*(\([^)]{1,30}\))", text[level_end:])
        if abbreviation:
            level_end += abbreviation.end()
        if " in " in level.lower():
            level, in_major = re.split(r"\s+in\s+", level, maxsplit=1, flags=re.I)
            major = major or _clean_education_value(in_major)
        remainder = text[level_end:]
        if not major:
            for candidate in re.split(r"\s*\|\s*|\s*;\s*", remainder):
                candidate = candidate.strip(" :,-–—")
                if not candidate or re.match(r"^(?:minor|degree|status|date)\s*[:\-]", candidate, re.I):
                    continue
                if re.fullmatch(r"(?:19|20)\d{2}", candidate):
                    continue
                candidate = re.sub(r"^in\s+", "", candidate, flags=re.I)
                major = _clean_education_value(candidate)
                if major:
                    break

    date_matches = EDUCATION_YEAR_RE.findall(text)
    date = date_matches[-1] if date_matches else ""
    return ResumeEducation(
        level=_clean_education_value(level),
        school=school,
        major=major,
        minor=minor,
        status=_education_status(text, date),
        date=date,
    )


def _extract_education(lines: list[str]) -> list[ResumeEducation]:
    entries: list[list[str]] = []
    current: list[str] = []
    for line in lines[:30]:
        clean = _strip_bullet(line)
        if not clean:
            continue
        is_institution = bool(EDUCATION_SCHOOL_RE.search(clean))
        if is_institution and current and _education_has_level(" | ".join(current)) \
                and any(EDUCATION_SCHOOL_RE.search(item) for item in current):
            entries.append(current)
            current = [clean]
        else:
            current.append(clean)
    if current:
        entries.append(current)
    return [entry for entry in (_education_entry(lines) for lines in entries) if any(
        getattr(entry, field) for field in ("level", "school", "major", "minor", "status", "date")
    )][:12]


CLEARANCE_LEVEL_RE = re.compile(
    r"\b(?P<level>"
    r"top\s+secret(?:\s*[/\-]\s*(?:sci|sensitive\s+compartmented\s+information))?"
    r"|ts\s*[/\-\s]\s*sci"
    r"|public\s+trust"
    r"|sensitive\s+compartmented\s+information"
    r"|secret"
    r"|confidential"
    r"|sci"
    r"|(?:q|l)(?=\s+clearance)"
    r")\b(?:\s+clearance)?",
    re.I,
)
CLEARANCE_AGENCY_RE = re.compile(
    r"\b(?:agency|sponsor|sponsoring\s+agency|issued\s+(?:by|through)|"
    r"adjudicated\s+(?:by|through)|granted\s+(?:by|through)|held\s+(?:by|through))"
    r"\s*[:\-]?\s*(?P<agency>[A-Za-z0-9][^,;|\[\]\n]*)",
    re.I,
)
CLEARANCE_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
CLEARANCE_STATUS_PATTERNS = (
    ("processing", re.compile(r"\b(?:processing|in\s+process|pending|under\s+review|submitted|adjudication\s+pending)\b", re.I)),
    ("expired", re.compile(r"\b(?:expired|inactive|revoked|lapsed|suspended|denied|cancelled|canceled)\b", re.I)),
    ("active", re.compile(r"\b(?:active|current|valid|unexpired|granted|adjudicated)\b", re.I)),
)


def _normalize_clearance_level(value: str) -> str:
    clean = re.sub(r"\s+", " ", (value or "")).strip().lower()
    clean = re.sub(r"\s+clearance$", "", clean)
    if re.search(r"(?:top\s+secret.*(?:sci|sensitive\s+compartmented)|ts\s*[/\-\s]\s*sci)", clean):
        return "TS/SCI"
    if clean.startswith("top secret"):
        return "Top Secret"
    if clean.startswith("public trust"):
        return "Public Trust"
    if "sensitive compartmented" in clean or clean == "sci":
        return "SCI"
    if clean.startswith("secret"):
        return "Secret"
    if clean.startswith("confidential"):
        return "Confidential"
    if clean in {"q", "l"}:
        return clean.upper()
    return (value or "").strip()


def _clean_clearance_agency(value: str) -> str:
    clean = _strip_bullet(value)
    clean = re.sub(
        r"^\s*(?:agency|sponsor|sponsoring\s+agency|issued\s+(?:by|through)|"
        r"adjudicated\s+(?:by|through)|granted\s+(?:by|through)|held\s+(?:by|through))\s*[:\-]?\s*",
        "",
        clean,
        flags=re.I,
    )
    clean = re.split(
        r"\s*(?:\[|\||;|,?\s+(?:as\s+of|status|date|issued|expires?)\b|"
        r",?\s+(?:in|on)\s+(?:(?:0?[1-9]|1[0-2])[/.-])?(?:19|20)\d{2}\b)",
        clean,
        maxsplit=1,
        flags=re.I,
    )[0]
    return re.sub(r"\s+", " ", clean).strip(" .,:;–—-")


def _clearance_status(value: str) -> str:
    for status, pattern in CLEARANCE_STATUS_PATTERNS:
        if pattern.search(value or ""):
            return status
    return ""


def _clearance_entry(value: str) -> ResumeClearance:
    text = " ".join(_strip_bullet(value).split())
    level_match = CLEARANCE_LEVEL_RE.search(text)
    agency_match = CLEARANCE_AGENCY_RE.search(text)
    years = CLEARANCE_YEAR_RE.findall(text)
    return ResumeClearance(
        level=_normalize_clearance_level(level_match.group("level") if level_match else ""),
        agency=_clean_clearance_agency(agency_match.group("agency")) if agency_match else "",
        date=years[-1] if years else "",
        status=_clearance_status(text),
    )


def _extract_clearances(lines: list[str]) -> list[ResumeClearance]:
    entries: list[ResumeClearance] = []
    seen: set[tuple[str, str, str, str]] = set()
    for line in lines[:30]:
        clean = _strip_bullet(line)
        if not clean:
            continue
        parts = [clean]
        candidate_parts = [part.strip() for part in re.split(r"[;|]", clean) if part.strip()]
        if len(candidate_parts) > 1 and sum(bool(CLEARANCE_LEVEL_RE.search(part)) for part in candidate_parts) >= 2:
            parts = candidate_parts
        for part in parts:
            entry = _clearance_entry(part)
            key = (entry.level.lower(), entry.agency.lower(), entry.date, entry.status)
            if not any((entry.level, entry.agency, entry.date, entry.status)) or key in seen:
                continue
            seen.add(key)
            entries.append(entry)
    return entries[:20]


def _extract_simple_items(lines: list[str], matcher: re.Pattern[str] | None = None) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for line in lines[:30]:
        clean = _strip_bullet(line)
        if not clean:
            continue
        parts = [clean]
        if matcher and ("," in clean or ";" in clean):
            candidate_parts = [part.strip() for part in re.split(r"[;,]", clean) if part.strip()]
            if sum(1 for part in candidate_parts if matcher.search(part)) >= 2:
                parts = candidate_parts
        for part in parts:
            key = part.lower()
            if key not in seen:
                seen.add(key)
                items.append(part)
    return items[:20]


def _target_title(preamble: list[str], jobs: list[JobBlock]) -> str:
    target_rx = re.compile(
        r"^(?:target(?:ed)?\s+(?:position|role|title)|desired\s+(?:position|role))\s*[:\-]\s*(.+)$",
        re.I,
    )
    for line in preamble[:15]:
        match = target_rx.match(_strip_bullet(line))
        if match:
            candidate = classify_title(match.group(1))
            if candidate.kind == "title":
                return candidate.text
    return jobs[0].title if jobs else ""


class ResumeParserPipeline:
    """Layout-aware deterministic resume extraction pipeline.

    Input formatting is treated as evidence, not a requirement. The pipeline
    supports ATS-style text as well as older Word/PDF resumes that use tabs,
    manual line breaks, combined headings, punctuated acronyms, and labeled
    Title:/Contract: fields.
    """

    version = PARSER_VERSION

    def parse(self, text: str) -> ResumeExtractionResponse:
        preamble, sections = _resume_sections(text)
        jobs = extract_jobs(sections["experience"])

        response_jobs = [
            ResumeJob(
                number=index,
                job=job.title,
                company=job.company,
                date_range=job.date_range,
                descriptions=job.descriptions,
            )
            for index, job in enumerate(jobs, start=1)
        ]

        return ResumeExtractionResponse(
            **_extract_contact(preamble),
            cred=_extract_credentials(preamble + sections["certifications"]),
            target_position_title=_target_title(preamble, jobs),
            executive_summary=_extract_summary(sections["executive_summary"]),
            skills=_extract_skills(sections["skills"]),
            experience=response_jobs,
            education=_extract_education(sections["education"]),
            clearances=_extract_clearances(sections["clearances"]),
            certifications=_extract_simple_items(sections["certifications"], CERTIFICATION_RE),
        )

    def status(self) -> dict:
        return {
            "version": self.version,
            "stages": [
                "ingest", "normalize", "section-detect", "classify", "link", "validate", "output"
            ],
            "layout_aware": True,
            "supports": [
                "ats-text", "docx-tabs", "docx-manual-breaks", "docx-tables", "pdf-layout-text",
                "compound-headings", "numeric-date-ranges", "labeled-title-fields",
                "structural-job-boundaries", "dotted-acronyms",
            ],
            "classifier": classifier.status(),
        }


pipeline = ResumeParserPipeline()
