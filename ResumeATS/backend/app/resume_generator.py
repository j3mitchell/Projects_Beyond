"""Source-preserving resume tailoring, independent of job-page extraction.

Rank bullets within their original contiguous group so evidence never moves
between employers. Unrecognized content stays in place rather than being lost
through a lossy parse/reconstruction cycle.
"""
from __future__ import annotations

import re


def contains_term(text: str, term: str) -> bool:
    return bool(term.strip() and re.search(
        r"(?<!\w)" + re.escape(term.strip()) + r"(?!\w)", text, re.I
    ))


def generate_resume(text: str, analysis: dict) -> dict:
    skills = [item for item in analysis.get("skills", []) if item.get("name")]
    terms = list(dict.fromkeys(item["name"] for item in skills))
    keywords = [{"keyword": term, "status": "present" if contains_term(text, term) else "review"}
                for term in terms]
    if not text.strip():
        return {"preview": "", "keywords": keywords, "changes": []}

    # Only literal source matches affect ordering; a taxonomy alias must not
    # imply that a candidate has a specific language or vendor qualification.
    def score(line: str) -> int:
        return sum(contains_term(line, term) for term in terms)

    lines = [line.rstrip() for line in text.strip().splitlines()]
    changes = []
    index = 0
    while index < len(lines):
        if not re.match(r"^\s*[•●▪*\-]\s+\S", lines[index]):
            index += 1
            continue
        end = index + 1
        while end < len(lines) and re.match(r"^\s*[•●▪*\-]\s+\S", lines[end]):
            end += 1
        # A following prose line may continue the last bullet. Preserve that
        # group until the source supplies an unambiguous boundary.
        if end == len(lines) or not lines[end].strip():
            original = lines[index:end]
            ranked = sorted(original, key=lambda line: -score(line))
            if ranked != original:
                lines[index:end] = ranked
                changes.append("Prioritized job-relevant bullets within their source section.")
        index = end
    return {"preview": "\n".join(lines), "keywords": keywords,
            "changes": list(dict.fromkeys(changes))}
