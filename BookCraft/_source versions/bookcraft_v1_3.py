#!/usr/bin/env python3
"""
PDF -> EPUB (single-file) desktop app + CLI.

Features:
- Flowable hybrid content: page image + selectable page text.
- Single-pass page image compression with smart PNG/JPEG choice.
- TOC with chapter/subsection titles + source page number (single-line labels).
- Cover page from PDF page 1.
- Book metadata from PDF metadata + title-page fallback.
- Output filename format:
  "{Book Name}{ - Subtitle if present}, {AuthorLast} - edit.epub"

Dependencies:
  pip install pymupdf ebooklib pillow

Run desktop app:
  python pdf_to_epub_desktop.py

Run CLI:
  python pdf_to_epub_desktop.py --pdf /path/book.pdf --out /path/output_dir
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import os
import re
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import fitz  # PyMuPDF
from ebooklib import epub
from PIL import Image, ImageStat, ImageTk

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox
    from tkinter import scrolledtext
except Exception:
    tk = None


# ----------------------------- Models -----------------------------

APP_NAME = "BookCraft"
APP_VERSION = "v1_3"

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


def title_from_first_page(doc: fitz.Document) -> Tuple[str, str]:
    # Best-effort fallback from first page text lines.
    if doc.page_count == 0:
        return "Untitled", ""
    p0 = doc.load_page(0)
    text = p0.get_text("text")
    lines = [one_line(x) for x in text.splitlines() if one_line(x)]
    if not lines:
        return "Untitled", ""

    # Heuristic: first prominent lines (up to 2) that are not page numbers.
    filtered = [ln for ln in lines[:12] if not re.fullmatch(r"\d+", ln)]
    if not filtered:
        return "Untitled", ""

    title = filtered[0]
    subtitle = filtered[1] if len(filtered) > 1 else ""

    # Trim overly long strings.
    title = title[:180]
    subtitle = subtitle[:180]
    return title, subtitle


def build_meta(doc: fitz.Document) -> BookMeta:
    md = doc.metadata or {}
    md_title = one_line(md.get("title", ""))
    md_author = one_line(md.get("author", ""))

    title, subtitle = title_from_first_page(doc)

    official_title = md_title if md_title else title
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

    # Fallback: heuristic heading detection from page text.
    # Targets chapter + subsection patterns.
    heading_patterns = [
        re.compile(r"^(chapter\s+\w+|part\s+\w+)", re.I),
        re.compile(r"^\d+(?:\.\d+)+\s+.+"),
        re.compile(r"^\d+\.\s+.+"),
        re.compile(r"^(appendix\s+\w+)\b", re.I),
    ]

    guessed: List[TocEntry] = []
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        text = page.get_text("text")
        lines = [one_line(x) for x in text.splitlines() if one_line(x)]
        for ln in lines[:12]:
            if any(p.search(ln) for p in heading_patterns):
                level = 2 if re.match(r"^\d+\.\d+", ln) else 1
                guessed.append(TocEntry(level=level, title=ln[:160], page=pno + 1))
                break

    # Deduplicate consecutive duplicates.
    final: List[TocEntry] = []
    seen = set()
    for e in guessed:
        key = (e.title.lower(), e.page)
        if key in seen:
            continue
        seen.add(key)
        final.append(e)

    if not final:
        final = [TocEntry(level=1, title="Start", page=1)]

    return final


def render_page_image(
    page: fitz.Page,
    max_width: int,
    quality: int,
    min_jpeg_reduction: float = 0.08,
) -> Tuple[bytes, int, int, str]:
    """
    Render one page once and choose output format without double recompression.
    - Build a lossless PNG baseline.
    - Build one JPEG candidate from the same source image.
    - Use JPEG only if it is meaningfully smaller; otherwise keep PNG.
    """
    # Scale to max_width while preserving aspect ratio.
    rect = page.rect
    zoom = max_width / rect.width if rect.width > 0 else 1.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)

    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

    png_buf = io.BytesIO()
    img.save(png_buf, format="PNG", optimize=True, compress_level=9)
    png_bytes = png_buf.getvalue()

    jpg_buf = io.BytesIO()
    img.save(jpg_buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    jpg_bytes = jpg_buf.getvalue()

    # Keep JPEG only when it saves enough size to justify lossy conversion.
    if len(png_bytes) > 0:
        reduction = 1.0 - (len(jpg_bytes) / len(png_bytes))
    else:
        reduction = 1.0

    if reduction >= min_jpeg_reduction:
        return jpg_bytes, img.width, img.height, "jpeg"
    return png_bytes, img.width, img.height, "png"


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


def remap_to_kept_page(page_no: int, kept_pages: Sequence[int]) -> Optional[int]:
    if not kept_pages:
        return None
    if page_no in kept_pages:
        return page_no
    for p in kept_pages:
        if p > page_no:
            return p
    return kept_pages[-1]


def page_text_to_xhtml(text: str) -> str:
    # Basic flowable text paragraphs.
    paras = [one_line(p) for p in re.split(r"\n\s*\n", text) if one_line(p)]
    if not paras:
        paras = [""]
    out = []
    for p in paras:
        out.append(f"<p>{html_escape(p)}</p>")
    return "\n".join(out)


def html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def make_output_filename(meta: BookMeta) -> str:
    title = sanitize_for_filename(meta.title)
    subtitle = sanitize_for_filename(meta.subtitle)
    author_last = sanitize_for_filename(meta.author_last)
    title_part = f"{title} - {subtitle}" if subtitle else title
    return f"{title_part}, {author_last} - edit.epub"


# ----------------------------- Core Conversion -----------------------------


def convert_pdf_to_epub(
    pdf_path: Path,
    out_dir: Path,
    image_max_width: int = 1200,
    image_quality: int = 58,
    render_mode: str = "hybrid",
) -> Path:
    doc = fitz.open(str(pdf_path))
    meta = build_meta(doc)
    toc_entries = collect_toc(doc)

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
            "h1,h2{font-weight:600;margin:.4em 0;}"
        ).encode("utf-8"),
    )
    book.add_item(css)

    spine_items: List[epub.EpubHtml] = []
    page_doc_by_pdf_page: dict[int, epub.EpubHtml] = {}
    kept_pdf_pages: List[int] = []

    # Cover from first page image.
    first_page = doc.load_page(0)
    cover_bytes, _, _, cover_fmt = render_page_image(first_page, image_max_width, image_quality)
    cover_ext = "jpg" if cover_fmt == "jpeg" else "png"
    cover_name = f"cover.{cover_ext}"
    book.set_cover(cover_name, cover_bytes)

    cover = epub.EpubHtml(title="Cover", file_name="cover.xhtml", lang="en")
    cover.content = (
        "<html><head><link rel='stylesheet' href='styles/main.css'/></head>"
        f"<body><div class='page'><img src='images/{cover_name}' alt='Cover'/></div></body></html>"
    )
    book.add_item(cover)
    spine_items.append(cover)

    render_mode = (render_mode or "hybrid").strip().lower()
    if render_mode not in {"hybrid", "image"}:
        render_mode = "hybrid"

    # Build each page chapter.
    for i in range(doc.page_count):
        page = doc.load_page(i)
        page_no = i + 1
        raw_text = page.get_text("text")

        if render_mode == "image":
            try:
                if is_visually_blank(page):
                    continue
            except Exception:
                pass
        elif should_skip_blank_page(page, raw_text):
            continue

        img_bytes, _, _, img_fmt = render_page_image(page, image_max_width, image_quality)
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

        flow_text = page_text_to_xhtml(raw_text)

        chap = epub.EpubHtml(
            title=f"Page {page_no}",
            file_name=f"text/p{page_no:04d}.xhtml",
            lang="en",
        )
        if render_mode == "image":
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {page_no}</div>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                "</div></body></html>"
            )
        else:
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {page_no}</div>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                f"<div class='txt'>{flow_text}</div>"
                "</div></body></html>"
            )
        book.add_item(chap)
        page_doc_by_pdf_page[page_no] = chap
        kept_pdf_pages.append(page_no)
        spine_items.append(chap)

    # Avoid producing an empty book body if all pages were filtered.
    if not kept_pdf_pages and doc.page_count > 0:
        page = doc.load_page(0)
        page_no = 1
        img_bytes, _, _, img_fmt = render_page_image(page, image_max_width, image_quality)
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
        raw_text = page.get_text("text")
        flow_text = page_text_to_xhtml(raw_text)
        chap = epub.EpubHtml(
            title=f"Page {page_no}",
            file_name=f"text/p{page_no:04d}.xhtml",
            lang="en",
        )
        if render_mode == "image":
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {page_no}</div>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                "</div></body></html>"
            )
        else:
            chap.content = (
                "<html><head><link rel='stylesheet' href='../styles/main.css'/></head><body>"
                f"<div class='page' id='page{page_no:04d}'>"
                f"<div class='meta'>Page {page_no}</div>"
                f"<img src='../{img_name}' alt='Page {page_no}'/>"
                f"<div class='txt'>{flow_text}</div>"
                "</div></body></html>"
            )
        book.add_item(chap)
        page_doc_by_pdf_page[page_no] = chap
        kept_pdf_pages.append(page_no)
        spine_items.append(chap)

    # TOC page (human-readable)
    toc_page = epub.EpubHtml(title="Table of Contents", file_name="toc.xhtml", lang="en")
    toc_items = []
    for e in toc_entries:
        target_page = remap_to_kept_page(e.page, kept_pdf_pages)
        if target_page is None:
            continue
        label = f"{one_line(e.title)} (p. {e.page})"
        href = f"text/p{target_page:04d}.xhtml#page{target_page:04d}"
        indent = "&nbsp;" * ((e.level - 1) * 4)
        toc_items.append(f"<li>{indent}<a href='{href}'>{html_escape(label)}</a></li>")

    toc_page.content = (
        "<html><head><link rel='stylesheet' href='styles/main.css'/></head><body>"
        "<div class='page'><h1>Table of Contents</h1><ul>"
        + "".join(toc_items)
        + "</ul></div></body></html>"
    )
    book.add_item(toc_page)

    # EPUB TOC structure from collected entries.
    epub_toc = []
    for e in toc_entries:
        target_page = remap_to_kept_page(e.page, kept_pdf_pages)
        if target_page is None:
            continue
        title = f"{one_line(e.title)} (p. {e.page})"
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
    book.add_item(epub.EpubNav())

    # Reading order: nav + cover + toc + pages.
    book.spine = ["nav", cover, toc_page] + spine_items[1:]

    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = make_output_filename(meta)
    out_path = out_dir / out_name
    epub.write_epub(str(out_path), book, {})

    doc.close()
    return out_path


# ----------------------------- Desktop UI -----------------------------


def run_gui() -> int:
    if tk is None:
        print("Tkinter not available in this Python.", file=sys.stderr)
        return 2

    root = tk.Tk()
    root.title(f"{APP_NAME} {APP_VERSION}")
    root.geometry("1200x820")
    root.minsize(1060, 720)
    root.configure(bg="#eef2f7")

    pdf_var = tk.StringVar()
    out_var = tk.StringVar(value=str(Path.home() / "Downloads"))
    pdf_display_var = tk.StringVar(value="No PDF selected")
    out_display_var = tk.StringVar(value=str(Path.home() / "Downloads"))
    width_var = tk.StringVar(value="1200")
    quality_var = tk.StringVar(value="58")
    preset_var = tk.StringVar(value="Balanced (Recommended)")
    mode_var = tk.StringVar(value="Flowable Hybrid (Image + Text)")
    status_var = tk.StringVar(value="Ready. Select a PDF to begin.")
    preview_var = tk.StringVar(value="Output file name will appear here.")
    auto_open_var = tk.IntVar(value=1)
    meta_title_var = tk.StringVar(value="-")
    meta_author_var = tk.StringVar(value="-")
    meta_pages_var = tk.StringVar(value="-")
    meta_toc_var = tk.StringVar(value="-")
    last_out_var = tk.StringVar(value="")
    busy = {"running": False, "tick": 0, "after_id": None}

    # Main shell
    shell = tk.Frame(root, bg="#eef2f7")
    shell.pack(fill="both", expand=True, padx=18, pady=16)
    shell.columnconfigure(0, weight=3)
    shell.columnconfigure(1, weight=2)
    shell.rowconfigure(1, weight=1)
    shell.rowconfigure(2, weight=1)

    # Header
    header = tk.Frame(shell, bg="#eef2f7")
    header.grid(row=0, column=0, columnspan=2, sticky="we", pady=(0, 10))
    tk.Label(header, text=f"{APP_NAME} {APP_VERSION}", font=("Helvetica", 24, "bold"), bg="#eef2f7", fg="#0f172a").pack(anchor="w")
    tk.Label(
        header,
        text="PDF to EPUB conversion with hybrid flowable text, cover preview, TOC, and smart image compression.",
        font=("Helvetica", 12),
        bg="#eef2f7",
        fg="#334155",
    ).pack(anchor="w", pady=(2, 0))

    # Cards
    left = tk.LabelFrame(shell, text=" Conversion Setup ", bg="white", fg="#0f172a", font=("Helvetica", 12, "bold"), padx=12, pady=12)
    left.grid(row=1, column=0, sticky="nsew", padx=(0, 10))
    left.columnconfigure(1, weight=1)

    right = tk.LabelFrame(shell, text=" Book Details ", bg="white", fg="#0f172a", font=("Helvetica", 12, "bold"), padx=12, pady=12)
    right.grid(row=1, column=1, sticky="nsew")
    right.columnconfigure(0, weight=1)

    log_card = tk.LabelFrame(shell, text=" Activity ", bg="white", fg="#0f172a", font=("Helvetica", 12, "bold"), padx=10, pady=10)
    log_card.grid(row=2, column=0, columnspan=2, sticky="nsew", pady=(10, 0))
    log_card.columnconfigure(0, weight=1)
    log_card.rowconfigure(1, weight=1)

    # Large open-book watermark in background.
    watermark_path = Path(__file__).resolve().parent / "assets" / "open_book_large_v1_3.png"
    if watermark_path.exists():
        try:
            bg_wm_img = tk.PhotoImage(file=str(watermark_path))
            bg_wm = tk.Label(shell, image=bg_wm_img, bg="#eef2f7", borderwidth=0, highlightthickness=0)
            bg_wm.image = bg_wm_img
            bg_wm.place(relx=0.53, rely=0.55, anchor="center")
            # Keep icon behind cards/header but still above shell background.
            bg_wm.lower(left)
            bg_wm.lower(right)
            bg_wm.lower(log_card)
            bg_wm.lower(header)
        except Exception:
            pass

    def log(msg: str):
        timestamp = dt.datetime.now().strftime("%H:%M:%S")
        log_box.configure(state="normal")
        log_box.insert("end", f"[{timestamp}] {msg}\n")
        log_box.see("end")
        log_box.configure(state="disabled")

    def reveal_path(path: Path):
        try:
            if sys.platform == "darwin":
                subprocess.Popen(["open", str(path)])
            elif os.name == "nt":
                os.startfile(str(path))  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", str(path)])
        except Exception as exc:
            messagebox.showerror("Open Failed", f"Could not open:\n{path}\n\n{exc}")

    def refresh_metadata_and_preview():
        p = Path(pdf_var.get().strip())
        if not p.exists():
            pdf_display_var.set("No PDF selected")
            meta_title_var.set("-")
            meta_author_var.set("-")
            meta_pages_var.set("-")
            meta_toc_var.set("-")
            preview_var.set("Output file name will appear here.")
            cover_lbl.configure(image="", text="No cover preview")
            cover_lbl.image = None
            return
        try:
            doc = fitz.open(str(p))
            pdf_display_var.set(str(p))
            meta = build_meta(doc)
            meta_title_var.set(meta.title or "-")
            meta_author_var.set(meta.author_full or "Unknown")
            meta_pages_var.set(str(doc.page_count))
            meta_toc_var.set(str(len(doc.get_toc(simple=False) or [])))
            preview_var.set(make_output_filename(meta))
            p0 = doc.load_page(0)
            pix = p0.get_pixmap(matrix=fitz.Matrix(0.25, 0.25), alpha=False)
            im = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            im.thumbnail((220, 300))
            tk_im = ImageTk.PhotoImage(im)
            cover_lbl.configure(image=tk_im, text="")
            cover_lbl.image = tk_im
            doc.close()
        except Exception as exc:
            log(f"Metadata warning: {exc}")

    def pick_pdf():
        p = filedialog.askopenfilename(title="Select Book PDF", filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")])
        if p:
            pdf_var.set(p)
            refresh_metadata_and_preview()
            log(f"Selected PDF: {p}")

    def pick_out():
        d = filedialog.askdirectory(title="Select Output Folder")
        if d:
            out_var.set(d)
            out_display_var.set(d)
            log(f"Output folder: {d}")

    def apply_preset(*_args):
        preset = preset_var.get()
        if preset.startswith("High Quality"):
            width_var.set("1600")
            quality_var.set("72")
        elif preset.startswith("Small Size"):
            width_var.set("1000")
            quality_var.set("48")
        else:
            width_var.set("1200")
            quality_var.set("58")

    def set_controls_state(enabled: bool):
        state = "normal" if enabled else "disabled"
        for w in (pdf_btn, out_btn, mode_menu, preset_menu, width_entry, quality_entry, create_btn):
            w.configure(state=state)

    def pulse_status():
        if not busy["running"]:
            return
        busy["tick"] = (busy["tick"] + 1) % 4
        status_var.set(f"Converting{'.' * busy['tick']} Please wait.")
        busy["after_id"] = root.after(400, pulse_status)

    def on_done_success(out_path: Path):
        busy["running"] = False
        if busy["after_id"]:
            root.after_cancel(busy["after_id"])
            busy["after_id"] = None
        set_controls_state(True)
        last_out_var.set(str(out_path))
        open_epub_btn.configure(state="normal")
        status_var.set(f"Done: {out_path}")
        log(f"Done: {out_path}")
        if auto_open_var.get():
            reveal_path(out_path.parent)
        messagebox.showinfo("Complete", f"EPUB created:\n{out_path}")

    def on_done_error(err: Exception):
        busy["running"] = False
        if busy["after_id"]:
            root.after_cancel(busy["after_id"])
            busy["after_id"] = None
        set_controls_state(True)
        status_var.set("Conversion failed.")
        log(f"Error: {err}")
        messagebox.showerror("Error", f"Conversion failed:\n{err}")

    def on_convert():
        pdf_path = Path(pdf_var.get().strip())
        out_dir = Path(out_var.get().strip())
        if not pdf_path.exists():
            messagebox.showerror("Missing PDF", "Please select a valid PDF file.")
            return
        if not out_dir.exists():
            messagebox.showerror("Missing Output Folder", "Please select a valid output folder.")
            return
        try:
            max_w = max(700, min(2000, int(width_var.get().strip())))
            quality = max(25, min(85, int(quality_var.get().strip())))
        except ValueError:
            messagebox.showerror("Invalid Settings", "Width and quality must be whole numbers.")
            return
        render_mode = "image" if mode_var.get().startswith("Image Pages") else "hybrid"
        width_var.set(str(max_w))
        quality_var.set(str(quality))
        set_controls_state(False)
        busy["running"] = True
        pulse_status()
        log(f"Starting conversion (mode={render_mode}, width={max_w}, quality={quality})")

        def worker():
            try:
                out = convert_pdf_to_epub(pdf_path, out_dir, image_max_width=max_w, image_quality=quality, render_mode=render_mode)
                root.after(0, lambda: on_done_success(out))
            except Exception as exc:
                root.after(0, lambda: on_done_error(exc))

        threading.Thread(target=worker, daemon=True).start()

    def clear_log():
        log_box.configure(state="normal")
        log_box.delete("1.0", "end")
        log_box.configure(state="disabled")
        log("Log cleared.")

    # Left card layout
    tk.Label(left, text="Step 1 - Select source PDF", bg="white", fg="#0f172a", font=("Helvetica", 11, "bold")).grid(row=0, column=0, columnspan=2, sticky="w")
    pdf_btn = tk.Button(left, text="Select PDF", command=pick_pdf)
    pdf_btn.grid(row=1, column=0, sticky="w", pady=(6, 4))
    tk.Label(left, textvariable=pdf_display_var, bg="white", fg="#334155", wraplength=560, justify="left").grid(row=1, column=1, sticky="w", padx=(10, 0))

    tk.Label(left, text="Step 2 - Choose output folder", bg="white", fg="#0f172a", font=("Helvetica", 11, "bold")).grid(row=2, column=0, columnspan=2, sticky="w", pady=(8, 0))
    out_btn = tk.Button(left, text="Output Folder", command=pick_out)
    out_btn.grid(row=3, column=0, sticky="w", pady=(6, 4))
    tk.Label(left, textvariable=out_display_var, bg="white", fg="#334155", wraplength=560, justify="left").grid(row=3, column=1, sticky="w", padx=(10, 0))

    tk.Label(left, text="Step 3 - Rendering options", bg="white", fg="#0f172a", font=("Helvetica", 11, "bold")).grid(row=4, column=0, columnspan=2, sticky="w", pady=(8, 0))
    tk.Label(left, text="Mode", bg="white", fg="#334155").grid(row=5, column=0, sticky="w", pady=(6, 0))
    mode_menu = tk.OptionMenu(left, mode_var, "Flowable Hybrid (Image + Text)", "Image Pages (Image Only)")
    mode_menu.grid(row=5, column=1, sticky="w", pady=(6, 0))
    tk.Label(left, text="Preset", bg="white", fg="#334155").grid(row=6, column=0, sticky="w", pady=(6, 0))
    preset_menu = tk.OptionMenu(left, preset_var, "Balanced (Recommended)", "High Quality (Larger)", "Small Size (Smaller)")
    preset_menu.grid(row=6, column=1, sticky="w", pady=(6, 0))
    tk.Label(left, text="Image max width", bg="white", fg="#334155").grid(row=7, column=0, sticky="w", pady=(6, 0))
    width_entry = tk.Entry(left, textvariable=width_var, width=10)
    width_entry.grid(row=7, column=1, sticky="w", pady=(6, 0))
    tk.Label(left, text="JPEG quality (25-85)", bg="white", fg="#334155").grid(row=8, column=0, sticky="w", pady=(6, 0))
    quality_entry = tk.Entry(left, textvariable=quality_var, width=10)
    quality_entry.grid(row=8, column=1, sticky="w", pady=(6, 0))
    tk.Checkbutton(left, text="Open output folder when done", variable=auto_open_var, bg="white").grid(row=9, column=0, columnspan=2, sticky="w", pady=(10, 0))

    action_row = tk.Frame(left, bg="white")
    action_row.grid(row=10, column=0, columnspan=2, sticky="w", pady=(12, 0))
    create_btn = tk.Button(action_row, text="Create EPUB", command=on_convert, bg="#2563eb", fg="white")
    create_btn.pack(side="left")
    tk.Button(action_row, text="Clear Log", command=clear_log).pack(side="left", padx=(8, 0))
    tk.Button(action_row, text="Quit", command=root.destroy).pack(side="left", padx=(8, 0))

    # Right card layout
    tk.Label(right, text="Cover Preview", bg="white", fg="#334155", font=("Helvetica", 10, "bold")).grid(row=0, column=0, sticky="w")
    cover_lbl = tk.Label(right, text="No cover preview", bg="#f8fafc", fg="#94a3b8", width=28, height=16, bd=1, relief="solid")
    cover_lbl.grid(row=1, column=0, sticky="w", pady=(6, 10))

    tk.Label(right, text="Detected title", bg="white", fg="#64748b").grid(row=2, column=0, sticky="w")
    tk.Label(right, textvariable=meta_title_var, bg="white", fg="#0f172a", wraplength=340, justify="left").grid(row=3, column=0, sticky="w", pady=(0, 6))
    tk.Label(right, text="Detected author", bg="white", fg="#64748b").grid(row=4, column=0, sticky="w")
    tk.Label(right, textvariable=meta_author_var, bg="white", fg="#0f172a", wraplength=340, justify="left").grid(row=5, column=0, sticky="w", pady=(0, 6))
    tk.Label(right, text="Pages / Bookmarks", bg="white", fg="#64748b").grid(row=6, column=0, sticky="w")
    tk.Label(right, textvariable=tk.StringVar(value=""), bg="white")
    meta_line = tk.Label(right, text="", bg="white", fg="#0f172a")
    meta_line.grid(row=7, column=0, sticky="w", pady=(0, 6))

    def refresh_meta_line(*_):
        meta_line.configure(text=f"{meta_pages_var.get()} pages, {meta_toc_var.get()} bookmarks")

    tk.Label(right, text="Output filename", bg="white", fg="#64748b").grid(row=8, column=0, sticky="w")
    tk.Label(right, textvariable=preview_var, bg="#f8fafc", fg="#0f172a", wraplength=340, justify="left", padx=8, pady=8).grid(row=9, column=0, sticky="we", pady=(0, 8))

    quick = tk.Frame(right, bg="white")
    quick.grid(row=10, column=0, sticky="w")
    tk.Button(quick, text="Open Output Folder", command=lambda: reveal_path(Path(out_var.get().strip()))).pack(side="left")
    open_epub_btn = tk.Button(quick, text="Open Latest EPUB", state="disabled", command=lambda: reveal_path(Path(last_out_var.get().strip())) if last_out_var.get().strip() else None)
    open_epub_btn.pack(side="left", padx=(8, 0))

    # Log card layout
    tk.Label(log_card, textvariable=status_var, bg="white", fg="#334155", anchor="w").grid(row=0, column=0, sticky="we", pady=(0, 6))
    log_box = scrolledtext.ScrolledText(log_card, height=10, wrap="word", state="disabled")
    log_box.grid(row=1, column=0, sticky="nsew")

    # Hooks/startup
    preset_var.trace_add("write", apply_preset)
    meta_pages_var.trace_add("write", refresh_meta_line)
    meta_toc_var.trace_add("write", refresh_meta_line)
    apply_preset()
    refresh_meta_line()
    refresh_metadata_and_preview()
    log("Ready.")
    log("Workflow: 1) Select PDF  2) Select output folder  3) Adjust options  4) Create EPUB")

    root.mainloop()
    return 0


# ----------------------------- CLI -----------------------------


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=f"{APP_NAME} {APP_VERSION}: create an EPUB from a PDF.")
    p.add_argument("--pdf", type=Path, help="Input PDF path")
    p.add_argument("--out", type=Path, help="Output directory")
    p.add_argument("--image-max-width", type=int, default=1200)
    p.add_argument("--image-quality", type=int, default=58)
    p.add_argument("--mode", choices=["hybrid", "image"], default="hybrid", help="Page render mode")
    p.add_argument("--nogui", action="store_true", help="Run CLI only")
    return p.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)

    if not args.nogui and not args.pdf:
        return run_gui()

    if not args.pdf:
        print("Missing --pdf", file=sys.stderr)
        return 2

    out_dir = args.out if args.out else Path.cwd()
    out_path = convert_pdf_to_epub(
        args.pdf,
        out_dir,
        image_max_width=max(700, min(2000, args.image_max_width)),
        image_quality=max(25, min(85, args.image_quality)),
        render_mode=args.mode,
    )
    print(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
