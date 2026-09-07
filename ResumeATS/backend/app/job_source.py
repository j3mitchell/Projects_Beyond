"""Bounded public job-page fetching and deterministic/AI job analysis."""
from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
from urllib.parse import urljoin, urlsplit

import requests
import urllib3
from bs4 import BeautifulSoup
import certifi
from fastapi import HTTPException

MAX_PAGE_BYTES = 2 * 1024 * 1024
MAX_ANALYSIS_TEXT = 30000

# Deterministic mode is intentionally small, explicit, and explainable. Each
# alias is matched against extracted page text and contributes to the ranking.
INDUSTRY_TAXONOMY = {
    "technology": ("software", "cloud", "saas", "database", "python", "javascript", "devops", "cybersecurity", "api", "data engineering"),
    "finance": ("banking", "financial", "investment", "accounting", "fintech", "risk management", "capital markets"),
    "healthcare": ("clinical", "healthcare", "hospital", "patient", "medical", "pharmacy", "health services"),
    "government": ("federal", "government", "public sector", "clearance", "dod", "defense", "agency"),
    "education": ("school", "university", "college", "student", "academic", "education"),
    "retail": ("retail", "ecommerce", "e-commerce", "merchandising", "store operations", "consumer goods"),
    "manufacturing": ("manufacturing", "production", "factory", "plant operations", "lean", "supply chain"),
}

SKILL_TAXONOMY = {
    "Python": ("python",),
    "JavaScript": ("javascript", "js", "node.js", "nodejs"),
    "SQL": ("sql", "postgresql", "mysql", "database"),
    "Cloud": ("cloud", "aws", "azure", "gcp", "google cloud"),
    "Docker": ("docker", "containerization", "containers"),
    "Kubernetes": ("kubernetes", "k8s"),
    "DevOps": ("devops", "ci/cd", "continuous integration", "continuous delivery"),
    "Cybersecurity": ("cybersecurity", "information security", "security operations", "soc"),
    "Data Analysis": ("data analysis", "analytics", "data visualization", "business intelligence"),
    "Project Management": ("project management", "program management", "agile", "scrum"),
    "Leadership": ("leadership", "people management", "team lead", "mentoring"),
    "Communication": ("communication", "stakeholder management", "presentation", "written communication"),
    "Risk Management": ("risk management", "risk assessment", "compliance", "controls"),
}


def public_target(url: str):
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError()
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if port not in {80, 443}:
            raise ValueError()
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        ips = {item[4][0] for item in addresses}
        if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
            raise ValueError()
        return parsed, port, sorted(ips)[0]
    except (ValueError, OSError):
        raise HTTPException(400, "Use a public HTTP or HTTPS job URL, or paste the job description.")


def fetch_public_html(url: str) -> bytes:
    for _ in range(5):
        parsed, port, address = public_target(url)
        options = {"host": address, "port": port, "timeout": urllib3.Timeout(connect=5, read=10), "retries": False,
                   "ca_certs": certifi.where()}
        pool = (urllib3.HTTPSConnectionPool(**options, server_hostname=parsed.hostname, assert_hostname=parsed.hostname)
                if parsed.scheme == "https" else urllib3.HTTPConnectionPool(**options))
        response = None
        try:
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            response = pool.urlopen("GET", path, headers={"Host": parsed.netloc, "User-Agent": "ResumeATS/1.0", "Accept-Encoding": "identity"}, redirect=False, preload_content=False)
            if response.status in {301, 302, 303, 307, 308}:
                url = urljoin(url, response.headers.get("Location", ""))
                continue
            if response.status != 200:
                raise HTTPException(400, "This job site blocked the request. Paste the job description instead.")
            raw = response.read(MAX_PAGE_BYTES + 1, decode_content=True)
            if len(raw) > MAX_PAGE_BYTES:
                raise HTTPException(400, "The job page is too large. Paste the job description instead.")
            return raw
        except urllib3.exceptions.HTTPError:
            raise HTTPException(400, "Unable to load this job page. Paste the job description instead.")
        finally:
            if response is not None:
                response.close()
            pool.close()
    raise HTTPException(400, "This job page redirects too many times. Paste the job description instead.")


def _page_fields(raw: bytes, source_url: str = "", iframe_depth: int = 0) -> dict:
    soup = BeautifulSoup(raw, "html.parser")
    metadata: dict[str, str] = {}
    for key, selector, attribute in (
        ("site_name", {"property": "og:site_name"}, "content"),
        ("og_title", {"property": "og:title"}, "content"),
        ("og_description", {"property": "og:description"}, "content"),
        ("description", {"name": "description"}, "content"),
        ("canonical", {"rel": "canonical"}, "href"),
    ):
        element = soup.find("meta", attrs=selector) if key != "canonical" else soup.find("link", attrs=selector)
        value = element.get(attribute, "").strip() if element else ""
        if value:
            metadata[key] = value[:1000]
    embedded_url = ""
    iframe = soup.find("iframe", id="noscript_icims_content_iframe") or soup.find("iframe", src=re.compile(r"(?:[?&])in_iframe=1\b", re.I))
    if iframe and iframe.get("src"):
        embedded_url = urljoin(source_url, iframe["src"])

    structured: dict[str, object] = {}
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            payload = json.loads(script.string or script.get_text())
        except (TypeError, json.JSONDecodeError):
            continue
        candidates = payload if isinstance(payload, list) else payload.get("@graph", []) if isinstance(payload, dict) else []
        if isinstance(payload, dict) and payload.get("@type"):
            candidates = [payload, *candidates]
        for candidate in candidates if isinstance(candidates, list) else []:
            if not isinstance(candidate, dict):
                continue
            types = candidate.get("@type", [])
            types = types if isinstance(types, list) else [types]
            if "JobPosting" in types:
                structured = candidate
                break
        if structured:
            break

    structured_title = str(structured.get("title", "")).strip()
    structured_company = structured.get("hiringOrganization", {})
    if isinstance(structured_company, dict):
        structured_company = str(structured_company.get("name", "")).strip()
    else:
        structured_company = str(structured_company or "").strip()
    structured_description = str(structured.get("description", "")).strip()
    if structured_title:
        metadata["structured_title"] = structured_title[:200]
    if structured_company:
        metadata["structured_company"] = structured_company[:200]
    if embedded_url and iframe_depth < 2 and embedded_url != source_url:
        return _page_fields(fetch_public_html(embedded_url), source_url, iframe_depth + 1)

    page_title = soup.title.get_text(" ", strip=True) if soup.title else ""
    heading = soup.find("h1", class_=lambda value: value and "listing-company" in value)
    heading_text = heading.get_text(" ", strip=True) if heading else ""

    title = structured_title or "Job Opportunity"
    company = structured_company
    if not structured_title:
        for identity in (metadata.get("og_title", ""), page_title, heading_text):
            match = re.search(r"^Job:\s*(?P<title>.+?)\s+at\s+(?P<company>.+?)$", identity, re.IGNORECASE)
            if match:
                title = match.group("title").strip()
                company = match.group("company").strip()
                break
            match = re.match(r"^(?P<title>[^|]+?),\s*(?P<company>[^|]+?)\s*\|", identity)
            if match:
                title = match.group("title").strip()
                company = match.group("company").strip()
                break

    for element in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        element.decompose()
    if title == "Job Opportunity":
        heading = soup.find("h1") or soup.title
        heading_text = heading.get_text(" ", strip=True) if heading else ""
        if heading_text and heading_text.lower() not in {"get exploring!", "job opportunity"}:
            title = heading_text
    company = company or metadata.get("site_name", "")
    content_root = soup.find("main") or soup.select_one(".iCIMS_JobContent") or soup
    description = content_root.get_text(" ", strip=True)[:MAX_ANALYSIS_TEXT]
    if structured_description:
        structured_text = BeautifulSoup(f"<div>{structured_description}</div>", "html.parser").get_text(" ", strip=True)
        if len(structured_text) >= 100:
            description = structured_text[:MAX_ANALYSIS_TEXT]
    if len(description) < 100:
        raise HTTPException(400, "No readable job description was found. Paste it instead.")
    return {"source_url": source_url, "title": title or "Job Opportunity", "company": company,
            "summary": description, "raw_text": description, "metadata": metadata}


def _match_terms(text: str, terms: tuple[str, ...]) -> list[str]:
    lowered = text.lower()
    return [term for term in terms if re.search(r"(?<!\w)" + re.escape(term.lower()) + r"(?!\w)", lowered)]


def _rank_taxonomy_skills(text: str) -> list[dict]:
    lowered = text.lower()
    ranked = []
    for name, aliases in SKILL_TAXONOMY.items():
        matches = _match_terms(text, aliases)
        occurrences = sum(len(re.findall(r"(?<!\w)" + re.escape(term.lower()) + r"(?!\w)", lowered)) for term in matches)
        if occurrences:
            ranked.append({"name": name, "score": float(min(100, occurrences * 20)), "evidence": matches, "source": "taxonomy"})
    ranked.sort(key=lambda item: (-item["score"], item["name"]))
    return ranked[:20]


def _infer_industry(text: str) -> str:
    candidates = []
    for industry, terms in INDUSTRY_TAXONOMY.items():
        matches = _match_terms(text, terms)
        if matches:
            candidates.append((len(matches), industry))
    return max(candidates, default=(0, "general"))[1]


def _normalise_ai_result(content: object, page: dict) -> dict:
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except json.JSONDecodeError as exc:
            raise HTTPException(502, "The AI provider returned invalid job analysis JSON.") from exc
    if not isinstance(content, dict):
        raise HTTPException(502, "The AI provider returned an invalid job analysis object.")
    skills = []
    raw_skills = content.get("skills", [])
    for item in raw_skills[:20] if isinstance(raw_skills, list) else []:
        if isinstance(item, str):
            skills.append({"name": item[:120], "score": 50.0, "evidence": [], "source": "ai"})
        elif isinstance(item, dict) and str(item.get("name", "")).strip():
            try:
                score = float(item.get("score", 50))
            except (TypeError, ValueError):
                score = 50.0
            evidence = item.get("evidence", [])
            skills.append({"name": str(item["name"]).strip()[:120], "score": max(0.0, min(100.0, score)),
                           "evidence": [str(value)[:300] for value in evidence if value][:5] if isinstance(evidence, list) else [], "source": "ai"})
    return {"mode": "ai", "source_url": page.get("source_url", ""),
            "title": str(content.get("title") or page.get("title") or "Job Opportunity")[:200],
            "company": str(content.get("company") or page.get("company") or "")[:200],
            "industry": str(content.get("industry") or "general")[:100],
            "summary": str(content.get("summary") or page.get("summary") or "")[:MAX_ANALYSIS_TEXT],
            "raw_text": page.get("raw_text", "")[:MAX_ANALYSIS_TEXT],
            "metadata": page.get("metadata", {}), "skills": skills}


def _ai_analyze(page: dict) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "AI job analysis is not configured. Set OPENAI_API_KEY on the backend or choose Deterministic.")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    schema = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "title": {"type": "string"}, "company": {"type": "string"}, "industry": {"type": "string"},
            "summary": {"type": "string"}, "skills": {"type": "array", "items": {"type": "object", "additionalProperties": False, "properties": {"name": {"type": "string"}, "score": {"type": "number"}, "evidence": {"type": "array", "items": {"type": "string"}}}, "required": ["name", "score", "evidence"]}},
        }, "required": ["title", "company", "industry", "summary", "skills"],
    }
    prompt = ("Analyze this job page. Infer the most likely industry and rank the required or preferred skills by relevance. "
              "Return only the requested JSON fields; score each skill from 0 to 100 and include short evidence phrases.\n\n"
              f"Page metadata: {json.dumps(page.get('metadata', {}), ensure_ascii=False)}\n"
              f"Page text:\n{page.get('raw_text', '')[:MAX_ANALYSIS_TEXT]}")
    payload = {"model": model, "temperature": 0.1,
               "response_format": {"type": "json_schema", "json_schema": {"name": "job_analysis", "strict": True, "schema": schema}},
               "messages": [{"role": "system", "content": "You extract job information into accurate structured JSON."}, {"role": "user", "content": prompt}]}
    try:
        response = requests.post(f"{base_url}/chat/completions", headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json=payload, timeout=30)
        response.raise_for_status()
        body = response.json()
        content = body["choices"][0]["message"]["content"]
    except (requests.RequestException, KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(502, "The AI provider could not analyze this job page.") from exc
    return _normalise_ai_result(content, page)


def analyze_job_text(description: str, mode: str = "deterministic") -> dict:
    if len(description.strip()) < 100:
        raise HTTPException(400, "Paste at least 100 characters of the job description.")
    page = {"source_url": "", "title": "Target Role", "company": "", "summary": description.strip()[:MAX_ANALYSIS_TEXT],
            "raw_text": description.strip()[:MAX_ANALYSIS_TEXT], "metadata": {}}
    if mode == "ai":
        return _ai_analyze(page)
    if mode != "deterministic":
        raise HTTPException(400, "Choose Deterministic or AI job analysis.")
    page.update({"mode": "deterministic", "industry": _infer_industry(page["raw_text"]), "skills": _rank_taxonomy_skills(page["raw_text"])})
    return page


def analyze_job(url: str, mode: str = "deterministic") -> dict:
    if mode not in {"deterministic", "ai"}:
        raise HTTPException(400, "Choose Deterministic or AI job analysis.")
    page = _page_fields(fetch_public_html(url), url)
    if mode == "ai":
        return _ai_analyze(page)
    page.update({"mode": "deterministic", "industry": _infer_industry(page["raw_text"]), "skills": _rank_taxonomy_skills(page["raw_text"])})
    return page


def extract_job(url: str) -> tuple[str, str, str]:
    """Backward-compatible tuple API for callers that only need core fields."""
    analysis = analyze_job(url, "deterministic")
    return analysis["title"], analysis["company"], analysis["summary"]
