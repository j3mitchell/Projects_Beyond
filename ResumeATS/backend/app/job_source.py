"""Bounded public job-page fetching and deterministic/AI job analysis."""
from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
from html import unescape
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
    "Java": ("java", "java/jdk"),
    "SQL": ("sql", "postgresql", "mysql", "database"),
    "Oracle": ("oracle",),
    "ETL": ("etl",),
    "Database Design": ("database design", "database modeling", "relational database architecture"),
    "Data Migration": ("data migration", "data mapping", "data mining", "data transformation"),
    "Unit Testing": ("unit testing", "software unit testing"),
    "Technical Documentation": ("engineering documentation", "technical documentation"),
    "Troubleshooting": ("troubleshooting", "trouble-shooting"),
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

WORK_TYPE_LABELS = {
    "remote": "Remote",
    "telecommute": "Remote",
    "telecommuting": "Remote",
    "work from home": "Remote",
    "hybrid": "Hybrid",
    "on site": "On-Site",
    "onsite": "On-Site",
    "on-site": "On-Site",
    "in office": "On-Site",
}

JOB_SECTION_ENDINGS = (
    "responsibilities", "requirements", "qualifications", "minimum skills", "preferred qualifications",
    "our commitment", "benefits", "working conditions", "pay range", "salary", "compensation",
    "required qualifications", "minimum qualifications", "preferred skills", "required skills", "what you'll bring",
    "what you bring", "details", "security clearance", "application statements", "benefits statement", "eeo",
    "similar roles", "essential functions", "duties",
)


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


def _dom_text_lines(root: BeautifulSoup) -> list[str]:
    """Read semantic block text without depending on an employer's CSS names."""
    lines: list[str] = []
    seen: set[str] = set()
    block_tags = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dt", "dd", "pre"}
    for node in root.find_all([*block_tags, "div", "span"]):
        if node.find_parent(["script", "style", "nav", "footer", "header", "noscript"]):
            continue
        classes = " ".join(node.get("class", [])) if isinstance(node.get("class"), list) else str(node.get("class", ""))
        hint = f"{classes} {node.get('role', '')}"
        is_heading_like = bool(re.search(r"heading|header|section|label|title|description|detail|requirement|qualification|responsib|salary|location|company|employer", hint, re.I))
        if node.name == "span" and not is_heading_like and node.find_parent(list(block_tags)):
            continue
        if node.name == "div" and not is_heading_like and (node.find(list(block_tags)) or node.find(["div", "span"])):
            continue
        text = _compact_text(node.get_text(" ", strip=True))
        key = text.casefold()
        if text and key not in seen:
            lines.append(text)
            seen.add(key)
    return lines


def _dom_job_fields(soup: BeautifulSoup) -> dict[str, str | BeautifulSoup]:
    """Collect common job-page signals using semantic HTML and generic hints."""
    root = (
        soup.find("main")
        or soup.find("article")
        or soup.find(attrs={"role": "main"})
        or soup.select_one('[class*="job-description"], [class*="job-content"], [class*="job-detail"], [class*="job-details"]')
        or soup
    )
    title_node = soup.select_one(
        '[itemprop="title"], [data-job-title], [data-testid*="job-title"], '
        '[class*="job"][class*="title"], [class*="position"][class*="title"], h1'
    )
    company_node = soup.select_one(
        '[itemprop="hiringOrganization"] [itemprop="name"], [itemprop="hiringOrganization"], '
        '[data-company], [data-employer], [class*="company"], [class*="employer"], [id*="company"], [id*="employer"]'
    )
    location_node = soup.select_one(
        '[itemprop="jobLocation"] [itemprop="addressLocality"], [itemprop="jobLocation"], '
        '[data-location], [class*="location"], [id*="location"]'
    )
    lines = _dom_text_lines(root)
    return {
        "title": _compact_text(title_node.get_text(" ", strip=True)) if title_node else "",
        "company": _compact_text(company_node.get_text(" ", strip=True)) if company_node else "",
        "location": _compact_text(location_node.get_text(" ", strip=True)) if location_node else "",
        "text": "\n".join(lines),
        "root": root,
    }


def _page_fields(raw: bytes, source_url: str = "", iframe_depth: int = 0) -> dict:
    soup = BeautifulSoup(raw, "html.parser")
    dom_fields = _dom_job_fields(soup)
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
    # Follow an embedded job document when a platform serves the posting in
    # an iframe. Match generic job/career/embed signals rather than a vendor
    # identifier so the same path works across recruiting providers.
    iframe = soup.find(
        "iframe",
        src=re.compile(r"(?:in_iframe=1|job|career|recruit|posting|apply)", re.I),
    )
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

    title = structured_title or str(dom_fields.get("title") or "") or "Job Opportunity"
    company = structured_company
    if not company:
        company = str(dom_fields.get("company") or "")
    if not structured_title:
        for identity in (metadata.get("og_title", ""), page_title):
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
        if not company and page_title and str(dom_fields.get("title") or ""):
            prefix_match = re.match(r"^(?P<company>[^|–—-]+?)\s+[–—-]\s+", page_title)
            if prefix_match:
                company = _compact_text(prefix_match.group("company"))

    for element in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        element.decompose()
    if title == "Job Opportunity":
        heading = soup.find("h1") or soup.title
        heading_text = heading.get_text(" ", strip=True) if heading else ""
        if heading_text and heading_text.lower() not in {"get exploring!", "job opportunity"}:
            title = heading_text
    company = company or metadata.get("site_name", "")
    dom_text = str(dom_fields.get("text") or "")
    description = dom_text[:MAX_ANALYSIS_TEXT]
    structured_text = ""
    if structured_description:
        # Several career platforms HTML-escape the JSON-LD description. Decode
        # it before parsing, otherwise the section headings and list items are
        # returned as one literal HTML line.
        structured_text = BeautifulSoup(f"<div>{unescape(structured_description)}</div>", "html.parser").get_text("\n", strip=True)
        if len(structured_text) >= 100:
            description = structured_text[:MAX_ANALYSIS_TEXT]
    elif len(structured_text) >= 100:
        description = structured_text[:MAX_ANALYSIS_TEXT]
    if not structured_text:
        structured_text = dom_text
    if dom_fields.get("location"):
        metadata["dom_location"] = str(dom_fields["location"])[:200]
    if len(description) < 100:
        raise HTTPException(400, "No readable job description was found. Paste it instead.")
    # Keep visible page text available for fields that vendors omit from
    # JSON-LD, especially salary and workplace details.
    visible_text = dom_text[:MAX_ANALYSIS_TEXT]
    field_text = "\n".join(value for value in (structured_text, visible_text) if value)
    job_fields = _extract_job_fields(structured, structured_text, field_text, metadata)
    return {"source_url": source_url, "title": title or "Job Opportunity", "company": company,
            "summary": description, "raw_text": field_text[:MAX_ANALYSIS_TEXT], "metadata": metadata, **job_fields}


def _compact_text(value: object) -> str:
    raw = unescape(str(value or ""))
    clean = BeautifulSoup(raw, "html.parser").get_text(" ", strip=True) if "<" in raw and ">" in raw else raw
    return re.sub(r"\s+", " ", clean).strip()


def _unique_list(value: object, limit: int = 30) -> list[str]:
    if isinstance(value, str):
        candidates = re.split(r"\s*\n\s*|\s*[•▪‣]\s*|\s*;\s*", value)
    elif isinstance(value, (list, tuple, set)):
        candidates = list(value)
    else:
        candidates = []
    result: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        clean = re.sub(r"^(?:[-–—•▪‣*]\s*)+", "", _compact_text(candidate)).strip()
        key = clean.casefold()
        if clean and key not in seen:
            result.append(clean[:1000])
            seen.add(key)
        if len(result) >= limit:
            break
    return result


def _under_word_limit(value: object, maximum: int = 9) -> str:
    clean = _compact_text(value)
    words = clean.split()
    if len(words) <= maximum:
        return clean
    return " ".join(words[:maximum]).rstrip(" ,;:") + "…"


def _short_list(value: object, maximum: int = 6) -> list[str]:
    shortened = [_under_word_limit(item, maximum) for item in _unique_list(value)]
    return _unique_list(shortened)


def _normalise_pay_term(value: object) -> str:
    clean = _compact_text(value)
    if not clean or re.search(r"\b(?:commission|intern)\b", clean, re.I):
        return clean
    if re.search(r"(?:–|—|-|\bto\b)", clean) and not re.search(r"(?:/|\bper\b)\s*(?:hour|hr|week|month|year|yr)\b", clean, re.I):
        return f"{clean} / yr"
    return clean


def _normalised_heading(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def _heading_matches(value: str, patterns: tuple[str, ...]) -> bool:
    heading = _normalised_heading(value)
    return any(
        heading == _normalised_heading(pattern)
        or heading.startswith(_normalised_heading(pattern) + " ")
        for pattern in patterns
    )


def _section_lines(lines: list[str], starts: tuple[str, ...], ends: tuple[str, ...] = JOB_SECTION_ENDINGS) -> list[str]:
    start = next((index for index, line in enumerate(lines) if _heading_matches(line, starts)), None)
    if start is None:
        return []
    finish = next((index for index in range(start + 1, len(lines)) if _heading_matches(lines[index], ends)), len(lines))
    return lines[start + 1:finish]


def _is_heading_or_label(value: str) -> bool:
    clean = _compact_text(value)
    heading = _normalised_heading(clean)
    known = {
        "overview", "description", "the work", "about the role", "about this role", "job summary", "position summary",
        "responsibilities", "key responsibilities", "what you'll do", "your impact", "duties",
        "essential functions", "requirements", "qualifications", "basic qualifications", "required qualifications",
        "minimum qualifications", "desired qualifications", "preferred skills", "required skills", "what you'll bring",
        "what you bring", "security clearance", "details", "education requirements", "category", "clearance", "location",
        "telecommute", "qualifications here s what you need", "minimum skills", "must have", "preferred qualifications",
        "our commitment to you overview of benefits", "working conditions", "pay range",
    }
    known_normalized = {_normalised_heading(item) for item in known}
    return heading in known_normalized or (clean.endswith(":") and len(clean.split()) <= 8)


def _section_items(lines: list[str], starts: tuple[str, ...], ends: tuple[str, ...], skip: tuple[str, ...] = ()) -> list[str]:
    items = []
    for line in _section_lines(lines, starts, ends):
        clean = _compact_text(line)
        lowered = clean.casefold()
        if not clean or _is_heading_or_label(clean) or any(phrase in lowered for phrase in skip):
            continue
        items.append(clean)
    return _short_list(items)


def _requirement_skill_items(lines: list[str]) -> list[str]:
    for line in _section_lines(lines, ("requirements",), ("benefits", "pay range", "working conditions")):
        match = re.search(r"requirements\s+for\s+.+?\s+include\s*:\s*(.+)", line, re.I)
        if not match:
            continue
        candidates = [part.strip(" .") for part in re.split(r",\s*", match.group(1))]
        candidates = [part for part in candidates if part and not re.fullmatch(r"and others?", part, re.I)]
        return _short_list(candidates)
    return []


def _structured_location(value: object) -> str:
    entries = value if isinstance(value, list) else [value]
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        address = entry.get("address", entry)
        if not isinstance(address, dict):
            continue
        parts = []
        for key in ("addressLocality", "addressRegion"):
            part = _compact_text(address.get(key))
            if part and part.casefold() != "unavailable":
                parts.append(part)
        country = _compact_text(address.get("addressCountry"))
        if country and country.casefold() not in {"unavailable", "us", "usa", "united states", "united states of america"}:
            parts.append(country)
        if parts:
            return ", ".join(parts)[:200]
    return ""


def _work_type(structured: dict[str, object], text: str) -> str:
    for key in ("jobLocationType", "workplaceType"):
        value = structured.get(key)
        values = value if isinstance(value, list) else [value]
        for item in values:
            lowered = _compact_text(item).casefold().replace("_", " ")
            for alias, label in WORK_TYPE_LABELS.items():
                if alias in lowered:
                    return label
    lowered = text.casefold()
    for pattern, label in ((r"\bfully remote\b|\bremote position\b|\bwork from home\b", "Remote"),
                           (r"\bhybrid\b", "Hybrid"),
                           (r"\bon[- ]?site\b|\bonsite\b|\bin[- ]office\b|\bno remote(?:/|\s|-)?telework\b|\bno telework\b", "On-Site")):
        if re.search(pattern, lowered):
            return label
    return ""


def _format_amount(value: object) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    return f"{number:,.0f}" if number.is_integer() else f"{number:,.2f}".rstrip("0").rstrip(".")


def _normalise_pay_amount(value: object) -> str:
    clean = _compact_text(value)
    match = re.search(r"(?:(?P<currency>USD|CAD|AUD|GBP|EUR)\s*)?(?P<symbol>[$€£])?\s*(?P<number>\d[\d,]*(?:\.\d+)?)\s*(?P<suffix>[kKmM])?", clean, re.I)
    if not match:
        return clean
    try:
        number = float(match.group("number").replace(",", ""))
    except (TypeError, ValueError):
        return clean
    suffix = (match.group("suffix") or "").casefold()
    number *= 1000 if suffix == "k" else 1_000_000 if suffix == "m" else 1
    currency = (match.group("currency") or "").upper()
    symbol = match.group("symbol") or {"USD": "$", "CAD": "C$", "AUD": "A$", "GBP": "£", "EUR": "€"}.get(currency, "$")
    return f"{symbol}{_format_amount(number)}"


def _extract_pay(structured: dict[str, object], text: str) -> str:
    salary = structured.get("baseSalary") or structured.get("estimatedSalary")
    if isinstance(salary, list):
        salary = salary[0] if salary else {}
    if isinstance(salary, dict):
        value = salary.get("value", salary)
        unit_text = _compact_text(salary.get("unitText") or salary.get("unit") or "")
        if isinstance(value, dict):
            minimum = _format_amount(value.get("minValue"))
            maximum = _format_amount(value.get("maxValue"))
            single = _format_amount(value.get("value"))
            unit_text = _compact_text(value.get("unitText") or value.get("unit") or unit_text)
        else:
            minimum = maximum = ""
            single = _format_amount(value)
        currency = _compact_text(salary.get("currency") or structured.get("salaryCurrency"))
        symbol = {"USD": "$", "CAD": "C$", "AUD": "A$", "GBP": "£", "EUR": "€"}.get(currency.upper(), "") if currency else ""
        if minimum and maximum:
            result = f"{symbol}{minimum}–{symbol}{maximum}"
        elif single:
            result = f"{symbol}{single}"
        else:
            result = ""
        if result:
            if currency and currency.upper() not in {"USD"}:
                result += f" {currency.upper()}"
            frequency = re.search(r"(?:/|per)\s*(hour|hr|week|month|year|yr)", text, re.I)
            frequency_label = frequency.group(1).lower() if frequency else ""
            if not frequency_label:
                unit_match = re.search(r"(?:hour|hr|week|month|year|yr)", unit_text, re.I)
                frequency_label = unit_match.group(0).lower() if unit_match else ""
            if not frequency_label and minimum and maximum:
                frequency_label = "yr"
            return f"{result} / {frequency_label}" if frequency_label else result

    amount = r"(?:(?:USD|CAD|AUD|GBP|EUR)\s*)?[$€£]?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?"
    pay_match = re.search(
        rf"(?:pay\s+range|(?:target\s+)?salary(?:\s+range)?|compensation)\s*[:\-]?\s*(?P<first>{amount})"
        rf"(?:\s*(?:-|–|—|to)\s*(?P<second>{amount}))?"
        rf"(?P<term>\s*(?:/|per)\s*(?:hour|hr|week|month|year|yr))?", text, re.I)
    if pay_match:
        first = _normalise_pay_amount(pay_match.group("first"))
        second = _normalise_pay_amount(pay_match.group("second")) if pay_match.group("second") else ""
        term = _compact_text(pay_match.group("term"))
        if second:
            return _normalise_pay_term(f"{first}–{second}{f' {term}' if term else ''}")
        return _normalise_pay_term(f"{first}{f' {term}' if term else ''}")
    if re.search(r"\bcommission[- ]based\b|\bcommission\b", text, re.I):
        return "Commission"
    if re.search(r"\bintern(?:ship)?\b", text, re.I):
        return "Intern (unpaid)" if re.search(r"\bunpaid\b", text, re.I) else "Intern"
    return ""


def _extract_job_fields(structured: dict[str, object], structured_text: str, raw_text: str, metadata: dict[str, str]) -> dict[str, object]:
    lines = [_compact_text(line) for line in (structured_text.splitlines() if structured_text else [])]
    lines = [line for line in lines if line]
    if not lines:
        raw_lines = [_compact_text(line) for line in raw_text.splitlines() if _compact_text(line)]
        lines = raw_lines if len(raw_lines) > 1 else [_compact_text(part) for part in re.split(r"(?<=[.!?])\s+", raw_text) if _compact_text(part)]

    work_lines = _section_lines(
        lines,
        ("the work", "about the role", "about this role", "overview", "job summary", "position summary"),
        ("responsibilities", "requirements", "qualifications", "pay range", "working conditions", "details"),
    )
    work_source = next((line for line in work_lines if not _is_heading_or_label(line) and len(line.split()) > 2), "")
    if not work_source:
        # Some JSON-LD descriptions omit the "About The Role" heading while
        # retaining the role paragraph. Prefer that paragraph over a
        # qualification bullet when building the short overview fields.
        work_source = next((line for line in lines if re.search(r"\b(?:is seeking|candidate must|successful candidate will)\b", line, re.I)), "")
    overview_lines = _section_lines(
        lines,
        ("overview", "description", "the work", "about the role", "about this role", "job summary", "position summary"),
        ("responsibilities", "requirements", "qualifications", "pay range", "working conditions", "details"),
    )
    description_source = next((line for line in overview_lines
                                if not _is_heading_or_label(line)
                                and "employment in this role is conditional" not in line.casefold()), "")
    if not description_source:
        description_source = work_source or next((line for line in lines if not _is_heading_or_label(line)), "")
    if not work_source:
        work_source = description_source
    work = _under_word_limit(work_source, maximum=6)
    description = _under_word_limit(description_source, maximum=6)
    task_lines = _section_lines(
        lines,
        ("key responsibilities", "responsibilities", "what you'll do", "your impact", "duties", "essential functions"),
        ("requirements", "qualifications", "minimum skills", "preferred qualifications", "preferred skills", "pay range", "details"),
    )
    task = _under_word_limit(next((line for line in task_lines if not _is_heading_or_label(line) and not line.casefold().startswith("other duties")), ""), maximum=6)
    qualifications = _section_items(
        lines, ("requirements", "qualifications here s what you need", "qualifications", "basic qualifications", "required qualifications", "minimum qualifications", "what you'll bring", "what you bring"),
        ("minimum skills", "required skills", "preferred qualifications", "preferred skills", "desired qualifications", "security clearance", "our commitment", "benefits", "working conditions", "pay range", "salary", "compensation", "location", "work location", "details"),
        ("intended to provide a general overview", "however, due to", "candidates should demonstrate", "requirements for"),
    )
    minimum_skills = _section_items(lines, ("minimum skills", "required skills", "must have"), ("preferred qualifications", "preferred skills", "desired qualifications", "our commitment", "benefits", "working conditions", "pay range", "salary", "compensation", "location", "work location", "details"))
    if not minimum_skills:
        minimum_skills = _requirement_skill_items(lines)
    if not minimum_skills:
        basic_items = [
            _compact_text(line)
            for line in _section_lines(
                lines,
                ("basic qualifications", "required qualifications", "minimum qualifications"),
                ("desired qualifications", "preferred qualifications", "preferred skills", "security clearance", "our commitment", "benefits", "working conditions", "pay range", "salary", "compensation", "location", "work location", "details"),
            )
            if _compact_text(line) and not _is_heading_or_label(line)
        ]
        minimum_skills = _short_list([
            item for item in basic_items
            if re.search(r"\b(?:strong knowledge|experience with|experience in|software unit testing|trouble|communication|team environment|self[- ]starter|database development|data migration|clearance|degree|years relevant experience)\b", item, re.I)
        ])
    preferred_skills = _section_items(lines, ("preferred qualifications", "preferred skills", "desired qualifications"), ("security clearance", "responsibilities", "our commitment", "benefits", "working conditions", "pay range", "salary", "compensation", "location", "work location", "details"))

    location = _structured_location(structured.get("jobLocation"))
    # Some vendors publish only a region abbreviation in JSON-LD while the
    # visible job header has the complete city and state.
    if location and re.fullmatch(r"[A-Z]{2}", location):
        location = ""
    if not location:
        location = _compact_text(metadata.get("dom_location", ""))
    if not location:
        og_title = metadata.get("og_title", "")
        location_match = re.search(r"\bin\s+(.+?)\s*\|", og_title, re.I)
        if location_match:
            location = _compact_text(location_match.group(1))
    if not location:
        location_match = re.search(
            r"\blocation\s*:\s*([A-Za-z .'-]+?)\s*,\s*([A-Za-z .'-]+?)(?=\s+(?:telecommute|category|clearance)\b|$)",
            raw_text,
            re.I,
        )
        if location_match:
            location = f"{_compact_text(location_match.group(1))}, {_compact_text(location_match.group(2))}"[:200]
    if not location:
        location_match = re.search(r"\b(?:located in|based in)\s*[:\-]?\s*([A-Z][^.!?]{2,80})", raw_text)
        if location_match:
            location = _compact_text(location_match.group(1)).rstrip(" ,;")

    return {
        "location": location,
        "type": _work_type(structured, raw_text),
        "description": description,
        "work": work,
        "task": task,
        "qual": qualifications,
        "skills_min": minimum_skills,
        "skills_max": preferred_skills,
        "pay": _extract_pay(structured, raw_text),
    }


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
    def text_field(name: str, fallback: str = "", maximum: int | None = None) -> str:
        value = _compact_text(content.get(name))
        if not value:
            value = _compact_text(page.get(name) or fallback)
        return _under_word_limit(value, maximum) if maximum else value[:MAX_ANALYSIS_TEXT]

    def list_field(name: str) -> list[str]:
        value = content.get(name)
        result = _short_list(value)
        return result or _short_list(page.get(name, []))

    return {"mode": "ai", "source_url": page.get("source_url", ""),
            "title": str(content.get("title") or page.get("title") or "Job Opportunity")[:200],
            "company": str(content.get("company") or page.get("company") or "")[:200],
            "industry": str(content.get("industry") or page.get("industry") or "general")[:100],
            "description": text_field("description", maximum=6),
            "summary": str(content.get("summary") or page.get("summary") or "")[:MAX_ANALYSIS_TEXT],
            "raw_text": page.get("raw_text", "")[:MAX_ANALYSIS_TEXT],
            "metadata": page.get("metadata", {}), "skills": skills,
            "location": text_field("location"),
            "type": text_field("type"),
            "work": text_field("work", maximum=6),
            "task": text_field("task", maximum=6),
            "qual": list_field("qual"),
            "skills_min": list_field("skills_min"),
            "skills_max": list_field("skills_max"),
            "pay": _normalise_pay_term(text_field("pay"))}


def _openai_analyze(page: dict) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "AI job analysis is not configured. Set OPENAI_API_KEY on the backend or choose Deterministic.")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    schema = {
        "type": "object", "additionalProperties": False,
        "properties": {
            "title": {"type": "string"}, "company": {"type": "string"}, "industry": {"type": "string"},
            "summary": {"type": "string"}, "description": {"type": "string"}, "location": {"type": "string"},
            "type": {"type": "string", "enum": ["", "On-Site", "Hybrid", "Remote"]},
            "work": {"type": "string"}, "task": {"type": "string"},
            "qual": {"type": "array", "items": {"type": "string"}},
            "skills_min": {"type": "array", "items": {"type": "string"}},
            "skills_max": {"type": "array", "items": {"type": "string"}},
            "pay": {"type": "string"},
            "skills": {"type": "array", "items": {"type": "object", "additionalProperties": False, "properties": {"name": {"type": "string"}, "score": {"type": "number"}, "evidence": {"type": "array", "items": {"type": "string"}}}, "required": ["name", "score", "evidence"]}},
        }, "required": ["title", "company", "industry", "summary", "description", "location", "type", "work", "task", "qual", "skills_min", "skills_max", "pay", "skills"],
    }
    prompt = ("Analyze this job page. Infer the most likely industry and rank the required or preferred skills by relevance. "
              "Return only the requested JSON fields. Use type only as On-Site, Hybrid, Remote, or an empty string. "
              "Keep description, work, and task under 7 words each. Keep every qual, skills_min, and skills_max list item under 7 words. "
              "Put general qualifications and credentials in qual; put absolute minimum requirements in skills_min and preferred skills or credentials in skills_max. "
              "Set numeric pay to two amounts plus a term such as / yr; use Commission, Intern, or an empty string when applicable. Score each ranked skill from 0 to 100 and include short evidence phrases.\n\n"
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


def _affinda_field(data: dict, name: str):
    field = data.get(name)
    if not isinstance(field, dict):
        return field
    parsed = field.get("parsed")
    if parsed not in (None, ""):
        return parsed
    return field.get("raw", "")


def _affinda_text(value: object) -> str:
    if isinstance(value, dict):
        for key in ("name", "label", "value", "text", "title"):
            if value.get(key):
                return _compact_text(value[key])
        parts = [
            _compact_text(value.get(key))
            for key in ("city", "locality", "addressLocality", "state", "region", "addressRegion", "country")
            if value.get(key)
        ]
        if parts:
            return ", ".join(parts)
        return ""
    return _compact_text(value)


def _affinda_pay(value: object) -> str:
    if not isinstance(value, dict):
        return _normalise_pay_term(_affinda_text(value))
    def amount(raw: object) -> str:
        try:
            return _format_amount(float(raw))
        except (TypeError, ValueError):
            normalized = _normalise_pay_amount(raw)
            return normalized.lstrip("$€£")

    minimum = amount(value.get("minimum"))
    maximum = amount(value.get("maximum"))
    single = amount(value.get("value"))
    currency = _compact_text(value.get("currency")).upper()
    symbol = {"USD": "$", "CAD": "C$", "AUD": "A$", "GBP": "£", "EUR": "€"}.get(currency, "")
    if minimum and maximum:
        amount = f"{symbol}{minimum}–{symbol}{maximum}"
    elif single:
        amount = f"{symbol}{single}"
    else:
        return ""
    unit = _compact_text(value.get("unit") or value.get("unitText"))
    frequency = re.search(r"hour|hr|week|month|year|yr", unit, re.I)
    term = frequency.group(0).lower() if frequency else "yr" if minimum and maximum else ""
    return f"{amount} / {term}" if term else amount


def _affinda_analyze(page: dict) -> dict:
    api_key = os.getenv("AFFINDA_API_KEY", "").strip()
    workspace = os.getenv("AFFINDA_WORKSPACE", "").strip()
    document_type = os.getenv("AFFINDA_DOCUMENT_TYPE", "").strip()
    if not api_key or not workspace or not document_type:
        raise HTTPException(
            503,
            "Paid AI is not configured. Set AFFINDA_API_KEY, AFFINDA_WORKSPACE, and AFFINDA_DOCUMENT_TYPE on the backend.",
        )
    base_url = os.getenv("AFFINDA_BASE_URL", "https://api.affinda.com").rstrip("/")
    source_text = "\n".join(
        value for value in (page.get("title", ""), page.get("company", ""), page.get("raw_text", "")) if value
    )[:MAX_ANALYSIS_TEXT]
    payload = {
        "workspace": workspace,
        "documentType": document_type,
        "wait": "true",
        "deleteAfterParse": "true",
        "language": "en",
    }
    try:
        response = requests.post(
            f"{base_url}/v3/documents",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": ("job.txt", source_text.encode("utf-8"), "text/plain")},
            data=payload,
            timeout=45,
        )
        response.raise_for_status()
        body = response.json()
        data = body.get("data", body) if isinstance(body, dict) else {}
        if not isinstance(data, dict):
            raise ValueError("Affinda response data was not an object")
    except (requests.RequestException, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(502, "The paid AI provider could not analyze this job page.") from exc

    skills: list[dict] = []
    raw_skills = data.get("skills", [])
    if isinstance(raw_skills, list):
        for item in raw_skills[:20]:
            if not isinstance(item, dict):
                continue
            parsed = item.get("parsed")
            name = _affinda_text(parsed or item.get("raw"))
            if not name:
                continue
            try:
                confidence = float(item.get("confidence", 0.5))
            except (TypeError, ValueError):
                confidence = 0.5
            score = max(0.0, min(100.0, confidence * 100 if confidence <= 1 else confidence))
            skills.append({"name": name[:120], "score": score, "evidence": [_affinda_text(item.get("raw"))] if item.get("raw") else [], "source": "affinda"})
    skills.sort(key=lambda item: (-item["score"], item["name"]))

    vendor_qualifications = []
    for field_name in ("educationLevel", "educationAccreditation"):
        value = _affinda_text(_affinda_field(data, field_name))
        if value:
            vendor_qualifications.append(value)
    certifications = data.get("certifications", [])
    if isinstance(certifications, list):
        vendor_qualifications.extend(_affinda_text(_affinda_field({"value": item}, "value")) for item in certifications)
    years = _affinda_field(data, "yearsExperience")
    if isinstance(years, dict):
        minimum_years = years.get("minimum")
        if minimum_years not in (None, ""):
            vendor_qualifications.append(f"{minimum_years:g}+ years experience" if isinstance(minimum_years, (int, float)) else f"{minimum_years}+ years experience")

    metadata = dict(page.get("metadata", {}))
    metadata["ai_provider"] = "affinda"
    title_data = _affinda_field(data, "jobTitle")
    title = _affinda_text(title_data) or page.get("title") or "Job Opportunity"
    company = _affinda_text(_affinda_field(data, "organizationName")) or page.get("company", "")
    location = _affinda_text(_affinda_field(data, "location")) or page.get("location", "")
    job_type = _affinda_text(_affinda_field(data, "jobType")) or page.get("type", "")
    qualification_list = _short_list(vendor_qualifications) or _short_list(page.get("qual", []))
    minimum_skills = _short_list(page.get("skills_min", []))
    if not minimum_skills:
        minimum_skills = _short_list([skill["name"] for skill in skills])
    preferred_skills = _short_list(page.get("skills_max", []))
    return {
        "mode": "ai", "source_url": page.get("source_url", ""), "title": title[:200],
        "company": company[:200], "industry": _infer_industry(page.get("raw_text", "")),
        "description": _under_word_limit(page.get("description") or page.get("summary", ""), 6),
        "summary": page.get("summary", "")[:MAX_ANALYSIS_TEXT], "raw_text": page.get("raw_text", "")[:MAX_ANALYSIS_TEXT],
        "metadata": metadata, "skills": skills, "location": location[:200], "type": job_type[:50],
        "work": _under_word_limit(page.get("work", ""), 6), "task": _under_word_limit(page.get("task", ""), 6),
        "qual": qualification_list, "skills_min": minimum_skills, "skills_max": preferred_skills,
        "pay": _affinda_pay(_affinda_field(data, "expectedRemuneration")),
    }


def _ai_analyze(page: dict) -> dict:
    # Affinda is the paid production provider. Keep the OpenAI-compatible
    # adapter available for local development and migration testing until the
    # Affinda workspace/document type is configured.
    if os.getenv("AFFINDA_API_KEY", "").strip():
        return _affinda_analyze(page)
    if not os.getenv("OPENAI_API_KEY", "").strip():
        raise HTTPException(
            503,
            "Paid AI is not configured. Set Affinda credentials on the backend or choose Deterministic.",
        )
    return _openai_analyze(page)


def analyze_job_text(description: str, mode: str = "deterministic") -> dict:
    if len(description.strip()) < 100:
        raise HTTPException(400, "Paste at least 100 characters of the job description.")
    clean_description = description.strip()[:MAX_ANALYSIS_TEXT]
    page = {"source_url": "", "title": "Target Role", "company": "", "summary": clean_description,
            "raw_text": clean_description, "metadata": {}}
    page.update(_extract_job_fields({}, "", clean_description, {}))
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
