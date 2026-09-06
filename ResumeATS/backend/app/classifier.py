from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any

import requests
import spacy

from app.organization_aliases import ORGANIZATION_ALIASES, organization_alias_match

ONET_RELEASE = "31.0"
ONET_BASE = "https://www.onetcenter.org/dl_files/database/db_31_0_json"
ONET_FILES = {
    "occupation_data": f"{ONET_BASE}/occupation_data.json",
    "job_titles": f"{ONET_BASE}/job_titles.json",
    "reported_titles": f"{ONET_BASE}/sample_of_reported_titles.json",
}

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / f"onet_{ONET_RELEASE.replace('.', '_')}"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

COMPANY_SUFFIX_RE = re.compile(
    r"\b(?:inc\.?|llc|l\.l\.c\.?|corp\.?|corporation|company|co\.?|group|holdings|partners|"
    r"technologies|technology|solutions|services|systems|bank|university|college|agency|commission|"
    r"department|laboratories|labs|institute|foundation|association)\b",
    re.I,
)

PROSE_STARTERS = {
    "administered", "architected", "automated", "built", "collaborated", "configured", "coordinated",
    "created", "deployed", "designed", "developed", "directed", "documented", "drove", "engineered",
    "established", "executed", "implemented", "improved", "integrated", "led", "maintained", "managed",
    "migrated", "modernized", "monitored", "optimized", "partnered", "performed", "provided", "reduced",
    "resolved", "supported", "troubleshot", "upgraded", "delivered", "oversaw", "trained", "installed",
    "assisted", "analyzed", "tested", "secured", "streamlined", "introduced", "supervised", "worked",
}


def normalize_phrase(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9+#./ -]+", " ", value)
    value = re.sub(r"[./_-]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def phrase_variants(value: str) -> set[str]:
    variants = {normalize_phrase(value)}
    if "(" in value and ")" in value:
        before = value.split("(", 1)[0].strip()
        inside = value.split("(", 1)[1].rsplit(")", 1)[0].strip()
        if before:
            variants.add(normalize_phrase(before))
        if inside:
            variants.add(normalize_phrase(inside))
    return {item for item in variants if item}


class ResumeNLPClassifier:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._onet_loaded = False
        self._onet_error = ""
        self._title_index: dict[str, dict[str, str]] = {}
        self._nlp, self.model_name = self._load_spacy()

    @staticmethod
    def _load_spacy():
        try:
            return spacy.load("en_core_web_sm"), "en_core_web_sm"
        except Exception:
            return spacy.blank("en"), "spacy.blank.en"

    def _download_json(self, key: str, url: str) -> dict[str, Any]:
        target = CACHE_DIR / f"{key}.json"
        if target.exists():
            return json.loads(target.read_text(encoding="utf-8"))

        response = requests.get(url, timeout=20)
        response.raise_for_status()
        target.write_bytes(response.content)
        return response.json()

    def ensure_onet_loaded(self) -> None:
        if self._onet_loaded:
            return
        with self._lock:
            if self._onet_loaded:
                return
            try:
                occupation_data = self._download_json("occupation_data", ONET_FILES["occupation_data"])
                job_titles = self._download_json("job_titles", ONET_FILES["job_titles"])
                reported = self._download_json("reported_titles", ONET_FILES["reported_titles"])

                index: dict[str, dict[str, str]] = {}

                for row in occupation_data.get("row", []):
                    title = row.get("title", "")
                    code = row.get("onetsoc_code", "")
                    for variant in phrase_variants(title):
                        index.setdefault(variant, {"soc": code, "canonical": title, "source": "occupation"})

                for row in job_titles.get("row", []):
                    title = row.get("alternate_title") or row.get("job_title") or row.get("title") or ""
                    short = row.get("short_title") or ""
                    code = row.get("onetsoc_code", "")
                    for raw in (title, short):
                        for variant in phrase_variants(raw):
                            index.setdefault(variant, {"soc": code, "canonical": title or short, "source": "job_titles"})

                for row in reported.get("row", []):
                    title = row.get("reported_job_title", "")
                    canonical = row.get("title", title)
                    code = row.get("onetsoc_code", "")
                    for variant in phrase_variants(title):
                        index.setdefault(variant, {"soc": code, "canonical": canonical, "source": "reported"})

                self._title_index = index
                self._onet_error = ""
            except Exception as exc:
                # Resume extraction still works with grammatical rules if O*NET is temporarily unreachable.
                self._onet_error = str(exc)
            finally:
                self._onet_loaded = True

    @staticmethod
    def _looks_like_prose(value: str) -> bool:
        clean = value.strip()
        if not clean:
            return True
        words = re.findall(r"[A-Za-z]+", clean.lower())
        if not words:
            return True
        if words[0] in PROSE_STARTERS:
            return True
        if len(words) > 12:
            return True
        if clean.endswith((".", ";")):
            return True
        return False

    def job_title_match(self, value: str) -> dict[str, Any]:
        clean = value.strip()
        if self._looks_like_prose(clean):
            return {"valid": False, "confidence": 0.0, "source": "prose"}

        self.ensure_onet_loaded()
        normalized = normalize_phrase(clean)
        exact = self._title_index.get(normalized)
        if exact:
            return {"valid": True, "confidence": 0.99, **exact}

        # Parenthetical or punctuation variants are common in O*NET and resumes.
        for variant in phrase_variants(clean):
            exact = self._title_index.get(variant)
            if exact:
                return {"valid": True, "confidence": 0.97, **exact}

        return {"valid": False, "confidence": 0.0, "source": "onet-no-match"}

    def organization_match(self, value: str) -> dict[str, Any]:
        clean = value.strip()
        if not clean or self._looks_like_prose(clean) or len(clean.split()) > 14:
            return {"valid": False, "confidence": 0.0, "source": "prose"}

        alias = organization_alias_match(clean)
        if alias.get("valid"):
            return alias

        # Never classify a known occupational title as an organization.
        title = self.job_title_match(clean)
        if title.get("valid"):
            return {"valid": False, "confidence": 0.0, "source": "job-title"}

        score = 0.0
        source = "no-org-match"
        canonical = clean

        if COMPANY_SUFFIX_RE.search(clean):
            score = max(score, 0.85)
            source = "company-suffix"

        try:
            doc = self._nlp(clean)
            for ent in doc.ents:
                if ent.label_ == "ORG":
                    coverage = len(ent.text.strip()) / max(1, len(clean))
                    if coverage >= 0.55 and score < 0.95:
                        score = 0.95
                        source = "spacy-org"
                    elif score < 0.75:
                        score = 0.75
                        source = "spacy-org-partial"
        except Exception:
            pass

        # Compact title-cased proper-name phrases are plausible organizations,
        # but keep this lower confidence than an ORG entity or company suffix.
        words = clean.split()
        capitalized = sum(1 for word in words if word[:1].isupper() or word.isupper())
        if 1 <= len(words) <= 6 and capitalized >= max(1, len(words) - 1) and score < 0.55:
            score = 0.55
            source = "proper-name"

        return {
            "valid": score >= 0.55,
            "confidence": score,
            "source": source,
            "canonical": canonical,
            "alias": clean,
        }

    def company_score(self, value: str) -> float:
        return float(self.organization_match(value).get("confidence", 0.0))

    def status(self) -> dict[str, Any]:
        return {
            "spacy_model": self.model_name,
            "onet_release": ONET_RELEASE,
            "onet_loaded": self._onet_loaded,
            "onet_titles": len(self._title_index),
            "organization_aliases": len(ORGANIZATION_ALIASES),
            "onet_error": self._onet_error,
        }


classifier = ResumeNLPClassifier()
