from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path

from docx import Document
from docx.document import Document as DocumentObject
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph
from fastapi import UploadFile
from striprtf.striprtf import rtf_to_text

BULLET_RE = re.compile(r"^[•●▪◦‣∙❖◆◇■□►▸\-–—]\s*")


def _normalize_fragment(value: str) -> str:
    """Normalize spacing without destroying structural delimiters."""
    value = value.replace("\xa0", " ")
    value = re.sub(r"\t+", " | ", value)
    value = re.sub(r"[ ]{2,}", " ", value)
    value = re.sub(r"\s*\|\s*", " | ", value)
    return value.strip()


def _paragraph_lines(paragraph: Paragraph) -> list[str]:
    """Return atomic visual lines from a paragraph."""
    raw = paragraph.text or ""
    if not raw.strip():
        return []

    ppr = paragraph._p.pPr
    is_numbered = bool(ppr is not None and ppr.numPr is not None)
    style_name = (paragraph.style.name or "").lower() if paragraph.style else ""
    is_list = is_numbered or "list" in style_name or "bullet" in style_name

    lines: list[str] = []
    for index, raw_line in enumerate(re.split(r"[\r\n]+", raw)):
        value = _normalize_fragment(raw_line)
        if not value:
            continue
        if is_list and index == 0 and not BULLET_RE.match(value):
            value = f"• {value}"
        lines.append(value)
    return lines


def _iter_docx_blocks(document: DocumentObject):
    """Yield paragraphs and tables in the same order they appear in the DOCX."""
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def _table_lines(table: Table) -> list[str]:
    lines: list[str] = []
    for row in table.rows:
        cells: list[str] = []
        for cell in row.cells:
            cell_lines: list[str] = []
            for paragraph in cell.paragraphs:
                cell_lines.extend(_paragraph_lines(paragraph))
            cell_text = " | ".join(cell_lines).strip()
            if cell_text and cell_text not in cells:
                cells.append(cell_text)
        if cells:
            lines.append(" | ".join(cells))
    return lines


def _pdf_lines(raw_bytes: bytes) -> list[str]:
    """Extract text-based PDF content while preserving visual line structure.

    pypdf is intentionally imported lazily so a missing/failed optional PDF
    dependency can never prevent DOCX/TXT/RTF ResumeATS startup.
    """
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("PDF support is temporarily unavailable because pypdf is not installed.") from exc

    reader = PdfReader(BytesIO(raw_bytes))
    lines: list[str] = []

    for page in reader.pages:
        try:
            text = page.extract_text(extraction_mode="layout") or ""
        except (TypeError, ValueError):
            text = page.extract_text() or ""

        for raw_line in text.splitlines():
            value = _normalize_fragment(raw_line)
            if value:
                lines.append(value)

    return lines


def read_resume_text(file: UploadFile, raw_bytes: bytes) -> str:
    """Extract resume text while preserving layout cues needed for parsing."""
    suffix = Path(file.filename or "").suffix.lower()

    if suffix == ".docx":
        document = Document(BytesIO(raw_bytes))
        lines: list[str] = []
        for block in _iter_docx_blocks(document):
            if isinstance(block, Paragraph):
                lines.extend(_paragraph_lines(block))
            else:
                lines.extend(_table_lines(block))
        return "\n".join(line for line in lines if line)

    if suffix == ".pdf":
        return "\n".join(_pdf_lines(raw_bytes))

    if suffix == ".rtf":
        return rtf_to_text(raw_bytes.decode("utf-8", errors="ignore"))

    return raw_bytes.decode("utf-8", errors="ignore")
