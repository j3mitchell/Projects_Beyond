"""Full-length, source-backed requirements kept separate from display snippets."""
from __future__ import annotations

import re


HEADINGS = {
    "required": ("requirements", "qualifications", "basic qualifications", "minimum qualifications",
                 "required qualifications", "required skills", "minimum skills", "must have",
                 "what you'll bring", "what you bring", "what you need", "credentials",
                 "education", "education requirements", "certifications", "licenses", "security clearance"),
    "preferred": ("preferred qualifications", "preferred skills", "desired qualifications",
                  "nice to have", "bonus points"),
    "responsibility": ("responsibilities", "key responsibilities", "duties", "essential duties",
                       "essential functions", "what you'll do", "your impact"),
    "exclude": ("benefits", "compensation", "salary", "pay range", "about us",
                "equal opportunity", "how to apply", "working conditions", "disclaimer"),
}


def extract_requirements(text: str) -> list[dict[str, str]]:
    records = []
    seen = set()
    section = ""
    for raw in text.splitlines():
        line = re.sub(r"^[\s•●▪*\-]+", "", raw).strip()
        if not line:
            continue
        heading, separator, rest = line.partition(":")
        normalized = re.sub(r"[^a-z0-9]+", " ", heading.casefold()).strip()
        category = next((kind for kind, names in HEADINGS.items()
                         if normalized in {re.sub(r"[^a-z0-9]+", " ", name).strip() for name in names}), None)
        if category:
            section = category
            if not separator or not rest.strip():
                continue
            line = rest.strip()
        if section == "exclude":
            continue
        kind = section
        if re.search(r"\b(?:preferred|nice to have|a plus|desirable)\b", line, re.I):
            kind = "preferred"
        elif re.search(r"\b(?:must|required|minimum)\b", line, re.I):
            kind = "required"
        if kind not in {"required", "preferred", "responsibility"}:
            continue
        key = (kind, line.casefold())
        if key not in seen:
            records.append({"kind": kind, "text": line, "evidence": raw.strip()})
            seen.add(key)
    return records
