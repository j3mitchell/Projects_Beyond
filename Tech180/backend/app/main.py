from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urljoin, urlparse, urlunparse

import httpx
import re
import json
from bs4 import BeautifulSoup, Tag
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
}
CONTENT_SELECTORS = "h1,h2,h3,h4,h5,h6,p,a,button,span,li,figcaption,blockquote,img,iframe,video"
CONTAINER_SELECTORS = "div,section,article,header,footer,main,nav,aside,form"
CONTAINER_TAGS = {"div", "section", "article", "header", "footer", "main", "nav", "aside", "form"}
MAX_SUBPAGES = 40
MAX_EDITABLE_ELEMENTS = 250
RENDER_WAIT_MS = 1800
COMPUTED_STYLE_SCRIPT = """
() => {
  const copiedProperties = [
    "align-content", "align-items", "align-self", "aspect-ratio",
    "background", "background-color", "background-image", "background-position",
    "background-repeat", "background-size", "border", "border-radius",
    "bottom", "box-shadow", "box-sizing", "clear", "color", "column-gap",
    "cursor", "display", "flex", "flex-basis", "flex-direction", "flex-grow",
    "flex-shrink", "flex-wrap", "float", "font", "font-family", "font-size",
    "font-style", "font-weight", "gap", "grid", "grid-area", "grid-template",
    "height", "justify-content", "justify-items", "justify-self", "left",
    "letter-spacing", "line-height", "list-style", "margin", "max-height",
    "max-width", "min-height", "min-width", "object-fit", "opacity",
    "overflow", "overflow-x", "overflow-y", "padding", "place-content",
    "place-items", "position", "right", "row-gap", "text-align",
    "text-decoration", "text-transform", "top", "transform",
    "transform-origin", "vertical-align", "visibility", "white-space",
    "width", "z-index"
  ];

  const isVisible = (element, styles) => {
    if (element.tagName === "BODY" || element.tagName === "HTML") return true;
    const rect = element.getBoundingClientRect();
    return (
      styles.display !== "none" &&
      styles.visibility !== "hidden" &&
      Number(styles.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  for (const element of document.querySelectorAll("html, body, body *")) {
    const styles = window.getComputedStyle(element);
    element.dataset.tech180Visible = isVisible(element, styles) ? "true" : "false";

    const declarations = [];
    for (const property of copiedProperties) {
      const value = styles.getPropertyValue(property);
      if (value) declarations.push(`${property}: ${value};`);
    }

    element.setAttribute("style", declarations.join(" "));

    if (element.tagName === "IMG" && element.currentSrc) {
      element.setAttribute("src", element.currentSrc);
    }
  }

  document.documentElement.dataset.tech180ComputedStyles = "true";
}
"""


app = FastAPI(title="Tech180 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ImportRequest(BaseModel):
    url: str = Field(..., description="Public http/https page URL to recreate.")
    include_subpages: bool = True
    viewport_width: Optional[int] = Field(
        default=None,
        ge=640,
        le=1920,
        description="Approximate editor preview width for browser rendering.",
    )


class PageOption(BaseModel):
    title: str
    url: str


class EditableElement(BaseModel):
    id: str
    type: Literal["text", "image", "link", "embed", "container"]
    label: str
    selector: str
    value: str
    tag: str


class ImportResponse(BaseModel):
    title: str
    source_url: str
    html: str
    subpages: list[PageOption]
    elements: list[EditableElement]
    warnings: list[str]
    render_mode: Literal["browser", "http"]


class ExportRequest(BaseModel):
    files: dict[str, str]


class ExportResponse(BaseModel):
    folder_name: str
    path: str


def _validate_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL must be a valid http/https address.")
    return urlunparse(parsed._replace(fragment=""))


def _same_origin(left: str, right: str) -> bool:
    left_parsed = urlparse(left)
    right_parsed = urlparse(right)
    return left_parsed.scheme == right_parsed.scheme and left_parsed.netloc == right_parsed.netloc


async def _fetch_html(url: str) -> str:
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=15,
            headers=REQUEST_HEADERS,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if status_code == 403:
            raise HTTPException(
                status_code=403,
                detail=(
                    "This site blocked Tech180's importer with HTTP 403. "
                    "Large enterprise sites often require a real browser session, cookies, "
                    "or bot-protection checks before their HTML can be imported."
                ),
            ) from exc
        raise HTTPException(
            status_code=400,
            detail=f"Unable to fetch URL: HTTP {status_code} from the source site.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Unable to fetch URL: {exc}") from exc

    content_type = response.headers.get("content-type", "")
    if "html" not in content_type.lower():
        raise HTTPException(status_code=400, detail="URL did not return an HTML page.")
    return response.text


def _normalize_viewport_width(width: Optional[int]) -> int:
    if not width:
        return 1120
    return max(640, min(1920, int(width)))


async def _render_html(url: str, viewport_width: Optional[int]) -> tuple[str, str, list[str]]:
    warnings: list[str] = []
    normalized_width = _normalize_viewport_width(viewport_width)

    try:
        from playwright.async_api import TimeoutError as PlaywrightTimeoutError
        from playwright.async_api import async_playwright
    except ImportError:
        warnings.append("Browser rendering is not installed; Tech180 used the raw HTML response.")
        return await _fetch_html(url), "http", warnings

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                channel="chrome",
                headless=True,
            )
            context = await browser.new_context(
                user_agent=REQUEST_HEADERS["User-Agent"],
                locale="en-US",
                viewport={"width": normalized_width, "height": 1200},
                extra_http_headers={
                    "Accept-Language": REQUEST_HEADERS["Accept-Language"],
                    "Upgrade-Insecure-Requests": REQUEST_HEADERS["Upgrade-Insecure-Requests"],
                },
            )
            page = await context.new_page()
            try:
                response = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                if response and response.status == 403:
                    raise HTTPException(
                        status_code=403,
                        detail=(
                            "This site blocked Tech180's browser renderer with HTTP 403. "
                            "It may require login, cookies, or bot-protection checks."
                        ),
                    )
                try:
                    await page.wait_for_load_state("networkidle", timeout=6000)
                except PlaywrightTimeoutError:
                    warnings.append("The page kept loading network requests; Tech180 captured the latest rendered state.")
                await page.wait_for_timeout(RENDER_WAIT_MS)
                await page.evaluate(COMPUTED_STYLE_SCRIPT)
                rendered = await page.content()
            finally:
                await context.close()
                await browser.close()

        warnings.append(f"Preview was captured from a rendered browser snapshot at {normalized_width}px wide.")
        return rendered, "browser", warnings
    except HTTPException:
        raise
    except Exception as exc:
        warnings.append(f"Browser rendering failed, so Tech180 used the raw HTML response: {exc}")
        return await _fetch_html(url), "http", warnings


def _absolutize_assets(soup: BeautifulSoup, base_url: str) -> None:
    attr_map = {
        "a": ["href"],
        "img": ["src", "srcset"],
        "link": ["href"],
        "script": ["src"],
        "source": ["src", "srcset"],
        "video": ["src", "poster"],
        "audio": ["src"],
        "iframe": ["src"],
    }

    for tag_name, attrs in attr_map.items():
        for tag in soup.find_all(tag_name):
            for attr in attrs:
                value = tag.get(attr)
                if not value:
                    continue
                if attr == "srcset":
                    tag[attr] = _absolutize_srcset(str(value), base_url)
                else:
                    tag[attr] = urljoin(base_url, str(value))


def _absolutize_srcset(value: str, base_url: str) -> str:
    entries = []
    for candidate in value.split(","):
        parts = candidate.strip().split()
        if not parts:
            continue
        parts[0] = urljoin(base_url, parts[0])
        entries.append(" ".join(parts))
    return ", ".join(entries)


def _remove_active_scripts(soup: BeautifulSoup) -> None:
    for script in soup.find_all("script"):
        script.decompose()


def _inject_editor_styles(soup: BeautifulSoup) -> None:
    style = soup.new_tag("style")
    style.string = """
[data-tech180-id] {
  outline: 1px dashed rgba(14, 165, 233, 0);
  transition: outline-color 120ms ease, background-color 120ms ease;
}
[data-tech180-id]:hover,
[data-tech180-id][data-tech180-active="true"] {
  outline-color: rgba(14, 165, 233, .95);
  background-color: rgba(14, 165, 233, .08);
}
"""
    if soup.head:
        soup.head.append(style)


def _label_for(tag: Tag, fallback: str) -> str:
    if tag.name == "img":
        return (tag.get("alt") or tag.get("src") or fallback).strip()[:80]
    if tag.name in {"iframe", "video"}:
        return (tag.get("title") or tag.get("src") or fallback).strip()[:80]
    text = tag.get_text(" ", strip=True)
    return (text or fallback).strip()[:80]


def _annotate_elements(soup: BeautifulSoup) -> list[EditableElement]:
    elements: list[EditableElement] = []
    seen_text: set[int] = set()

    # Reserve sidebar space for containers. Large pages can have 250 text/image
    # nodes before the first DIV would otherwise reach the editable list.
    content_candidates = list(soup.select(CONTENT_SELECTORS))
    media_candidates = list(soup.select("iframe,video,img"))
    container_candidates = list(soup.select(CONTAINER_SELECTORS))
    listed_candidates = set(map(id, media_candidates + content_candidates[:175] + container_candidates[:75]))
    candidates = [*content_candidates, *container_candidates]
    for index, tag in enumerate(candidates, start=1):
        if not isinstance(tag, Tag):
            continue
        if tag.get("data-tech180-visible") == "false":
            continue
        if tag.find_parent(attrs={"data-tech180-visible": "false"}):
            continue
        element_id = f"t180-{index}"
        tag["data-tech180-id"] = element_id

        if tag.name in CONTAINER_TAGS:
            value = str(tag)
            element_type: Literal["text", "image", "link", "embed", "container"] = "container"
        elif tag.name == "img":
            value = str(tag.get("src") or "")
            element_type = "image"
        elif tag.name in {"iframe", "video"}:
            value = str(tag.get("src") or "")
            element_type = "embed"
        elif tag.name == "a" and tag.get("href"):
            value = str(tag.get("href") or "")
            element_type = "link"
        else:
            value = tag.get_text(" ", strip=True)
            element_type = "text"
            if not value or id(tag) in seen_text:
                continue
            seen_text.add(id(tag))

        # Every candidate receives an ID so hierarchy navigation can climb into
        # deep parents. Only the sidebar list is capped for browser performance.
        if id(tag) in listed_candidates and len(elements) < MAX_EDITABLE_ELEMENTS:
            elements.append(
                EditableElement(
                    id=element_id,
                    type=element_type,
                    label=_label_for(tag, f"{tag.name} {index}"),
                    selector=f'[data-tech180-id="{element_id}"]',
                    value=value,
                    tag=tag.name or "element",
                )
            )

    return elements


def _discover_subpages(soup: BeautifulSoup, source_url: str) -> list[PageOption]:
    pages: list[PageOption] = []
    seen: set[str] = set()

    for anchor in soup.find_all("a"):
        href = anchor.get("href")
        if not href:
            continue
        absolute = urljoin(source_url, str(href))
        absolute = urlunparse(urlparse(absolute)._replace(fragment=""))
        if not _same_origin(source_url, absolute) or absolute in seen:
            continue
        parsed = urlparse(absolute)
        if parsed.scheme not in {"http", "https"}:
            continue
        label = anchor.get_text(" ", strip=True) or parsed.path.strip("/") or "Home"
        pages.append(PageOption(title=label[:80], url=absolute))
        seen.add(absolute)
        if len(pages) >= MAX_SUBPAGES:
            break

    if source_url not in seen:
        pages.insert(0, PageOption(title="Imported page", url=source_url))
    return pages


def _ensure_base_tag(soup: BeautifulSoup, source_url: str) -> None:
    if not soup.head or soup.head.find("base"):
        return
    base = soup.new_tag("base", href=source_url)
    soup.head.insert(0, base)


def _prepare_html(
    raw_html: str,
    source_url: str,
    render_warnings: list[str],
) -> tuple[str, list[EditableElement], list[PageOption], str, list[str]]:
    soup = BeautifulSoup(raw_html, "html.parser")
    warnings: list[str] = list(render_warnings)

    if not soup.html:
        warnings.append("The page did not include a complete html document; Tech180 wrapped what it found.")

    _ensure_base_tag(soup, source_url)
    _absolutize_assets(soup, source_url)
    subpages = _discover_subpages(soup, source_url)
    _remove_active_scripts(soup)
    elements = _annotate_elements(soup)
    _inject_editor_styles(soup)

    title = soup.title.get_text(" ", strip=True) if soup.title else urlparse(source_url).netloc
    if len(elements) >= MAX_EDITABLE_ELEMENTS:
        warnings.append(f"Editable elements were capped at {MAX_EDITABLE_ELEMENTS} for this import.")
    warnings.append("Scripts are disabled in imported pages so the editor can safely control the recreation.")

    return str(soup), elements, subpages, title, warnings


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "Tech180"}


@app.post("/api/import", response_model=ImportResponse)
async def import_page(payload: ImportRequest) -> ImportResponse:
    source_url = _validate_url(payload.url)
    raw_html, render_mode, render_warnings = await _render_html(source_url, payload.viewport_width)
    html, elements, subpages, title, warnings = _prepare_html(raw_html, source_url, render_warnings)
    return ImportResponse(
        title=title,
        source_url=source_url,
        html=html,
        subpages=subpages if payload.include_subpages else [],
        elements=elements,
        warnings=warnings,
        render_mode=render_mode,
    )


def _create_export_directory() -> tuple[Path, str]:
    prefix = datetime.now().strftime("tech_%y%m%d")
    preferred_root = Path.home() / "Downloads"
    fallback_root = Path(__file__).resolve().parents[2] / "exports"

    for root in (preferred_root, fallback_root):
        try:
            root.mkdir(parents=True, exist_ok=True)
            for sequence in range(1, 100):
                folder_name = f"{prefix}_{sequence:02d}"
                export_directory = root / folder_name
                try:
                    export_directory.mkdir()
                    return export_directory, folder_name
                except FileExistsError:
                    continue
        except OSError:
            continue

    raise HTTPException(status_code=500, detail="Tech180 could not create an export folder.")


@app.post("/api/export", response_model=ExportResponse)
def export_project(payload: ExportRequest) -> ExportResponse:
    required_files = {"index.html", "styles.css", "script.js"}
    if not required_files.issubset(payload.files):
        raise HTTPException(
            status_code=400,
            detail="Export must contain at least index.html, styles.css, and script.js.",
        )

    safe_files = {
        filename: content
        for filename, content in payload.files.items()
        if Path(filename).name == filename and re.fullmatch(r"[A-Za-z0-9._-]+", filename)
    }
    if len(safe_files) != len(payload.files):
        raise HTTPException(status_code=400, detail="Export contains an unsafe filename.")

    export_directory, folder_name = _create_export_directory()
    try:
        for filename, content in sorted(safe_files.items()):
            (export_directory / filename).write_text(content, encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not write export files: {exc}") from exc

    return ExportResponse(folder_name=folder_name, path=str(export_directory))


@app.post("/api/export-assets", response_model=ExportResponse)
async def export_project_with_assets(
    files_json: str = Form(...),
    assets: list[UploadFile] = File(default=[]),
) -> ExportResponse:
    try:
        files = json.loads(files_json)
        payload = ExportRequest(files=files)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Export file data is invalid.") from exc

    result = export_project(payload)
    export_directory = Path(result.path)
    assets_directory = export_directory / "assets"
    try:
        if assets:
            assets_directory.mkdir(exist_ok=True)
        for asset in assets:
            safe_name = Path(asset.filename or "video.bin").name
            if not re.fullmatch(r"[A-Za-z0-9._-]+", safe_name):
                raise HTTPException(status_code=400, detail="Asset filename is unsafe.")
            (assets_directory / safe_name).write_bytes(await asset.read())
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not save export asset: {exc}") from exc
    return result
