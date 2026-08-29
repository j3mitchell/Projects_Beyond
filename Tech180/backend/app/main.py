from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
import ipaddress
import os
import secrets
import socket
from typing import Literal, Optional
from urllib.parse import urljoin, urlparse, urlunparse

import httpx
import re
import json
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .stripe_webhook import router as stripe_webhook_router


# The root .env is private local configuration. Hosting platforms should inject
# production variables directly instead of uploading this file.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

TECH180_ENV = os.getenv("TECH180_ENV", "development").strip().lower()
TECH180_API_TOKEN = os.getenv("TECH180_API_TOKEN", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "TECH180_ALLOWED_ORIGINS",
        "http://127.0.0.1:4050,http://localhost:4050",
    ).split(",")
    if origin.strip()
]


async def require_api_access(
    authorization: Optional[str] = Header(default=None),
    x_tech180_api_key: Optional[str] = Header(default=None),
) -> dict[str, str]:
    """Verify either the local development key or a production Supabase user.

    Production requests carry the user's short-lived Supabase access token. The
    API asks Supabase to validate that token, then reads the user's own Tech180
    entitlement through RLS. A public publishable key identifies this project;
    it does not grant administrator access.
    """
    if TECH180_ENV != "production":
        if not TECH180_API_TOKEN:
            raise HTTPException(status_code=503, detail="The Tech180 API credential is not configured.")
        if not x_tech180_api_key or not secrets.compare_digest(x_tech180_api_key, TECH180_API_TOKEN):
            raise HTTPException(status_code=401, detail="Valid Tech180 authentication is required.")
        return {"id": "local-development", "email": "local@jisystems.net"}

    if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
        raise HTTPException(status_code=503, detail="Production authentication is not configured.")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in before using Tech180.")

    access_token = authorization.split(" ", 1)[1].strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="The account session is missing.")

    request_headers = {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": f"Bearer {access_token}",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            user_response = await client.get(f"{SUPABASE_URL}/auth/v1/user", headers=request_headers)
            if user_response.status_code != 200:
                raise HTTPException(status_code=401, detail="The account session is invalid or expired.")
            user = user_response.json()

            entitlement_response = await client.get(
                f"{SUPABASE_URL}/rest/v1/tool_entitlements",
                headers={**request_headers, "Accept": "application/json"},
                params={
                    "user_id": f"eq.{user['id']}",
                    "tool_slug": "eq.tech180",
                    "select": "status,expires_at",
                    "limit": "1",
                },
            )
            if entitlement_response.status_code != 200:
                raise HTTPException(status_code=503, detail="Tech180 access could not be verified.")
    except HTTPException:
        raise
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="The account service is temporarily unavailable.") from exc

    entitlements = entitlement_response.json()
    entitlement = entitlements[0] if entitlements else None
    expires_at = entitlement.get("expires_at") if entitlement else None
    if expires_at:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if expiry <= datetime.now(timezone.utc):
            entitlement = None
    if not entitlement or entitlement.get("status") != "active":
        raise HTTPException(status_code=403, detail="Your account does not currently include Tech180 access.")

    return {"id": str(user["id"]), "email": str(user.get("email") or "")}


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
MAX_SOURCE_HTML_BYTES = 25 * 1024 * 1024
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

  const inheritedProperties = new Set([
    "color", "cursor", "font", "font-family", "font-size", "font-style",
    "font-weight", "letter-spacing", "line-height", "list-style", "text-align",
    "text-decoration", "text-transform", "visibility", "white-space"
  ]);

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

  const elements = Array.from(document.querySelectorAll("html, body, body *"));
  const snapshots = new Map();

  // Read every computed style before changing the document. This prevents an
  // earlier parent cleanup from changing the values observed on its children.
  for (const element of elements) {
    const styles = window.getComputedStyle(element);
    element.dataset.tech180Visible = isVisible(element, styles) ? "true" : "false";

    const values = {};
    for (const property of copiedProperties) values[property] = styles.getPropertyValue(property);
    snapshots.set(element, values);

    if (element.tagName === "IMG" && element.currentSrc) {
      element.setAttribute("src", element.currentSrc);
      // Freeze the browser-selected rendered image. Keeping the website's old
      // responsive list can make `srcset` override this working `src` later.
      element.removeAttribute("srcset");
      element.removeAttribute("sizes");
      element.setAttribute("loading", "eager");
    }
  }

  const elementDeclarations = new Map();
  for (const element of elements) {
    const values = snapshots.get(element);
    const parentValues = snapshots.get(element.parentElement);

    const declarations = new Map();
    for (const property of copiedProperties) {
      const value = values[property];
      if (!value) continue;
      // Keep inherited styling at the highest ancestor that establishes it.
      // A child receives a declaration only when it genuinely differs.
      if (inheritedProperties.has(property) && parentValues && parentValues[property] === value) continue;
      declarations.set(property, value);
    }

    element.removeAttribute("style");
    elementDeclarations.set(element, declarations);
  }

  // A manual graduation pass may run on a page that Tech180 already organized.
  // The snapshots above preserve the page's current appearance, so old generated
  // rules and class names can now be removed before rebuilding cleaner groups.
  document.querySelectorAll(
    "style[data-tech180-promoted-styles], style[data-tech180-captured-styles], " +
    "style[data-tech180-class-overrides]"
  ).forEach(function(style) { style.remove(); });
  elements.forEach(function(element) {
    Array.from(element.classList).forEach(function(className) {
      if (
        className.indexOf("tech180-shared-") === 0 ||
        className.indexOf("tech180-captured-") === 0
      ) element.classList.remove(className);
    });
  });

  // Promote repeated property/value pairs to the largest original class whose
  // complete membership shares that value. This keeps shared styling editable
  // at class level without accidentally changing an exception.
  const classMembers = new Map();
  for (const element of elements) {
    for (const className of element.classList) {
      if (className.indexOf("tech180-captured-") === 0) continue;
      if (!classMembers.has(className)) classMembers.set(className, []);
      classMembers.get(className).push(element);
    }
  }

  const candidatesByPair = new Map();
  classMembers.forEach(function(members, className) {
    if (members.length < 2) return;
    const firstDeclarations = elementDeclarations.get(members[0]);
    if (!firstDeclarations) return;
    firstDeclarations.forEach(function(value, property) {
      const sharedByEveryMember = members.every(function(member) {
        return elementDeclarations.get(member)?.get(property) === value;
      });
      if (!sharedByEveryMember) return;
      const pairKey = JSON.stringify([property, value]);
      if (!candidatesByPair.has(pairKey)) candidatesByPair.set(pairKey, []);
      candidatesByPair.get(pairKey).push({ className, members, property, value });
    });
  });

  const promotedByClass = new Map();
  candidatesByPair.forEach(function(candidates) {
    // An element can share the same value through several classes. Give it to
    // the widest safe class first, then continue until every matching group is
    // covered. This prevents identical values from lingering on #element.
    candidates.sort(function(left, right) { return right.members.length - left.members.length; });
    const coveredMembers = new Set();
    candidates.forEach(function(candidate) {
      const uncoveredMembers = candidate.members.filter(function(member) {
        const declarations = elementDeclarations.get(member);
        return !coveredMembers.has(member) && declarations?.get(candidate.property) === candidate.value;
      });
      if (!uncoveredMembers.length) return;
      if (!promotedByClass.has(candidate.className)) {
        promotedByClass.set(candidate.className, new Map());
      }
      promotedByClass.get(candidate.className).set(candidate.property, candidate.value);
      candidate.members.forEach(function(member) {
        coveredMembers.add(member);
        const declarations = elementDeclarations.get(member);
        if (declarations?.get(candidate.property) === candidate.value) {
          declarations.delete(candidate.property);
        }
      });
    });
  });

  // Some repeated values have no usable original class in common. Group the
  // remaining identical pairs by the exact set of elements that use them and
  // create one editable shared class for that set. A value is left at element
  // level only when it is truly unique.
  const elementIndexes = new Map(elements.map(function(element, index) {
    return [element, index];
  }));
  const remainingPairs = new Map();
  elementDeclarations.forEach(function(declarations, element) {
    declarations.forEach(function(value, property) {
      // Generated shared classes only join the same kind of HTML element.
      // For example, a matching DIV and SPAN value should not be coupled merely
      // because the browser gave both the same computed default.
      const pairKey = JSON.stringify([element.tagName, property, value]);
      if (!remainingPairs.has(pairKey)) {
        remainingPairs.set(pairKey, { property, value, members: [] });
      }
      remainingPairs.get(pairKey).members.push(element);
    });
  });

  const sharedByMembership = new Map();
  remainingPairs.forEach(function(group) {
    if (group.members.length < 2) return;
    const membershipKey = group.members
      .map(function(member) { return elementIndexes.get(member); })
      .join("|");
    if (!sharedByMembership.has(membershipKey)) {
      sharedByMembership.set(membershipKey, {
        className: `tech180-shared-${sharedByMembership.size + 1}`,
        members: group.members,
        declarations: new Map()
      });
    }
    sharedByMembership.get(membershipKey).declarations.set(group.property, group.value);
    group.members.forEach(function(member) {
      elementDeclarations.get(member)?.delete(group.property);
    });
  });

  sharedByMembership.forEach(function(group) {
    promotedByClass.set(group.className, group.declarations);
    group.members.forEach(function(member) {
      member.classList.add(group.className);
    });
  });

  const promotedStyle = document.createElement("style");
  promotedStyle.setAttribute("data-tech180-promoted-styles", "true");
  promotedStyle.textContent = Array.from(promotedByClass.entries())
    .map(function(entry) {
      const className = entry[0];
      const declarations = Array.from(entry[1].entries())
        .map(function(pair) { return pair[0] + ": " + pair[1] + " !important;"; })
        .join(" ");
      return "." + CSS.escape(className) + " { " + declarations + " }";
    })
    .join("\\n");
  document.head.appendChild(promotedStyle);

  // Any remaining exception sets share compact internal capture classes.
  const groups = new Map();
  for (const element of elements) {
    const declarations = Array.from(elementDeclarations.get(element).entries())
      .map(function(pair) { return pair[0] + ": " + pair[1] + " !important;"; });
    if (declarations.length) {
      const signature = declarations.join("|");
      let group = groups.get(signature);
      if (!group) {
        group = { className: `tech180-captured-${groups.size + 1}`, declarations };
        groups.set(signature, group);
      }
      element.classList.add(group.className);
    }
  }

  const capturedStyle = document.createElement("style");
  capturedStyle.setAttribute("data-tech180-captured-styles", "true");
  capturedStyle.textContent = Array.from(groups.values())
    .map((group) => `.${group.className} { ${group.declarations.join(" ")} }`)
    .join("\\n");
  document.head.appendChild(capturedStyle);

  document.documentElement.dataset.tech180ComputedStyles = "true";
}
"""


app = FastAPI(title="Tech180 API", version="0.1.0")
app.include_router(stripe_webhook_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Authorization", "Content-Type", "X-Tech180-API-Key"],
)


class ImportRequest(BaseModel):
    url: str = Field(..., description="Public http/https page URL to recreate.")
    include_subpages: bool = True
    viewport_width: Optional[int] = Field(
        default=None,
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
    button_like: bool = False


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


class GraduateCssRequest(BaseModel):
    html: str
    viewport_width: Optional[int] = None


class GraduateCssResponse(BaseModel):
    html: str
    elements: list[EditableElement]
    promoted_classes: int


class ExportResponse(BaseModel):
    folder_name: str
    path: str


@lru_cache(maxsize=512)
def _hostname_is_public(hostname: str) -> bool:
    """Reject loopback/private targets so the importer cannot probe our server."""
    normalized = hostname.rstrip(".").lower()
    if not normalized or normalized in {"localhost", "localhost.localdomain"}:
        return False
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(normalized, None, type=socket.SOCK_STREAM)}
    except socket.gaierror:
        return False
    return bool(addresses) and all(ipaddress.ip_address(address).is_global for address in addresses)


def _validate_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL must be a valid http/https address.")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="URLs containing embedded credentials are not allowed.")
    try:
        if TECH180_ENV == "production" and parsed.port not in {None, 80, 443}:
            raise HTTPException(status_code=400, detail="Only standard website ports 80 and 443 are allowed.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="URL contains an invalid port.") from exc
    if TECH180_ENV == "production" and not _hostname_is_public(parsed.hostname or ""):
        raise HTTPException(status_code=400, detail="The URL must resolve to a public internet address.")
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
    _validate_url(str(response.url))
    if len(response.content) > MAX_SOURCE_HTML_BYTES:
        raise HTTPException(status_code=413, detail="The source page is too large to import safely.")
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
            # Local Macs use installed Chrome. The production container ships
            # Chromium, so Cloud Run launches the bundled browser.
            launch_options = {"headless": True}
            if TECH180_ENV != "production":
                launch_options["channel"] = "chrome"
            browser = await playwright.chromium.launch(**launch_options)
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
                async def block_private_network_requests(route) -> None:
                    request_url = urlparse(route.request.url)
                    if request_url.scheme in {"data", "blob", "about"}:
                        await route.continue_()
                        return
                    try:
                        allowed_port = request_url.port in {None, 80, 443}
                    except ValueError:
                        allowed_port = False
                    if (
                        request_url.scheme in {"http", "https"}
                        and allowed_port
                        and _hostname_is_public(request_url.hostname or "")
                    ):
                        await route.continue_()
                    else:
                        await route.abort("blockedbyclient")

                if TECH180_ENV == "production":
                    await page.route("**/*", block_private_network_requests)
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
                if len(rendered.encode("utf-8")) > MAX_SOURCE_HTML_BYTES:
                    raise HTTPException(status_code=413, detail="The rendered page is too large to import safely.")
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

    content_candidates = list(soup.select(CONTENT_SELECTORS))
    container_candidates = list(soup.select(CONTAINER_SELECTORS))
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

        # Store every editable element. The React sidebar paginates this full
        # collection so IDs and editing access are never capped.
        elements.append(
            EditableElement(
                id=element_id,
                type=element_type,
                label=_label_for(tag, f"{tag.name} {index}"),
                selector=f'[data-tech180-id="{element_id}"]',
                value=value,
                tag=tag.name or "element",
                button_like=(
                    tag.name == "button"
                    or tag.get("role") == "button"
                    or bool(re.search(r"(^|[-_])(btn|button|cta)([-_]|$)", " ".join(tag.get("class", [])), re.I))
                    or (
                        tag.name == "a"
                        and "background-color:" in str(tag.get("style", ""))
                        and "background-color: rgba(0, 0, 0, 0)" not in str(tag.get("style", ""))
                    )
                ),
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
    warnings.append("Scripts are disabled in imported pages so the editor can safely control the recreation.")

    return str(soup), elements, subpages, title, warnings


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "Tech180"}


@app.get("/api/access")
async def access_status(user: dict[str, str] = Depends(require_api_access)) -> dict[str, object]:
    """Give the browser a lightweight way to confirm production access."""
    return {"authenticated": True, "authorized": True, "tool": "tech180", "user_id": user["id"]}


@app.post("/api/import", response_model=ImportResponse, dependencies=[Depends(require_api_access)])
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


@app.post("/api/graduate-css", response_model=GraduateCssResponse, dependencies=[Depends(require_api_access)])
async def graduate_css(payload: GraduateCssRequest) -> GraduateCssResponse:
    """Rebuild shared CSS classes from the currently edited page."""
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as playwright:
            launch_options = {"headless": True}
            if TECH180_ENV != "production":
                launch_options["channel"] = "chrome"
            browser = await playwright.chromium.launch(**launch_options)
            context = await browser.new_context(
                viewport={"width": _normalize_viewport_width(payload.viewport_width), "height": 1200}
            )
            page = await context.new_page()
            try:
                await page.set_content(payload.html, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(250)
                await page.evaluate(COMPUTED_STYLE_SCRIPT)
                rendered = await page.content()
            finally:
                await context.close()
                await browser.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not graduate page CSS: {exc}") from exc

    soup = BeautifulSoup(rendered, "html.parser")
    elements = _annotate_elements(soup)
    _inject_editor_styles(soup)
    promoted_style = soup.find("style", attrs={"data-tech180-promoted-styles": "true"})
    promoted_classes = len(re.findall(r"\.[A-Za-z0-9_-]+\s*\{", promoted_style.get_text() if promoted_style else ""))
    return GraduateCssResponse(
        html=str(soup),
        elements=elements,
        promoted_classes=promoted_classes,
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


@app.post("/api/export", response_model=ExportResponse, dependencies=[Depends(require_api_access)])
def export_project(payload: ExportRequest) -> ExportResponse:
    required_files = {"index.html", "css/styles.css", "js/script.js"}
    if not required_files.issubset(payload.files):
        raise HTTPException(
            status_code=400,
            detail="Export must contain at least index.html, styles.css, and script.js.",
        )

    # Exported code may live only in the approved css/ and js/ folders. HTML
    # pages remain in the project root, keeping the final site easy to browse.
    def is_safe_export_path(filename: str) -> bool:
        path = Path(filename)
        if path.is_absolute() or ".." in path.parts:
            return False
        if len(path.parts) == 1:
            return path.suffix.lower() == ".html" and bool(re.fullmatch(r"[A-Za-z0-9._-]+", path.name))
        return (
            len(path.parts) == 2
            and path.parts[0] in {"css", "js", "dev"}
            and bool(re.fullmatch(r"[A-Za-z0-9._-]+", path.name))
            and (
                (path.parts[0] == "css" and path.suffix == ".css")
                or (path.parts[0] == "js" and path.suffix == ".js")
                or (path.parts[0] == "dev" and path.name == "tech180-project.json")
            )
        )

    safe_files = {filename: content for filename, content in payload.files.items() if is_safe_export_path(filename)}
    if len(safe_files) != len(payload.files):
        raise HTTPException(status_code=400, detail="Export contains an unsafe filename.")

    export_directory, folder_name = _create_export_directory()
    try:
        # Reserve a clean place for future developer-only files. This folder is
        # intentionally empty in a normal static-site export.
        (export_directory / "dev").mkdir(exist_ok=True)
        for filename, content in sorted(safe_files.items()):
            destination = export_directory / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(content, encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not write export files: {exc}") from exc

    return ExportResponse(folder_name=folder_name, path=str(export_directory))


@app.post("/api/export-assets", response_model=ExportResponse, dependencies=[Depends(require_api_access)])
async def export_project_with_assets(
    files_json: UploadFile = File(...),
    assets: list[UploadFile] = File(default=[]),
) -> ExportResponse:
    try:
        # Receive project JSON as a streamed file. Form text fields have a low
        # size ceiling that rejects realistic rendered pages before this route
        # can process them.
        files = json.loads((await files_json.read()).decode("utf-8"))
        payload = ExportRequest(files=files)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
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
