#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import html
import io
import json
import tempfile
import threading
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, List, Optional, Sequence, Tuple

import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import fitz
from ebooklib import epub
from PIL import Image, ImageStat
# inlined convert_pdf_to_epub from v1_4 (single-file build)
from PySide6.QtCore import QThread, Signal, Qt
from PySide6.QtGui import QPixmap, QImage, QPainter, QColor, QPalette, QBrush
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QProgressBar,
    QCheckBox,
    QComboBox,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

APP_NAME = "BookCraft"
APP_VERSION = " [1.7.2]"


def one_line(text: str) -> str:
    text = re.sub(r"[\ud800-\udfff]", "", (text or ""))
    return re.sub(r"\s+", " ", text).strip()


def sanitize_for_filename(text: str) -> str:
    text = one_line(text)
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    return text.strip(" .") or "Untitled"


def split_author_last(author_full: str) -> str:
    author_full = one_line(author_full)
    if not author_full:
        return "Unknown"
    if "," in author_full:
        return sanitize_for_filename(author_full.split(",", 1)[0])
    return sanitize_for_filename(author_full.split()[-1])


def cleaned_pdf_stem_title(stem: str) -> str:
    text = one_line(stem).replace("_", " ")
    text = re.sub(r"\b(oceanofpdf(?:\.com)?|libgen|z-library|zlibrary)\b", "", text, flags=re.I)
    text = re.sub(r"\b(edit|final|fixed|fin|v\d+(?:\.\d+)*)\b", "", text, flags=re.I)
    text = re.sub(r"\s{2,}", " ", text).strip(" -_,.")
    return text or "Untitled"


def title_looks_non_bookish(title: str) -> bool:
    t = one_line(title)
    if not t or t.lower() in {"untitled", "document"}:
        return True
    low = t.lower()
    if re.search(r"(oceanofpdf|\.pdf\b|http[s]?://|www\.)", low):
        return True
    if re.search(r"[_]{2,}|[|]{1,}|[{}/\\\\]{1,}", t):
        return True
    if re.search(r"\b(edit|final|fixed|v\d+(?:\.\d+)*)\b", low):
        return True
    return False


def fetch_amazon_title_guess(title: str, author: str = "", timeout_sec: float = 8.0) -> Optional[str]:
    """
    Best-effort Amazon lookup (no API key): parse first product title from search HTML.
    Returns None when not available.
    """
    query = one_line(f"{title} {author}").strip()
    if not query:
        return None
    url = "https://www.amazon.com/s?" + urllib.parse.urlencode({"k": query, "i": "stripbooks"})
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
            )
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
    except Exception:
        return None

    patterns = [
        r'class="a-size-medium a-color-base a-text-normal">([^<]{3,260})<',
        r'class="a-size-base-plus a-color-base a-text-normal">([^<]{3,260})<',
    ]
    for pat in patterns:
        m = re.search(pat, body, flags=re.I)
        if not m:
            continue
        cand = one_line(html.unescape(m.group(1)))
        if cand and not title_looks_non_bookish(cand):
            return cand[:220]
    return None


def resolve_official_title(candidate_title: str, author: str = "", pdf_path: Optional[Path] = None) -> str:
    base = one_line(candidate_title)
    if pdf_path is not None and (not base or base.lower() == "untitled"):
        base = cleaned_pdf_stem_title(pdf_path.stem)

    if title_looks_non_bookish(base):
        amz = fetch_amazon_title_guess(base, author)
        if amz:
            return amz
        if pdf_path is not None:
            return cleaned_pdf_stem_title(pdf_path.stem)
    return base or "Untitled"


def guess_output_name(pdf_path: Path) -> tuple[str, str, str, str]:
    title = pdf_path.stem
    subtitle = ""
    author = "Unknown"
    pages = "-"
    toc_count = "-"
    try:
        doc = fitz.open(str(pdf_path))
        bm = build_meta(doc, pdf_path)
        title = bm.title or title
        subtitle = bm.subtitle or ""
        author = bm.author_full or author
        pages = str(doc.page_count)
        toc_count = str(len(doc.get_toc(simple=False) or []))
        doc.close()
    except Exception:
        pass
    title_part = sanitize_for_filename(title)
    subtitle_part = sanitize_for_filename(subtitle) if one_line(subtitle) else ""
    author_last = split_author_last(author)
    file_name = f"{title_part}{' - ' + subtitle_part if subtitle_part else ''}, {author_last} - edit.epub"
    return file_name, title, author, f"{pages} pages, {toc_count} bookmarks"



# ----- Inlined Converter Core (from bookcraft_v1_4.py) -----
# ----------------------------- Models -----------------------------


@dataclass
class TocEntry:
    level: int
    title: str
    page: int  # 1-based pdf page


@dataclass
class BookMeta:
    title: str
    subtitle: str
    author_full: str
    author_last: str


# ----------------------------- Helpers -----------------------------


def one_line(text: str) -> str:
    text = text or ""
    # Remove invalid Unicode surrogate code points from broken PDF text/metadata.
    text = re.sub(r"[\ud800-\udfff]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def sanitize_for_filename(text: str) -> str:
    text = one_line(text)
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text or "Untitled"


def split_author_last(author_full: str) -> str:
    author_full = one_line(author_full)
    if not author_full:
        return "Unknown"
    # Handle "Last, First"
    if "," in author_full:
        return sanitize_for_filename(author_full.split(",", 1)[0])
    parts = author_full.split()
    return sanitize_for_filename(parts[-1]) if parts else "Unknown"


def _is_probable_title_line(line: str) -> bool:
    t = one_line(line)
    if not t:
        return False
    low = t.lower()
    if len(t) < 3 or len(t) > 180:
        return False
    if re.fullmatch(r"\d+", t):
        return False
    if re.search(r"(copyright|all rights reserved|isbn|library of congress|printed in|edition)", low):
        return False
    if re.search(r"(oceanofpdf|www\.|http://|https://|\.com)", low):
        return False
    return True


def title_from_front_matter(doc: fitz.Document, max_pages: int = 8) -> Tuple[str, str]:
    """
    Best-effort title fallback from cover/title/copyright/front-matter pages.
    Prefers larger text spans on early pages.
    """
    if doc.page_count == 0:
        return "Untitled", ""

    span_candidates: List[Tuple[float, int, float, str]] = []
    for pno in range(min(max_pages, doc.page_count)):
        page = doc.load_page(pno)
        try:
            data = page.get_text("dict")
        except Exception:
            data = {}
        for block in data.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    txt = one_line(str(span.get("text", "")))
                    if not _is_probable_title_line(txt):
                        continue
                    size = float(span.get("size", 10.0))
                    score = size + (8.0 - float(pno)) * 0.6
                    y = float(span.get("bbox", [0, 0, 0, 0])[1])
                    span_candidates.append((score, pno, y, txt))

    if not span_candidates:
        return "Untitled", ""

    span_candidates.sort(key=lambda x: (-x[0], x[1], x[2]))
    top_score, top_page, top_y, top_title = span_candidates[0]
    title = top_title[:180]

    subtitle = ""
    for score, pno, y, txt in span_candidates[1:]:
        if pno != top_page:
            continue
        if txt.lower() == title.lower():
            continue
        if y <= top_y:
            continue
        if score > top_score + 0.5:
            continue
        subtitle = txt[:180]
        break

    return title, subtitle


def title_from_first_page(doc: fitz.Document) -> Tuple[str, str]:
    # Backward-compatible alias: front matter detection is stronger than page-1 only.
    return title_from_front_matter(doc, max_pages=1)


def build_meta(doc: fitz.Document, pdf_path: Optional[Path] = None) -> BookMeta:
    md = doc.metadata or {}
    md_title = one_line(md.get("title", ""))
    md_author = one_line(md.get("author", ""))

    title, subtitle = title_from_front_matter(doc)

    official_title = md_title if md_title else title
    official_title = resolve_official_title(official_title, md_author, pdf_path)
    # If we still got a weak/derived title, trust front-matter extraction.
    if title and not title_looks_non_bookish(title):
        stem_title = cleaned_pdf_stem_title(pdf_path.stem).lower() if pdf_path is not None else ""
        if title_looks_non_bookish(official_title) or (stem_title and one_line(official_title).lower() == stem_title):
            official_title = title
    # If metadata title contains subtitle separator, split once.
    if not subtitle:
        m = re.split(r"\s*[:\-–—]\s*", official_title, maxsplit=1)
        if len(m) == 2 and len(m[1]) <= 120:
            official_title, subtitle = m[0], m[1]

    author_full = md_author if md_author else "Unknown Author"
    author_last = split_author_last(author_full)

    return BookMeta(
        title=one_line(official_title) or "Untitled",
        subtitle=one_line(subtitle),
        author_full=author_full,
        author_last=author_last,
    )


def fetch_openlibrary_cover(meta: BookMeta, timeout_sec: float = 8.0) -> Optional[Tuple[bytes, str]]:
    """
    Try to fetch a medium/large cover from Open Library.
    Returns (bytes, ext) or None.
    """
    title = one_line(meta.title)
    author = one_line(meta.author_full).replace("Author", "").strip()
    if not title:
        return None

    query = {"title": title, "limit": 6}
    if author and author.lower() != "unknown":
        query["author"] = author
    search_url = "https://openlibrary.org/search.json?" + urllib.parse.urlencode(query)

    try:
        with urllib.request.urlopen(search_url, timeout=timeout_sec) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="ignore"))
    except Exception:
        return None

    docs = payload.get("docs", []) if isinstance(payload, dict) else []
    cover_ids: List[int] = []
    for d in docs:
        cid = d.get("cover_i")
        if isinstance(cid, int) and cid > 0:
            cover_ids.append(cid)

    # Prefer larger "L", then fallback "M".
    for cid in cover_ids[:5]:
        for size in ("L", "M"):
            url = f"https://covers.openlibrary.org/b/id/{cid}-{size}.jpg"
            try:
                with urllib.request.urlopen(url, timeout=timeout_sec) as resp:
                    data = resp.read()
                if len(data) > 5000:
                    return data, "jpg"
            except Exception:
                continue
    return None


def read_custom_cover_image(path: Path) -> Optional[Tuple[bytes, str]]:
    if not path.exists() or not path.is_file():
        return None
    ext = path.suffix.lower().lstrip(".")
    if ext in {"jpg", "jpeg", "png"}:
        try:
            return path.read_bytes(), ("jpg" if ext in {"jpg", "jpeg"} else "png")
        except Exception:
            return None
    try:
        img = Image.open(path).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90, optimize=True)
        return buf.getvalue(), "jpg"
    except Exception:
        return None


def _median_font_size(values: Sequence[float]) -> float:
    nums = sorted(v for v in values if v > 0)
    if not nums:
        return 0.0
    mid = len(nums) // 2
    if len(nums) % 2:
        return nums[mid]
    return (nums[mid - 1] + nums[mid]) / 2.0


def _normalize_toc_key(title: str) -> str:
    t = one_line(title).lower()
    t = re.sub(r"(?<=\d)\.(?=\s|$)", "", t)
    t = re.sub(r"[:\-–—]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip(" .")
    return t


def _format_heading_candidate(lines: Sequence[str]) -> str:
    parts = [one_line(x) for x in lines if one_line(x)]
    if not parts:
        return ""
    if len(parts) >= 2 and re.match(r"^(chapter|part|appendix)\s+\w+[.]?$", parts[0], re.I):
        prefix = re.sub(r"[.]$", "", parts[0])
        suffix = " ".join(parts[1:3]).strip()
        return f"{prefix}: {suffix}" if suffix else prefix
    return " ".join(parts[:3])


def _guess_toc_heading(page: fitz.Page) -> Optional[TocEntry]:
    try:
        data = page.get_text("dict")
    except Exception:
        return None

    text_lines: List[Tuple[float, float, str]] = []
    font_sizes: List[float] = []
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if one_line(str(s.get("text", "")))]
            if not spans:
                continue
            line_text = one_line("".join(str(s.get("text", "")) for s in spans))
            if not line_text:
                continue
            y0 = min(float((s.get("bbox") or [0, 0, 0, 0])[1]) for s in spans)
            max_size = max(float(s.get("size", 0.0)) for s in spans)
            text_lines.append((y0, max_size, line_text))
            font_sizes.extend(float(s.get("size", 0.0)) for s in spans)

    if not text_lines:
        return None

    body_size = _median_font_size(font_sizes) or 12.0
    heading_threshold = max(body_size * 1.45, body_size + 5.0)
    top_limit = max(160.0, float(page.rect.height) * 0.38)

    candidates = [
        (y0, size, text)
        for y0, size, text in text_lines
        if y0 <= top_limit and size >= heading_threshold and not re.fullmatch(r"\d+", text)
    ]
    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0])
    heading_lines: List[str] = []
    first_y = candidates[0][0]
    for y0, _size, text in candidates:
        if y0 - first_y > 110:
            break
        if len(heading_lines) >= 3:
            break
        heading_lines.append(text)

    title = _format_heading_candidate(heading_lines)
    if not title:
        return None

    chapter_match = re.match(r"^(chapter|part|appendix)\s+\w+(?:[:.\-–—]\s+|\s+.+)?", title, re.I)
    section_match = re.match(r"^\d+(?:\.\d+)+\s+.+", title)
    simple_number_match = re.match(r"^\d+\.\s+.+", title)
    if chapter_match:
        level = 1
    elif section_match:
        level = 2
    elif simple_number_match:
        level = 1
    else:
        return None

    return TocEntry(level=level, title=title[:160], page=page.number + 1)


def collect_toc(doc: fitz.Document) -> List[TocEntry]:
    toc_raw = doc.get_toc(simple=True) or []
    entries: List[TocEntry] = []

    for row in toc_raw:
        if len(row) < 3:
            continue
        level, title, page = row[0], one_line(str(row[1])), int(row[2])
        if not title or page <= 0 or page > doc.page_count:
            continue
        entries.append(TocEntry(level=max(1, level), title=title, page=page))

    if entries:
        return entries

    # Fallback: detect real display headings near the top of the page.
    guessed: List[TocEntry] = []
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        candidate = _guess_toc_heading(page)
        if candidate is not None:
            guessed.append(candidate)

    # Deduplicate repeated running headers and noisy near-duplicates.
    final: List[TocEntry] = []
    seen_titles = set()
    for e in guessed:
        key = _normalize_toc_key(e.title)
        if key in seen_titles:
            continue
        seen_titles.add(key)
        final.append(e)

    if not final:
        final = [TocEntry(level=1, title="Start", page=1)]

    return final


def render_page_image(
    page: fitz.Page,
    max_width: int,
    quality: int,
    format_mode: str = "hybrid",
    min_jpeg_reduction: float = 0.08,
    preserve_pdf_dimensions: bool = False,
) -> Tuple[bytes, int, int, str]:
    """
    Render one page once and choose output format without double recompression.
    - Build a lossless PNG baseline.
    - Build one JPEG candidate from the same source image.
    - Use JPEG only if it is meaningfully smaller; otherwise keep PNG.
    """
    # Scale to max_width while preserving aspect ratio, unless preserving native PDF page dimensions.
    rect = page.rect
    if preserve_pdf_dimensions:
        zoom = 1.0
    else:
        zoom = max_width / rect.width if rect.width > 0 else 1.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)

    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

    png_img = apply_png_quality(img, quality)
    png_buf = io.BytesIO()
    png_img.save(png_buf, format="PNG", optimize=True, compress_level=9)
    png_bytes = optimize_png_lossless(png_buf.getvalue())

    jpg_buf = io.BytesIO()
    jpg_q = max(30, min(100, int(quality)))
    img.save(jpg_buf, format="JPEG", quality=jpg_q, optimize=True, progressive=True)
    jpg_bytes = jpg_buf.getvalue()

    format_mode = one_line(format_mode).lower()
    if format_mode in {"jpeg", "jpg", "auto_jpeg", "auto-jpeg", "auto"}:
        return jpg_bytes, img.width, img.height, "jpeg"
    if format_mode in {"png", "lossless"}:
        return png_bytes, img.width, img.height, "png"

    # Hybrid: keep JPEG only when it saves enough size to justify lossy conversion.
    if len(png_bytes) > 0:
        reduction = 1.0 - (len(jpg_bytes) / len(png_bytes))
    else:
        reduction = 1.0

    if reduction >= min_jpeg_reduction:
        return jpg_bytes, img.width, img.height, "jpeg"
    return png_bytes, img.width, img.height, "png"


def apply_png_quality(img: Image.Image, quality: int) -> Image.Image:
    """
    Apply an image-quality policy to PNG output.
    - 100: keep original RGB pixels (lossless)
    - <100: adaptive palette quantization to reduce size
    """
    q = max(1, min(100, int(quality)))
    if q >= 100:
        return img
    # Map quality 1..99 => color count 32..255
    colors = max(32, min(255, int(round(32 + (q / 100.0) * 223))))
    try:
        return img.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
    except Exception:
        return img


def optimize_png_lossless(png_bytes: bytes) -> bytes:
    """
    Maximize lossless PNG compression.
    - Always performs Pillow optimize+compress_level=9 upstream.
    - If oxipng is available locally, run an additional lossless optimization pass.
    """
    if not png_bytes:
        return png_bytes
    oxipng = shutil.which("oxipng")
    if not oxipng:
        return png_bytes

    tmp_in: Optional[tempfile.NamedTemporaryFile] = None
    try:
        tmp_in = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
        tmp_in.write(png_bytes)
        tmp_in.flush()
        tmp_in.close()

        # Lossless optimization only.
        subprocess.run(
            [oxipng, "-o", "max", "--strip", "safe", "--quiet", tmp_in.name],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        out = Path(tmp_in.name).read_bytes()
        if out and len(out) < len(png_bytes):
            return out
        return png_bytes
    except Exception:
        return png_bytes
    finally:
        if tmp_in is not None:
            try:
                os.unlink(tmp_in.name)
            except Exception:
                pass


def has_meaningful_text(text: str) -> bool:
    # Ignore pages with only tiny fragments/page numbers.
    if not text:
        return False
    letters = re.findall(r"[A-Za-z]", text)
    return len(letters) >= 20


def is_visually_blank(page: fitz.Page) -> bool:
    # Low-res grayscale probe: "blank" means very bright + very low variance.
    pix = page.get_pixmap(matrix=fitz.Matrix(0.35, 0.35), alpha=False, colorspace=fitz.csGRAY)
    img = Image.frombytes("L", [pix.width, pix.height], pix.samples)
    stat = ImageStat.Stat(img)
    mean = stat.mean[0]
    std = stat.stddev[0]
    return mean >= 248 and std <= 2.6


def should_skip_blank_page(page: fitz.Page, raw_text: str) -> bool:
    # Keep any page with meaningful text, otherwise skip only if image is visually blank.
    if has_meaningful_text(raw_text):
        return False
    try:
        return is_visually_blank(page)
    except Exception:
        # Be conservative if probe fails.
        return False


def page_needs_rare_image(page: fitz.Page, raw_text: str) -> bool:
    """
    For text-first mode, add a page image only when visual fidelity is likely needed.
    Heuristics: low text confidence, embedded images, math/symbol-heavy text, or many vector drawings.
    """
    txt = raw_text or ""
    if not has_meaningful_text(txt):
        return True

    lines = [one_line(line) for line in txt.splitlines() if one_line(line)]
    short_lines = sum(1 for line in lines if len(line) <= 12)
    isolated_lines = sum(1 for line in lines if len(line) <= 4)
    mathy_lines = sum(
        1
        for line in lines
        if re.search(r"[=+\-/*()\[\]{}]|[˙ˆ✓⇥]|(?:\bcos\b|\bsin\b|\bdt\b)", line)
    )
    figure_lines = sum(1 for line in lines if re.match(r"^(figure|table)\s+\d", line, re.I))

    try:
        if len(page.get_images(full=False)) > 0:
            return True
    except Exception:
        pass

    if re.search(r"[∑∫√≈≠≤≥∞πθλμΔ∂∇∈∉⊂⊆⊕⊗±÷×]", txt):
        return True

    try:
        drawing_count = len(page.get_drawings())
        if drawing_count >= 40:
            return True
    except Exception:
        drawing_count = 0

    if figure_lines and (short_lines >= 8 or mathy_lines >= 4):
        return True

    if short_lines >= 14 and mathy_lines >= 6:
        return True

    if isolated_lines >= 6 and (mathy_lines >= 4 or drawing_count >= 10):
        return True

    return False


def page_requires_image_only(page: fitz.Page, raw_text: str) -> bool:
    txt = raw_text or ""
    lines = [one_line(line) for line in txt.splitlines() if one_line(line)]
    if not lines:
        return False

    short_lines = sum(1 for line in lines if len(line) <= 12)
    isolated_lines = sum(1 for line in lines if len(line) <= 4)
    mathy_lines = sum(
        1
        for line in lines
        if re.search(r"[=+\-/*()\[\]{}]|[˙ˆ✓⇥]|(?:\bcos\b|\bsin\b|\bdt\b)", line)
    )
    figure_lines = sum(1 for line in lines if re.match(r"^(figure|table)\s+\d", line, re.I))

    try:
        drawing_count = len(page.get_drawings())
    except Exception:
        drawing_count = 0

    if figure_lines and (short_lines >= 6 or mathy_lines >= 4):
        return True
    if short_lines >= 14 and mathy_lines >= 6:
        return True
    if isolated_lines >= 6 and (mathy_lines >= 4 or drawing_count >= 10):
        return True
    if isolated_lines >= 1 and mathy_lines >= 8:
        return True
    if drawing_count >= 40:
        return True

    return False


def page_looks_toc_like(raw_text: str) -> bool:
    txt = raw_text or ""
    if not txt:
        return False
    lines = [one_line(line) for line in txt.splitlines() if one_line(line)]
    if len(lines) < 8:
        return False
    joined = "\n".join(lines[:80])
    dotted_rows = sum(1 for line in lines if line.count(".") >= 6)
    section_rows = sum(1 for line in lines if re.match(r"^\d+(?:\.\d+)*\s*$", line) or re.match(r"^\d+(?:\.\d+)+\s+", line))
    has_contents_header = any(line.lower() == "contents" for line in lines[:4])
    return has_contents_header and dotted_rows >= 8 and section_rows >= 8


def remap_to_kept_page(page_no: int, kept_pages: Sequence[int]) -> Optional[int]:
    if not kept_pages:
        return None
    if page_no in kept_pages:
        return page_no
    for p in kept_pages:
        if p > page_no:
            return p
    return kept_pages[-1]


def find_logical_start_page(toc_entries: Sequence[TocEntry]) -> int:
    """
    Choose the page that should be logical page 1.
    Prefer the first TOC entry that clearly indicates Chapter 1.
    """
    chapter1_patterns = [
        re.compile(r"^\s*chapter\s*1\b", re.I),
        re.compile(r"^\s*1[\.\s]\s*\S+", re.I),
        re.compile(r"^\s*section\s*1\b", re.I),
    ]
    for e in toc_entries:
        title = one_line(e.title)
        if any(p.search(title) for p in chapter1_patterns):
            return max(1, e.page)
    if toc_entries:
        return max(1, min(e.page for e in toc_entries))
    return 1


def logical_page_number(pdf_page: int, start_page: int) -> int:
    return pdf_page - start_page + 1


def page_text_to_xhtml(page: fitz.Page, raw_text: str) -> str:
    # Reconstruct paragraphs from page geometry so wrapped PDF lines do not
    # collapse into unreadable walls of text.
    try:
        data = page.get_text("dict")
    except Exception:
        data = {}

    body_widths: List[float] = []
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if one_line(str(s.get("text", "")))]
            if not spans:
                continue
            bbox = line.get("bbox") or [0, 0, 0, 0]
            x0, _y0, x1, _y1 = map(float, bbox[:4])
            width = x1 - x0
            if width > 140:
                body_widths.append(width)
    typical_width = _median_font_size(body_widths) or 0.0

    paragraphs: List[str] = []
    current_lines: List[str] = []
    prev_line: Optional[Tuple[float, float, float, float, str]] = None

    def flush_paragraph():
        nonlocal current_lines
        if not current_lines:
            return
        joined_parts: List[str] = []
        for line in current_lines:
            if not joined_parts:
                joined_parts.append(line)
                continue
            if joined_parts[-1].endswith("-") and re.search(r"[A-Za-z]-$", joined_parts[-1]):
                joined_parts[-1] = joined_parts[-1][:-1] + line.lstrip()
            else:
                joined_parts.append(line)
        para = one_line(" ".join(joined_parts))
        if para:
            paragraphs.append(para)
        current_lines = []

    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if one_line(str(s.get("text", "")))]
            if not spans:
                flush_paragraph()
                prev_line = None
                continue
            line_text = one_line("".join(str(s.get("text", "")) for s in spans))
            if not line_text:
                continue

            bbox = line.get("bbox") or [0, 0, 0, 0]
            x0, y0, x1, y1 = map(float, bbox[:4])
            line_h = max(1.0, y1 - y0)

            starts_new_para = False
            if prev_line is not None:
                prev_x0, prev_y0, prev_x1, prev_y1, prev_text = prev_line
                gap_y = y0 - prev_y1
                indent_delta = x0 - prev_x0
                prev_width = prev_x1 - prev_x0
                curr_width = x1 - x0
                prev_ended_sentence = bool(re.search(r'[.!?]["\')\]]?$', prev_text))
                next_looks_para_start = bool(re.match(r"^[A-Z\"'(\[]", line_text))
                prev_was_short = typical_width > 0 and prev_width <= typical_width * 0.82

                if gap_y > max(4.0, line_h * 0.45):
                    starts_new_para = True
                elif indent_delta > 10.0:
                    starts_new_para = True
                elif prev_width < curr_width * 0.72 and re.search(r"[.!?\"')\]]$", prev_text):
                    starts_new_para = True
                elif prev_ended_sentence and prev_was_short and next_looks_para_start:
                    starts_new_para = True

            if starts_new_para:
                flush_paragraph()

            current_lines.append(line_text)
            prev_line = (x0, y0, x1, y1, line_text)

        flush_paragraph()
        prev_line = None

    if not paragraphs:
        paras = [one_line(p) for p in re.split(r"\n\s*\n", raw_text) if one_line(p)]
        if not paras:
            paras = [""]
        paragraphs = paras

    return "\n".join(f"<p>{html_escape(p)}</p>" for p in paragraphs)


def sanitize_unicode_text(s: str) -> str:
    return re.sub(r"[\ud800-\udfff]", "", s or "")


def html_escape_raw(s: str) -> str:
    s = sanitize_unicode_text(s)
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def html_escape(s: str) -> str:
    s = one_line(s)
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def clean_toc_label(title: str) -> str:
    """
    Remove leading numeric section prefixes like:
    - '1.2 Intro'
    - '10.3.1 Details'
    Keep chapter labels (e.g., 'CHAPTER 3 ...') intact.
    """
    t = one_line(title)
    if re.match(r"^\s*chapter\b", t, flags=re.I):
        return t
    t = re.sub(r"^\s*\d+(?:\.\d+)+\s+", "", t)
    t = re.sub(r"^\s*\d+\.\s+", "", t)
    return one_line(t)


def make_output_filename(meta: BookMeta) -> str:
    title = sanitize_for_filename(meta.title)
    subtitle_raw = one_line(meta.subtitle)
    subtitle = sanitize_for_filename(subtitle_raw) if subtitle_raw else ""
    author_last = sanitize_for_filename(meta.author_last or "")
    title_part = f"{title} - {subtitle}" if subtitle else title
    return f"{title_part}, {author_last} - edit.epub"


def page_text_layer_html(page: fitz.Page) -> str:
    rect = page.rect
    if rect.width <= 0 or rect.height <= 0:
        return ""
    try:
        pd = page.get_text("dict")
    except Exception:
        return ""

    parts: List[str] = []
    for block in pd.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = sanitize_unicode_text(str(span.get("text", ""))).replace("\n", " ")
                if not text.strip():
                    continue
                bbox = span.get("bbox")
                if not bbox or len(bbox) < 4:
                    continue
                x0, y0, _x1, _y1 = bbox
                left = max(0.0, min(100.0, (float(x0) / float(rect.width)) * 100.0))
                top = max(0.0, min(100.0, (float(y0) / float(rect.height)) * 100.0))
                size_pt = float(span.get("size", 10.0))
                size_pct = max(0.25, min(6.0, (size_pt / float(rect.height)) * 100.0))
                parts.append(
                    f"<span class='t' style='left:{left:.4f}%;top:{top:.4f}%;font-size:{size_pct:.4f}%;'>{html_escape_raw(text)}</span>"
                )
    return "".join(parts)


# ----------------------------- Core Conversion -----------------------------


def convert_pdf_to_epub(
    pdf_path: Path,
    out_dir: Path,
    image_max_width: int = 1200,
    image_quality: int = 58,
    render_mode: str = "hybrid",
    image_format_mode: str = "hybrid",
    cover_source: str = "auto",
    cover_image_path: Optional[Path] = None,
    book_title_override: Optional[str] = None,
    output_filename: Optional[str] = None,
    include_toc_grandchildren: bool = False,
    progress_cb: Optional[Callable[[int, str], None]] = None,
) -> Path:
    def emit_progress(pct: int, stage: str = ""):
        if progress_cb is None:
            return
        try:
            progress_cb(max(0, min(100, int(pct))), one_line(stage))
        except Exception:
            pass

    emit_progress(2, "Opening PDF")
    doc = fitz.open(str(pdf_path))
    meta = build_meta(doc, pdf_path)
    if one_line(book_title_override):
        meta.title = one_line(book_title_override)
        meta.subtitle = ""
    toc_entries = collect_toc(doc)
    logical_start_page = find_logical_start_page(toc_entries)
    emit_progress(8, "Reading metadata and TOC")

    book = epub.EpubBook()
    book_id = f"pdf2epub-{sanitize_for_filename(meta.title).lower().replace(' ', '-')}-{doc.page_count}"
    book.set_identifier(book_id)
    book.set_title(f"{meta.title}{' - ' + meta.subtitle if meta.subtitle else ''}")
    book.set_language("en")
    book.add_author(meta.author_full)

    css = epub.EpubItem(
        uid="style_main",
        file_name="styles/main.css",
        media_type="text/css",
        content=(
            "body{font-family:Georgia,'Times New Roman',serif;font-size:13pt;line-height:1.25;margin:0;padding:0;}"
            ".page{margin:0 auto 1.25em auto;max-width:68em;padding:0 1em;}"
            ".page img{display:block;max-width:100%;height:auto;margin:0 auto 0.75em auto;border:0;}"
            ".txt p{font-size:13pt;margin:0 0 .55em 0;text-indent:0;}"
            ".meta{color:#555;font-size:.9em;margin:0 0 .5em 0;}"
            ".page-stack{position:relative;display:block;}"
            ".page-stack img{display:block;width:100%;height:auto;margin:0;}"
            ".text-layer{position:absolute;inset:0;line-height:1;color:transparent;-webkit-text-fill-color:transparent;user-select:text;-webkit-user-select:text;pointer-events:auto;}"
            ".text-layer .t{position:absolute;white-space:pre;font-family:Georgia,'Times New Roman',serif;}"
            "body.image-only{margin:0 !important;padding:0 !important;}"
            "body.image-only .page{margin:0 !important;padding:0 !important;max-width:none !important;}"
            "body.image-only .page img{display:block;width:100% !important;max-width:none !important;height:auto !important;margin:0 !important;padding:0 !important;}"
            "h1,h2{font-weight:600;margin:.4em 0;}"
        ).encode("utf-8"),
    )
    book.add_item(css)
    nav_css = epub.EpubItem(
        uid="style_nav",
        file_name="styles/nav.css",
        media_type="text/css",
        content=(
            "nav > ol,nav > ul{list-style:none !important;margin:0 !important;padding-left:0 !important;counter-reset:none !important;}"
            "nav ol ol,nav ul ul,nav ol ul,nav ul ol{list-style:none !important;padding-left:1.2em !important;margin:.05em 0 .05em .35em !important;}"
            "nav li{list-style:none !important;margin:.12em 0 !important;}"
            "nav li::marker{content:'' !important;}"
            "nav a{text-decoration:none;}"
        ).encode("utf-8"),
    )
    book.add_item(nav_css)

    spine_items: List[epub.EpubHtml] = []
    page_doc_by_pdf_page: dict[int, epub.EpubHtml] = {}
    kept_pdf_pages: List[int] = []

    # Cover from selected source (manual image, online, or PDF first page).
    cover_source = one_line(cover_source).lower() or "auto"
    if cover_source not in {"auto", "pdf", "online"}:
        cover_source = "auto"
    cover_bytes: Optional[bytes] = None
    cover_ext = "jpg"

    if cover_image_path is not None:
        custom = read_custom_cover_image(cover_image_path)
        if custom is not None:
            cover_bytes, cover_ext = custom

    if cover_bytes is None and cover_source in {"auto", "online"}:
        fetched = fetch_openlibrary_cover(meta)
        if fetched is not None:
            cover_bytes, cover_ext = fetched
    if cover_bytes is None:
        first_page = doc.load_page(0)
        cover_bytes, _, _, cover_fmt = render_page_image(
            first_page,
            image_max_width,
            image_quality,
            format_mode=image_format_mode,
            preserve_pdf_dimensions=(render_mode == "image"),
        )
        cover_ext = "jpg" if cover_fmt == "jpeg" else "png"

    cover_name = f"cover.{cover_ext}"
    # EbookLib can auto-generate cover.xhtml; disable that because we provide our own
    # cover page below and Kindle validation rejects duplicate cover entries.
    book.set_cover(cover_name, cover_bytes, create_page=False)

    cover = epub.EpubHtml(title="Cover", file_name="cover.xhtml", lang="en")
    cover.content = (
        "<html><head><link rel='stylesheet' href='styles/main.css'/></head>"
        f"<body><div class='page'><img src='{cover_name}' alt='Cover'/></div></body></html>"
    )
    book.add_item(cover)
    spine_items.append(cover)
    emit_progress(15, "Cover ready")

    render_mode = (render_mode or "hybrid").strip().lower()
    if render_mode not in {"hybrid", "image", "text", "overlay"}:
        render_mode = "hybrid"

    # Build each page chapter.
    for i in range(doc.page_count):
        page = doc.load_page(i)
        page_no = i + 1
        shown_page = logical_page_number(page_no, logical_start_page)
        shown_page_label = str(shown_page) if shown_page >= 1 else str(page_no)
        raw_text = ""

        if render_mode == "image":
            try:
                if is_visually_blank(page):
                    continue
            except Exception:
                pass
        else:
            raw_text = page.get_text("text")
            if should_skip_blank_page(page, raw_text):
                continue

        force_image_only = render_mode in {"hybrid", "text"} and (
            page_looks_toc_like(raw_text) or page_requires_image_only(page, raw_text)
        )
        use_image = render_mode != "text" or page_needs_rare_image(page, raw_text) or force_image_only
        img_name: Optional[str] = None
        if use_image:
            img_bytes, _, _, img_fmt = render_page_image(
                page,
                image_max_width,
                image_quality,
                format_mode=image_format_mode,
                preserve_pdf_dimensions=(render_mode == "image"),
            )
            img_ext = "jpg" if img_fmt == "jpeg" else "png"
            img_media = "image/jpeg" if img_fmt == "jpeg" else "image/png"
            img_name = f"images/p{page_no:04d}.{img_ext}"
            img_item = epub.EpubItem(
                uid=f"img_{page_no:04d}",
                file_name=img_name,
                media_type=img_media,
                content=img_bytes,
            )
            book.add_item(img_item)

        flow_text = page_text_to_xhtml(page, raw_text) if render_mode in {"hybrid", "text"} and not force_image_only else ""
        text_layer = page_text_layer_html(page) if render_mode == "overlay" else ""

        chap = epub.EpubHtml(
            title=f"Page {shown_page_label}",
            file_name=f"text/p{page_no:04d}.xhtml",
            lang="en",
        )
        if render_mode == "image":
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body class='image-only'>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                "</div></body></html>"
            )
        elif render_mode == "text" and force_image_only:
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body class='image-only'>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                "</div></body></html>"
            )
        elif render_mode == "text":
            img_html = f"<img src='../{img_name}' alt='Page {page_no}'/>" if img_name else ""
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {shown_page_label}</div>"
                f"{img_html}"
                f"<div class='txt'>{flow_text}</div>"
                "</div></body></html>"
            )
        elif render_mode == "overlay":
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {shown_page_label}</div>"
                "<div class='page-stack'>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                f"<div class='text-layer'>{text_layer}</div>"
                "</div>"
                "</div></body></html>"
            )
        elif force_image_only:
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body class='image-only'>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                "</div></body></html>"
            )
        else:
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {shown_page_label}</div>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                f"<div class='txt'>{flow_text}</div>"
                "</div></body></html>"
            )
        book.add_item(chap)
        page_doc_by_pdf_page[page_no] = chap
        kept_pdf_pages.append(page_no)
        spine_items.append(chap)
        emit_progress(15 + int(((i + 1) / max(1, doc.page_count)) * 70), f"Processed page {i + 1}/{doc.page_count}")

    # Avoid producing an empty book body if all pages were filtered.
    if not kept_pdf_pages and doc.page_count > 0:
        page = doc.load_page(0)
        page_no = 1
        shown_page = logical_page_number(page_no, logical_start_page)
        shown_page_label = str(shown_page) if shown_page >= 1 else str(page_no)
        raw_text = page.get_text("text") if render_mode != "image" else ""
        force_image_only = render_mode in {"hybrid", "text"} and (
            page_looks_toc_like(raw_text) or page_requires_image_only(page, raw_text)
        )
        use_image = render_mode != "text" or page_needs_rare_image(page, raw_text) or force_image_only
        img_name: Optional[str] = None
        if use_image:
            img_bytes, _, _, img_fmt = render_page_image(
                page,
                image_max_width,
                image_quality,
                format_mode=image_format_mode,
                preserve_pdf_dimensions=(render_mode == "image"),
            )
            img_ext = "jpg" if img_fmt == "jpeg" else "png"
            img_media = "image/jpeg" if img_fmt == "jpeg" else "image/png"
            img_name = f"images/p{page_no:04d}.{img_ext}"
            img_item = epub.EpubItem(
                uid=f"img_{page_no:04d}",
                file_name=img_name,
                media_type=img_media,
                content=img_bytes,
            )
            book.add_item(img_item)

        flow_text = page_text_to_xhtml(page, raw_text) if render_mode in {"hybrid", "text"} and not force_image_only else ""
        text_layer = page_text_layer_html(page) if render_mode == "overlay" else ""
        chap = epub.EpubHtml(
            title=f"Page {shown_page_label}",
            file_name=f"text/p{page_no:04d}.xhtml",
            lang="en",
        )
        if render_mode == "image":
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body class='image-only'>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                "</div></body></html>"
            )
        elif render_mode == "text" and force_image_only:
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body class='image-only'>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                "</div></body></html>"
            )
        elif render_mode == "text":
            img_html = f"<img src='../{img_name}' alt='Page {page_no}'/>" if img_name else ""
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {shown_page_label}</div>"
                f"{img_html}"
                f"<div class='txt'>{flow_text}</div>"
                "</div></body></html>"
            )
        elif render_mode == "overlay":
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {shown_page_label}</div>"
                "<div class='page-stack'>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                f"<div class='text-layer'>{text_layer}</div>"
                "</div>"
                "</div></body></html>"
            )
        elif force_image_only:
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body class='image-only'>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                "</div></body></html>"
            )
        else:
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {shown_page_label}</div>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                f"<div class='txt'>{flow_text}</div>"
                "</div></body></html>"
            )
        book.add_item(chap)
        page_doc_by_pdf_page[page_no] = chap
        kept_pdf_pages.append(page_no)
        spine_items.append(chap)

    # TOC page (human-readable overview): chapter-level only.
    toc_page = epub.EpubHtml(title="Table of Contents", file_name="toc.xhtml", lang="en")
    toc_nodes = []
    for e in toc_entries:
        if e.level != 1:
            continue
        target_page = remap_to_kept_page(e.page, kept_pdf_pages)
        if target_page is None:
            continue
        shown_page = logical_page_number(e.page, logical_start_page)
        shown_page_label = shown_page if shown_page >= 1 else e.page
        title = clean_toc_label(e.title)
        href = f"text/p{target_page:04d}.xhtml#page{target_page:04d}"
        toc_nodes.append((title, shown_page_label, href))

    toc_items = [
        (
            "<li class='toc-item'>"
            "<div class='toc-row'>"
            f"<a href='{href}'>{html_escape(title)}</a>"
            f"<span class='toc-page'>p. {html_escape(str(page_lbl))}</span>"
            "</div></li>"
        )
        for title, page_lbl, href in toc_nodes
    ]

    toc_page.content = (
        "<html><head><link rel='stylesheet' href='styles/main.css'/></head><body>"
        "<div class='page'><h1>Table of Contents</h1>"
        "<style>"
        "ul.toc-root,ul.toc-children{list-style:none;margin:0;padding:0;}"
        ".toc-item{margin:.18em 0;}"
        ".toc-row{display:flex;justify-content:space-between;align-items:baseline;gap:.8em;}"
        ".toc-row a{text-decoration:none;}"
        ".toc-page{color:#666;white-space:nowrap;}"
        "</style><ul class='toc-root'>"
        + "".join(toc_items)
        + "</ul></div></body></html>"
    )
    book.add_item(toc_page)
    emit_progress(90, "Building TOC")

    # EPUB TOC structure from collected entries (master/sidebar TOC).
    max_master_level = 3 if include_toc_grandchildren else 2
    epub_toc = []
    for e in toc_entries:
        if e.level > max_master_level:
            continue
        target_page = remap_to_kept_page(e.page, kept_pdf_pages)
        if target_page is None:
            continue
        shown_page = logical_page_number(e.page, logical_start_page)
        shown_page_label = shown_page if shown_page >= 1 else e.page
        title = f"{clean_toc_label(e.title)} (p. {shown_page_label})"
        href_doc = page_doc_by_pdf_page[target_page]
        link = epub.Link(href_doc.file_name + f"#page{target_page:04d}", title, f"toc_{e.page}_{abs(hash(title)) % 100000}")
        epub_toc.append((e.level, link))

    # Build nested toc from (level, link).
    def nest(entries: Sequence[Tuple[int, epub.Link]], base_level: int = 1):
        result = []
        i = 0
        while i < len(entries):
            lvl, link = entries[i]
            if lvl < base_level:
                break
            if lvl > base_level:
                i += 1
                continue

            j = i + 1
            while j < len(entries) and entries[j][0] > base_level:
                j += 1
            children = nest(entries[i + 1 : j], base_level + 1)
            result.append((link, children) if children else link)
            i = j
        return tuple(result)

    book.toc = (epub.Link("cover.xhtml", "Cover", "cover"), epub.Link("toc.xhtml", "Table of Contents", "toc")) + nest(epub_toc, 1)

    book.add_item(epub.EpubNcx())
    nav_doc = epub.EpubNav()
    nav_doc.add_link(href="styles/nav.css", rel="stylesheet", type="text/css")
    book.add_item(nav_doc)

    # Reading order: nav + cover + toc + pages.
    book.spine = ["nav", cover, toc_page] + spine_items[1:]

    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = make_output_filename(meta)
    if output_filename is not None:
        custom = one_line(output_filename)
        if custom.lower().endswith(".epub"):
            custom = custom[:-5]
        custom = sanitize_for_filename(custom)
        if custom:
            out_name = f"{custom}.epub"
    out_path = out_dir / out_name
    emit_progress(96, "Writing EPUB")
    epub.write_epub(str(out_path), book, {})

    doc.close()
    emit_progress(100, "Complete")
    return out_path


# ----- End Inlined Converter Core -----

class ConvertWorker(QThread):
    done = Signal(str)
    failed = Signal(str)
    progress = Signal(int, str)

    def __init__(
        self,
        pdf: Path,
        out: Path,
        mode: str,
        width: int,
        quality: int,
        image_format_mode: str,
        book_title_override: str,
        output_filename: str,
        include_toc_grandchildren: bool,
        cover_source: str,
        cover_image: str,
    ):
        super().__init__()
        self.pdf = pdf
        self.out = out
        self.mode = mode
        self.width = width
        self.quality = quality
        self.image_format_mode = image_format_mode
        self.book_title_override = book_title_override
        self.output_filename = output_filename
        self.include_toc_grandchildren = include_toc_grandchildren
        self.cover_source = cover_source
        self.cover_image = cover_image

    def run(self):
        try:
            out_path = convert_pdf_to_epub(
                self.pdf,
                self.out,
                image_max_width=self.width,
                image_quality=self.quality,
                render_mode=self.mode,
                image_format_mode=self.image_format_mode,
                cover_source=self.cover_source,
                cover_image_path=Path(self.cover_image) if self.cover_image else None,
                book_title_override=self.book_title_override,
                output_filename=self.output_filename,
                include_toc_grandchildren=self.include_toc_grandchildren,
                progress_cb=lambda pct, msg: self.progress.emit(int(pct), str(msg)),
            )
            self.done.emit(str(out_path))
        except Exception as e:
            self.failed.emit(str(e) or "Conversion failed")


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(f"{APP_NAME} {APP_VERSION}")
        self.resize(1220, 820)
        self.worker: ConvertWorker | None = None
        self.last_out = ""
        #self.out_dir = str(Path.home() / "Downloads") => real path use
        
        # Temporary Default Path for convenience. This isn't persisted across app restarts.
        self.out_dir = str(Path.home() / "Downloads/_bookcraft - books")

        root = QWidget()
        root.setObjectName("rootPanel")
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setContentsMargins(6, 6, 6, 6)
        layout.setSpacing(6)

        banner = QFrame()
        banner.setStyleSheet("QFrame{background:#7f1d1d;border-radius:8px;padding:4px;}")
        b_layout = QVBoxLayout(banner)
        b_layout.setContentsMargins(8, 6, 8, 6)
        b_layout.setSpacing(3)
        h1 = QLabel(f"{APP_NAME} {APP_VERSION}")
        h1.setStyleSheet("font-size: 28px; font-weight: 700; color: #ffffff;")
        h2 = QLabel("Native macOS dashboard: stable rendering, cover preview, and full conversion controls.")
        h2.setStyleSheet("font-size: 13px; color: #ffffff;")
        b_layout.addWidget(h1)
        b_layout.addWidget(h2)
        banner_line = QFrame()
        banner_line.setFixedHeight(1)
        banner_line.setStyleSheet("background:#b9b9b9; border:none;")
        b_layout.addWidget(banner_line)
        self.top_progress = QProgressBar()
        self.top_progress.setTextVisible(False)
        self.top_progress.setRange(0, 100)
        self.top_progress.setValue(0)
        self.top_progress.setFixedHeight(6)
        self.top_progress.setStyleSheet(
            "QProgressBar{border:none;background:#b9b9b9;max-height:6px;min-height:6px;border-radius:2px;}"
            "QProgressBar::chunk{background:#8a8a8a;}"
        )
        b_layout.addWidget(self.top_progress)
        layout.addWidget(banner)

        row = QHBoxLayout()
        layout.addLayout(row)

        left = QGroupBox("Conversion Setup")
        left.setStyleSheet(
            "QGroupBox{font-weight:700; font-size:13px; border:2px solid rgba(64,64,64,128); border-radius:8px; margin-top:4px; padding-top:4px;}"
            "QGroupBox::title{subcontrol-origin: margin; left:10px; padding:0 4px; color:#2f2f2f;}"
        )
        lgrid = QGridLayout(left)
        lgrid.setColumnStretch(0, 0)
        lgrid.setColumnStretch(1, 1)
        row.addWidget(left, 3)

        right = QGroupBox("Book Details")
        right.setStyleSheet(
            "QGroupBox{font-weight:700; font-size:13px; border:2px solid rgba(64,64,64,128); border-radius:8px; margin-top:4px; padding-top:4px;}"
            "QGroupBox::title{subcontrol-origin: margin; left:10px; padding:0 4px; color:#2f2f2f;}"
        )
        rgrid = QGridLayout(right)
        row.addWidget(right, 2)

        self.btn_pdf = QPushButton("Select PDF")
        self.btn_pdf.clicked.connect(self.pick_pdf)
        self.btn_pdf.setFixedWidth(150)
        self.pdf_path_lbl = QLabel("No PDF selected")
        self.pdf_path_lbl.setWordWrap(True)

        self.btn_out = QPushButton("Output Folder")
        self.btn_out.clicked.connect(self.pick_out)
        self.btn_out.setFixedWidth(150)
        self.out_path_edit = QLineEdit(self.out_dir)
        self.out_path_edit.setReadOnly(True)
        self.out_path_edit.setStyleSheet("QLineEdit{padding-left:8px;}")
        self.btn_cover = QPushButton("Add Cover")
        self.btn_cover.clicked.connect(self.pick_cover)
        self.btn_cover.setFixedWidth(150)
        self.cover_path_edit = QLineEdit("None (using source setting)")
        self.cover_path_edit.setReadOnly(True)
        self.cover_path_edit.setStyleSheet("QLineEdit{padding-left:8px;}")

        self.mode = QComboBox()
        self.mode.addItems(["Flowable Hybrid (Image + Text)", "Image Pages (Image Only)", "Text Pages (Images Rare)", "Image + Hidden Text Layer"])
        self.mode.currentIndexChanged.connect(self.on_mode_changed)
        self.preset = QComboBox()
        self.preset.addItems(["Balanced (Recommended)", "High Quality (Larger)", "Small Size (Smaller)"])
        self.preset.currentIndexChanged.connect(self.apply_preset)
        self.cover_source = QComboBox()
        self.cover_source.addItems(["Auto (Online then PDF)", "PDF First Page", "Online Only"])

        self.width = QLineEdit("1500")
        self.width.setStyleSheet("QLineEdit{padding-left:8px;}")
        self.width_unit = QComboBox()
        self.width_unit.addItems(["Original (PDF native)", "Pixels (px)", "Percent (%)", "Inches (in)"])
        self.width_unit.setFixedWidth(150)
        self.quality = QComboBox()
        self.quality.addItems(
            [
                "Original (100)",
                "95",
                "90",
                "85",
                "80",
                "75",
                "70",
                "65",
                "60",
                "55",
                "50",
                "45",
            ]
        )
        self.quality.setCurrentText("Original (100)")
        self.image_format = QComboBox()
        self.image_format.addItems(["Auto (JPEG)", "PNG (Lossless)", "Hybrid (Smart PNG/JPEG)"])
        self.auto_open = QCheckBox("Open output folder when done")
        self.auto_open.setChecked(True)
        self.include_toc_grandchildren = QCheckBox("Include TOC grandchildren (e.g., 3.1.2)")
        self.include_toc_grandchildren.setChecked(False)

        self.btn_create = QPushButton("Create EPUB")
        self.btn_create.clicked.connect(self.convert)
        self.btn_clear = QPushButton("Clear Log")
        self.btn_clear.clicked.connect(lambda: self.log.setPlainText(""))
        self.btn_quit = QPushButton("Quit")
        self.btn_quit.clicked.connect(self.close)
        self.btn_restart = QPushButton("Restart App")
        self.btn_restart.clicked.connect(self.restart_app)
        self.btn_create.setFixedWidth(150)
        self.btn_clear.setFixedWidth(150)
        self.btn_quit.setFixedWidth(150)
        self.btn_restart.setFixedWidth(150)
        self.btn_create.setStyleSheet("QPushButton{background:#7f1d1d;color:#ffffff;border:1px solid #6d1616;border-radius:6px;padding:4px 10px;} QPushButton:hover{background:#8f2424;}")
        self.btn_restart.setStyleSheet("QPushButton{border:2px solid #7f1d1d;border-radius:6px;padding:3px 10px;}")

        lgrid.addWidget(QLabel("Source PDF"), 0, 0)
        lgrid.addWidget(self.btn_pdf, 1, 0)
        lgrid.addWidget(self.pdf_path_lbl, 1, 1)
        lgrid.addWidget(QLabel("Output Folder"), 2, 0)
        lgrid.addWidget(self.btn_out, 3, 0)
        lgrid.addWidget(self.out_path_edit, 3, 1)
        lgrid.addWidget(QLabel("Custom Cover"), 4, 0)
        lgrid.addWidget(self.btn_cover, 5, 0)
        lgrid.addWidget(self.cover_path_edit, 5, 1)
        lgrid.addWidget(QLabel("Render Mode"), 6, 0)
        lgrid.addWidget(self.mode, 6, 1)
        lgrid.addWidget(QLabel("Preset"), 7, 0)
        lgrid.addWidget(self.preset, 7, 1)
        lgrid.addWidget(QLabel("Cover source"), 8, 0)
        lgrid.addWidget(self.cover_source, 8, 1)
        lgrid.addWidget(QLabel("Image width value"), 9, 0)
        width_row = QWidget()
        width_row_layout = QHBoxLayout(width_row)
        width_row_layout.setContentsMargins(0, 0, 0, 0)
        width_row_layout.setSpacing(8)
        width_row_layout.addWidget(self.width, 1)
        width_row_layout.addWidget(self.width_unit, 0, Qt.AlignRight)
        lgrid.addWidget(width_row, 9, 1)
        lgrid.addWidget(QLabel("Suggested: 1500 px | 100% baseline=1500px | 10in=1500px"), 10, 0, 1, 2)
        lgrid.addWidget(QLabel("Image quality"), 11, 0)
        quality_row = QWidget()
        quality_row_layout = QHBoxLayout(quality_row)
        quality_row_layout.setContentsMargins(0, 0, 0, 0)
        quality_row_layout.addWidget(self.quality, 1)
        lgrid.addWidget(quality_row, 11, 1)
        lgrid.addWidget(QLabel("Page image format"), 12, 0)
        lgrid.addWidget(self.image_format, 12, 1)
        lgrid.addWidget(self.auto_open, 13, 0, 1, 2)
        lgrid.addWidget(self.include_toc_grandchildren, 14, 0, 1, 2)

        btnrow = QHBoxLayout()
        btnrow.addWidget(self.btn_clear)
        btnrow.addWidget(self.btn_quit)
        btnrow.addWidget(self.btn_restart)
        btnrow.addWidget(self.btn_create)
        lgrid.addLayout(btnrow, 15, 0, 1, 2)

        self.cover = QLabel("No cover preview")
        self.cover.setFixedSize(220, 300)
        self.cover.setFrameShape(QFrame.StyledPanel)
        self.cover.setAlignment(Qt.AlignCenter)
        self.meta_title = QLabel("-")
        self.meta_title.setWordWrap(True)
        self.meta_author = QLabel("-")
        self.meta_stats = QLabel("-")
        self.output_preview = QLineEdit()
        self.output_preview.setPlaceholderText("Output file name will appear here")
        self.output_preview.setStyleSheet("QLineEdit{padding-left:8px;}")
        self.book_title_edit = QLineEdit()
        self.book_title_edit.setPlaceholderText("Book title will appear here")
        self.book_title_edit.setStyleSheet("QLineEdit{padding-left:8px;}")

        self.btn_open_out = QPushButton("Open Output Folder")
        self.btn_open_out.clicked.connect(self.open_out)
        self.btn_open_epub = QPushButton("Open Latest EPUB")
        self.btn_open_epub.setEnabled(False)
        self.btn_open_epub.clicked.connect(self.open_latest)
        self.btn_open_out.setFixedWidth(150)
        self.btn_open_epub.setFixedWidth(150)

        rgrid.addWidget(QLabel("Cover Preview"), 0, 0)
        rgrid.addWidget(self.cover, 1, 0)
        rgrid.addWidget(QLabel("Detected Title"), 2, 0)
        rgrid.addWidget(self.meta_title, 3, 0)
        rgrid.addWidget(QLabel("Detected Author"), 4, 0)
        rgrid.addWidget(self.meta_author, 5, 0)
        rgrid.addWidget(QLabel("Document Stats"), 6, 0)
        rgrid.addWidget(self.meta_stats, 7, 0)
        rgrid.addWidget(QLabel("Output Filename"), 8, 0)
        rgrid.addWidget(self.output_preview, 9, 0)
        rgrid.addWidget(QLabel("Book Title"), 10, 0)
        rgrid.addWidget(self.book_title_edit, 11, 0)

        rbtn = QHBoxLayout()
        rbtn.addWidget(self.btn_open_out)
        rbtn.addWidget(self.btn_open_epub)
        rgrid.addLayout(rbtn, 12, 0)

        self.status = QLabel("Ready.")
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        self.log.setStyleSheet("QTextEdit{border:2px solid rgba(64,64,64,128); border-radius:8px; background:#ffffff;}")
        layout.addWidget(self.status)
        layout.addWidget(self.log, 1)
        self.log_msg("Ready. 1) Select PDF 2) Output Folder 3) Create EPUB")
        self.on_mode_changed()

        # Background watermark hidden (plain gray background only).

    def log_msg(self, msg: str):
        self.log.append(msg)

    def crop_icon_with_padding(self, src: QPixmap, pad: int = 20) -> QPixmap:
        img = src.toImage().convertToFormat(QImage.Format_ARGB32)
        w = img.width()
        h = img.height()
        if w <= 0 or h <= 0:
            return src

        min_x, min_y = w, h
        max_x, max_y = -1, -1
        for y in range(h):
            for x in range(w):
                if QColor(img.pixel(x, y)).alpha() > 8:
                    if x < min_x:
                        min_x = x
                    if y < min_y:
                        min_y = y
                    if x > max_x:
                        max_x = x
                    if y > max_y:
                        max_y = y

        if max_x < 0 or max_y < 0:
            return src

        min_x = max(0, min_x - pad)
        min_y = max(0, min_y - pad)
        max_x = min(w - 1, max_x + pad)
        max_y = min(h - 1, max_y + pad)
        rect_w = max_x - min_x + 1
        rect_h = max_y - min_y + 1
        return src.copy(min_x, min_y, rect_w, rect_h)

    def apply_tiled_watermark(self, target: QWidget, image_path: Path):
        if not image_path.exists():
            return
        src = QPixmap(str(image_path))
        if src.isNull():
            return
        src = self.crop_icon_with_padding(src, pad=20)

        # 10% icon size, 50% opacity, tight checkerboard tiling.
        scaled = src.scaled(
            max(1, int(src.width() * 0.10)),
            max(1, int(src.height() * 0.10)),
            Qt.KeepAspectRatio,
            Qt.SmoothTransformation,
        )
        w = max(1, scaled.width())
        h = max(1, scaled.height())
        # Tight pitch to remove large gaps.
        tile_w = max(1, w)
        tile_h = max(1, h)
        tile = QPixmap(tile_w, tile_h)
        tile.fill(Qt.transparent)
        painter = QPainter(tile)
        painter.setOpacity(0.50)
        # Checkerboard: one icon at origin, one offset by half-pitch.
        painter.drawPixmap(0, 0, scaled)
        painter.drawPixmap(tile_w // 2, tile_h // 2, scaled)
        painter.end()

        pal = target.palette()
        pal.setColor(QPalette.Window, QColor("#bdbdbd"))
        pal.setBrush(QPalette.Window, QBrush(tile))
        target.setAutoFillBackground(True)
        target.setPalette(pal)

    def apply_preset(self):
        p = self.preset.currentText()
        if p.startswith("High Quality"):
            self.width.setText("1600")
            self.width_unit.setCurrentText("Pixels (px)")
            self.quality.setCurrentText("90")
            self.image_format.setCurrentText("Hybrid (Smart PNG/JPEG)")
        elif p.startswith("Small Size"):
            self.width.setText("1000")
            self.width_unit.setCurrentText("Pixels (px)")
            self.quality.setCurrentText("55")
            self.image_format.setCurrentText("Auto (JPEG)")
        else:
            self.width.setText("1500")
            self.width_unit.setCurrentText("Pixels (px)")
            self.quality.setCurrentText("75")
            self.image_format.setCurrentText("Auto (JPEG)")
        self.on_mode_changed()

    def on_mode_changed(self):
        image_only = self.mode.currentText().startswith("Image Pages")
        if image_only:
            self.image_format.setCurrentText("PNG (Lossless)")
            self.image_format.setEnabled(False)
            if "Image-only mode: page format forced to PNG (Lossless)." not in self.status.text():
                self.log_msg("Image-only mode: page format forced to PNG (Lossless).")
        else:
            self.image_format.setEnabled(True)

    def pick_pdf(self):
        p, _ = QFileDialog.getOpenFileName(self, "Select PDF", str(f'{Path.home()}/Downloads'), "PDF Files (*.pdf)")
        if not p:
            return
        path = Path(p)
        self.pdf_path_lbl.setText(str(path))
        file_name, title, author, stats = guess_output_name(path)
        # Always refresh the suggested output filename when a new PDF is selected.
        self.output_preview.setText(file_name)
        self.output_preview.setCursorPosition(0)
        self.book_title_edit.setText(title)
        self.book_title_edit.setCursorPosition(0)
        self.meta_title.setText(title)
        self.meta_author.setText(author)
        self.meta_stats.setText(stats)
        try:
            doc = fitz.open(str(path))
            native_w = int(round(doc.load_page(0).rect.width))
            doc.close()
            self.width.setText(str(native_w))
        except Exception:
            self.width.setText("1500")
        self.width_unit.setCurrentText("Original (PDF native)")
        self.update_cover(path)
        self.log_msg(f"Selected PDF: {path}")

    def update_cover(self, path: Path):
        try:
            doc = fitz.open(str(path))
            p0 = doc.load_page(0)
            pix = p0.get_pixmap(matrix=fitz.Matrix(0.25, 0.25), alpha=False)
            qimg = QImage(pix.samples, pix.width, pix.height, pix.stride, QImage.Format_RGB888)
            self.cover.setPixmap(QPixmap.fromImage(qimg).scaled(self.cover.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation))
            doc.close()
        except Exception:
            self.cover.setText("No cover preview")

    def pick_out(self):
        d = QFileDialog.getExistingDirectory(self, "Select Output Folder", self.out_dir)
        if d:
            self.out_dir = d
            self.out_path_edit.setText(d)
            self.log_msg(f"Output folder: {d}")

    def pick_cover(self):
        p, _ = QFileDialog.getOpenFileName(
            self,
            "Select Cover Image",
            str(Path.home()),
            "Image Files (*.jpg *.jpeg *.png *.webp *.bmp *.tif *.tiff)",
        )
        if p:
            self.cover_path_edit.setText(p)
        # update preview immediately from manual cover
        pix = QPixmap(p)
        if not pix.isNull():
            self.cover.setPixmap(
                pix.scaled(self.cover.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation)
            )
            self.cover.setText("")
        else:
            self.cover.setText("No cover preview")
        self.log_msg(f"Custom cover image: {p}")

    def set_busy(self, busy: bool):
        for w in [self.btn_pdf, self.btn_out, self.btn_cover, self.mode, self.preset, self.cover_source, self.width, self.width_unit, self.quality, self.image_format, self.output_preview, self.book_title_edit, self.btn_create, self.btn_restart, self.include_toc_grandchildren]:
            w.setEnabled(not busy)

    def compute_width_px(self) -> int:
        # Baseline mapping for non-pixel units:
        # 100% -> 1500 px, 1 in -> 150 px.
        raw = float(self.width.text().strip())
        unit = self.width_unit.currentText()
        if unit.startswith("Original"):
            pdf = Path(self.pdf_path_lbl.text())
            if pdf.exists():
                try:
                    d = fitz.open(str(pdf))
                    w = int(round(d.load_page(0).rect.width))
                    d.close()
                    return max(400, min(3000, w))
                except Exception:
                    pass
            width_px = 1500
        elif unit.startswith("Percent"):
            width_px = round(1500.0 * (raw / 100.0))
        elif unit.startswith("Inches"):
            width_px = round(raw * 150.0)
        else:
            width_px = round(raw)
        return max(700, min(2600, int(width_px)))

    def current_image_quality(self) -> int:
        txt = one_line(self.quality.currentText())
        m = re.search(r"(\d{1,3})", txt)
        if not m:
            return 100
        return max(1, min(100, int(m.group(1))))

    def convert(self):
        pdf = Path(self.pdf_path_lbl.text())
        out = Path(self.out_dir)
        if not pdf.exists():
            QMessageBox.critical(self, "Missing PDF", "Select a valid PDF.")
            return
        if not out.exists():
            QMessageBox.critical(self, "Missing Output Folder", "Select a valid output folder.")
            return
        try:
            width = self.compute_width_px()
            quality = self.current_image_quality()
        except ValueError:
            QMessageBox.critical(self, "Invalid Settings", "Width and quality must be numeric values.")
            return

        mode = "hybrid"
        if self.mode.currentText().startswith("Image Pages"):
            mode = "image"
        elif self.mode.currentText().startswith("Text Pages"):
            mode = "text"
        elif self.mode.currentText().startswith("Image + Hidden"):
            mode = "overlay"
        image_format_mode = "auto_jpeg"
        if self.image_format.currentText().startswith("PNG"):
            image_format_mode = "png"
        elif self.image_format.currentText().startswith("Hybrid"):
            image_format_mode = "hybrid"
        if mode == "image":
            image_format_mode = "png"
        cover_source = "auto"
        if self.cover_source.currentText().startswith("PDF"):
            cover_source = "pdf"
        elif self.cover_source.currentText().startswith("Online"):
            cover_source = "online"
        self.set_busy(True)
        self.status.setText("Converting... Please wait.")
        self.top_progress.setRange(0, 100)
        self.top_progress.setValue(0)
        self.log_msg(
            f"Starting conversion mode={mode}, imgfmt={image_format_mode}, cover={cover_source}, width={self.width.text().strip()} {self.width_unit.currentText()} -> {width}px, quality={quality}"
        )
        cover_image = self.cover_path_edit.text().strip()
        if cover_image.startswith("None "):
            cover_image = ""
        if cover_image and not os.path.exists(cover_image):
            QMessageBox.critical(self, "Missing Cover Image", "Custom cover image path is invalid.")
            self.set_busy(False)
            return
        book_title_override = self.book_title_edit.text().strip()
        output_filename = self.output_preview.text().strip()
        include_toc_grandchildren = self.include_toc_grandchildren.isChecked()
        self.worker = ConvertWorker(
            pdf,
            out,
            mode,
            width,
            quality,
            image_format_mode,
            book_title_override,
            output_filename,
            include_toc_grandchildren,
            cover_source,
            cover_image,
        )
        self.worker.progress.connect(self.on_progress)
        self.worker.done.connect(self.on_done)
        self.worker.failed.connect(self.on_fail)
        self.worker.start()

    def on_progress(self, pct: int, stage: str):
        self.top_progress.setRange(0, 100)
        self.top_progress.setValue(max(0, min(100, int(pct))))
        if stage:
            self.status.setText(f"Converting... {stage}")

    def on_done(self, out_path: str):
        self.set_busy(False)
        self.top_progress.setRange(0, 100)
        self.top_progress.setValue(100)
        self.last_out = out_path
        self.btn_open_epub.setEnabled(True)
        self.status.setText(f"Done: {out_path}")
        self.log_msg(f"Done: {out_path}")
        if self.auto_open.isChecked():
            self.open_out()

    def on_fail(self, err: str):
        self.set_busy(False)
        self.top_progress.setRange(0, 100)
        self.top_progress.setValue(0)
        self.status.setText("Conversion failed")
        self.log_msg(f"Error: {err}")
        QMessageBox.critical(self, "Error", err)

    def open_out(self):
        d = Path(self.out_dir)
        if d.exists():
            if sys.platform == "darwin":
                os.system(f"open '{d}'")
            elif os.name == "nt":
                os.startfile(str(d))  # type: ignore[attr-defined]
            else:
                os.system(f"xdg-open '{d}'")

    def open_latest(self):
        p = Path(self.last_out)
        if p.exists():
            if sys.platform == "darwin":
                os.system(f"open '{p}'")
            elif os.name == "nt":
                os.startfile(str(p))  # type: ignore[attr-defined]
            else:
                os.system(f"xdg-open '{p}'")

    def restart_app(self):
        py = sys.executable or "python3"
        script = str(Path(__file__).resolve())
        if os.name == "nt":
            cmd = f'timeout /t 3 /nobreak >nul & "{py}" "{script}"'
            subprocess.Popen(["cmd", "/c", cmd], close_fds=True)
        else:
            cmd = f"sleep 3; {shlex.quote(py)} {shlex.quote(script)}"
            subprocess.Popen(["/bin/bash", "-lc", cmd], close_fds=True)
        self.close()


def main_qt():
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main_qt())
