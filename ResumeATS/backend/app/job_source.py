"""Bounded public job-page fetching, with DNS pinned for each redirect hop."""
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import urllib3
from bs4 import BeautifulSoup
from fastapi import HTTPException

MAX_PAGE_BYTES = 2 * 1024 * 1024


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
        options = {"host": address, "port": port, "timeout": urllib3.Timeout(connect=5, read=10), "retries": False}
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
            raw = response.read(MAX_PAGE_BYTES + 1, decode_content=False)
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


def extract_job(url: str) -> tuple[str, str, str]:
    soup = BeautifulSoup(fetch_public_html(url), "html.parser")
    for element in soup(["script", "style", "nav", "footer", "header"]):
        element.decompose()
    heading = soup.find("h1") or soup.title
    title = heading.get_text(" ", strip=True)[:200] if heading else "Job Opportunity"
    company_meta = soup.find("meta", attrs={"property": "og:site_name"})
    company = str(company_meta.get("content", ""))[:200] if company_meta else ""
    description = (soup.find("main") or soup).get_text(" ", strip=True)[:30000]
    if len(description) < 100:
        raise HTTPException(400, "No readable job description was found. Paste it instead.")
    return title, company, description
