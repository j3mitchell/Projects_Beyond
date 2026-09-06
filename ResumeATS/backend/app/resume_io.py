from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from bs4 import BeautifulSoup
from docx import Document
from docx.document import Document as DocumentObject
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph
from fastapi import UploadFile
from striprtf.striprtf import rtf_to_text

BULLET_RE = re.compile(r"^[•●▪◦‣∙❖◆◇■□►▸\-–—]\s*")
SUPPORTED_INPUT_EXTENSIONS = (".docx", ".pdf", ".txt", ".md", ".rtf", ".html", ".htm", ".doc", ".odt", ".json", ".xml", ".pages", ".zip")
ARCHIVE_INPUT_EXTENSIONS = {".pages", ".zip"}


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


def _html_lines(raw_bytes: bytes) -> list[str]:
    soup = BeautifulSoup(raw_bytes.decode("utf-8", errors="replace"), "html.parser")
    for element in soup(["script", "style", "noscript", "template"]):
        element.decompose()
    return [line for raw_line in soup.get_text("\n").splitlines() if (line := _normalize_fragment(raw_line))]


def _json_lines(raw_bytes: bytes) -> list[str]:
    value = json.loads(raw_bytes.decode("utf-8-sig", errors="replace"))
    lines: list[str] = []

    def visit(item, key: str = "") -> None:
        if isinstance(item, dict):
            for child_key, child in item.items():
                visit(child, str(child_key))
        elif isinstance(item, list):
            for child in item:
                visit(child, key)
        elif item is not None:
            rendered = str(item)
            lines.append(f"{key}: {rendered}" if key else rendered)

    visit(value)
    return lines


def _xml_direct_text(element: ElementTree.Element) -> str:
    parts = [element.text or ""]
    for child in element:
        parts.append(child.tail or "")
    return "".join(parts)


def _xml_lines(raw_bytes: bytes) -> list[str]:
    root = ElementTree.fromstring(raw_bytes)
    lines: list[str] = []
    for element in root.iter():
        value = _normalize_fragment(_xml_direct_text(element))
        if value:
            lines.append(value)
        if not list(element) and element.text:
            value = _normalize_fragment(element.text)
            if value and value not in lines:
                lines.append(value)
    return lines


def _odt_element_text(element: ElementTree.Element) -> str:
    parts = [element.text or ""]
    for child in element:
        local_name = child.tag.rsplit("}", 1)[-1]
        if local_name == "s":
            count = int(child.attrib.get("{urn:oasis:names:tc:opendocument:xmlns:text:1.0}c", "1"))
            parts.append(" " * count)
        elif local_name == "tab":
            parts.append("\t")
        elif local_name == "line-break":
            parts.append("\n")
        else:
            parts.append(_odt_element_text(child))
        parts.append(child.tail or "")
    return "".join(parts)


def _odt_lines(raw_bytes: bytes) -> list[str]:
    try:
        with ZipFile(BytesIO(raw_bytes)) as archive:
            content = archive.read("content.xml")
    except (BadZipFile, KeyError) as exc:
        raise ValueError("This ODT file is damaged or missing content.xml.") from exc

    root = ElementTree.fromstring(content)
    lines: list[str] = []
    for element in root.iter():
        local_name = element.tag.rsplit("}", 1)[-1]
        if local_name in {"h", "p", "list-item"}:
            for raw_line in _odt_element_text(element).splitlines() or [""]:
                value = _normalize_fragment(raw_line)
                if value:
                    lines.append(value)
    return lines


def _doc_lines(raw_bytes: bytes) -> list[str]:
    """Read legacy binary Word files through an installed local converter."""
    with tempfile.NamedTemporaryFile(suffix=".doc") as source:
        source.write(raw_bytes)
        source.flush()
        commands = []
        antiword = shutil.which("antiword")
        catdoc = shutil.which("catdoc")
        textutil = shutil.which("textutil")
        if antiword:
            commands.append([antiword, "-f", "text", source.name])
        if catdoc:
            commands.append([catdoc, source.name])
        if textutil:
            commands.append([textutil, "-convert", "txt", "-stdout", source.name])

        for command in commands:
            try:
                result = subprocess.run(command, check=True, capture_output=True, timeout=20)
            except (OSError, subprocess.SubprocessError):
                continue
            return [line for raw_line in result.stdout.decode("utf-8", errors="replace").splitlines()
                    if (line := _normalize_fragment(raw_line))]

    raise RuntimeError("Legacy .doc support requires antiword, catdoc, or textutil.")


def _archive_lines(raw_bytes: bytes, suffix: str, depth: int) -> list[str]:
    if depth > 2:
        raise ValueError("Nested resume archives are limited to two levels.")

    try:
        with ZipFile(BytesIO(raw_bytes)) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            if sum(member.file_size for member in members) > 30 * 1024 * 1024:
                raise ValueError("The expanded resume archive exceeds the 30 MB limit.")

            def priority(member):
                name = member.filename.replace("\\", "/").lower()
                extension = Path(name).suffix.lower()
                if suffix == ".pages":
                    if name.endswith("quicklook/preview.pdf"):
                        return (0, name)
                    if name.endswith("preview.pdf"):
                        return (1, name)
                    if name.endswith("index.xml"):
                        return (2, name)
                return (3 if extension in ARCHIVE_INPUT_EXTENSIONS else 4, name)

            candidates = [member for member in members
                          if Path(member.filename).suffix.lower() in SUPPORTED_INPUT_EXTENSIONS]
            candidates.sort(key=priority)

            extracted: list[str] = []
            for member in candidates:
                try:
                    nested_file = type("ArchiveFile", (), {"filename": member.filename})()
                    text = read_resume_text(nested_file, archive.read(member), depth + 1)
                except (BadZipFile, ElementTree.ParseError, RuntimeError, ValueError, UnicodeError):
                    continue
                if text.strip():
                    extracted.append(text.strip())
                if suffix == ".pages" and extracted and priority(member)[0] < 3:
                    break
            if extracted:
                return "\n".join(extracted).splitlines()
    except BadZipFile as exc:
        raise ValueError("This resume archive is damaged or invalid.") from exc

    raise ValueError("No readable resume document was found inside this archive.")


def read_resume_text(file: UploadFile, raw_bytes: bytes, _depth: int = 0) -> str:
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

    if suffix in {".html", ".htm"}:
        return "\n".join(_html_lines(raw_bytes))

    if suffix == ".doc":
        return "\n".join(_doc_lines(raw_bytes))

    if suffix == ".odt":
        return "\n".join(_odt_lines(raw_bytes))

    if suffix == ".json":
        return "\n".join(_json_lines(raw_bytes))

    if suffix == ".xml":
        return "\n".join(_xml_lines(raw_bytes))

    if suffix in ARCHIVE_INPUT_EXTENSIONS:
        return "\n".join(_archive_lines(raw_bytes, suffix, _depth))

    return raw_bytes.decode("utf-8", errors="ignore")
