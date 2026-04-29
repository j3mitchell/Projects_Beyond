#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import fitz
from bookcraft_v1_4 import convert_pdf_to_epub
from PySide6.QtCore import QThread, Signal, Qt
from PySide6.QtGui import QPixmap, QImage
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
APP_VERSION = "v1_5 (Qt)"


def one_line(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


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


def guess_output_name(pdf_path: Path) -> tuple[str, str, str, str]:
    title = pdf_path.stem
    subtitle = ""
    author = "Unknown"
    pages = "-"
    toc_count = "-"
    try:
        doc = fitz.open(str(pdf_path))
        md = doc.metadata or {}
        title = one_line(md.get("title", "")) or title
        author = one_line(md.get("author", "")) or "Unknown"
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


class ConvertWorker(QThread):
    done = Signal(str)
    failed = Signal(str)

    def __init__(
        self,
        pdf: Path,
        out: Path,
        mode: str,
        width: int,
        quality: int,
        image_format_mode: str,
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

        root = QWidget()
        root.setObjectName("rootPanel")
        self.setCentralWidget(root)
        root.setStyleSheet("#rootPanel{background-color:#ececec;}")
        layout = QVBoxLayout(root)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(10)

        banner = QFrame()
        banner.setStyleSheet("QFrame{background:#7f1d1d;border-radius:8px;padding:8px;}")
        b_layout = QVBoxLayout(banner)
        b_layout.setContentsMargins(12, 10, 12, 10)
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
        self.top_progress.setFixedHeight(1)
        self.top_progress.setStyleSheet(
            "QProgressBar{border:none;background:#b9b9b9;max-height:1px;min-height:1px;}"
            "QProgressBar::chunk{background:#8a8a8a;}"
        )
        b_layout.addWidget(self.top_progress)
        layout.addWidget(banner)

        row = QHBoxLayout()
        layout.addLayout(row)

        left = QGroupBox("Conversion Setup")
        left.setStyleSheet(
            "QGroupBox{font-weight:700; font-size:13px; border:2px solid rgba(64,64,64,128); border-radius:8px; margin-top:8px; padding-top:8px;}"
            "QGroupBox::title{subcontrol-origin: margin; left:10px; padding:0 4px; color:#2f2f2f;}"
        )
        lgrid = QGridLayout(left)
        row.addWidget(left, 3)

        right = QGroupBox("Book Details")
        right.setStyleSheet(
            "QGroupBox{font-weight:700; font-size:13px; border:2px solid rgba(64,64,64,128); border-radius:8px; margin-top:8px; padding-top:8px;}"
            "QGroupBox::title{subcontrol-origin: margin; left:10px; padding:0 4px; color:#2f2f2f;}"
        )
        rgrid = QGridLayout(right)
        row.addWidget(right, 2)

        self.btn_pdf = QPushButton("Select PDF")
        self.btn_pdf.clicked.connect(self.pick_pdf)
        self.pdf_path_lbl = QLabel("No PDF selected")
        self.pdf_path_lbl.setWordWrap(True)

        self.btn_out = QPushButton("Output Folder")
        self.btn_out.clicked.connect(self.pick_out)
        self.out_path_lbl = QLabel(str(Path.home() / "Downloads"))
        self.out_path_lbl.setWordWrap(True)
        self.btn_cover = QPushButton("Add Cover")
        self.btn_cover.clicked.connect(self.pick_cover)
        self.cover_path_lbl = QLabel("None (using source setting)")
        self.cover_path_lbl.setWordWrap(True)

        self.mode = QComboBox()
        self.mode.addItems(["Flowable Hybrid (Image + Text)", "Image Pages (Image Only)", "Text Pages (Images Rare)"])
        self.preset = QComboBox()
        self.preset.addItems(["Balanced (Recommended)", "High Quality (Larger)", "Small Size (Smaller)"])
        self.preset.currentIndexChanged.connect(self.apply_preset)
        self.cover_source = QComboBox()
        self.cover_source.addItems(["Auto (Online then PDF)", "PDF First Page", "Online Only"])

        self.width = QLineEdit("1500")
        self.width_unit = QComboBox()
        self.width_unit.addItems(["Pixels (px)", "Percent (%)", "Inches (in)"])
        self.width_unit.setFixedWidth(150)
        self.quality = QLineEdit("58")
        self.image_format = QComboBox()
        self.image_format.addItems(["Auto (JPEG)", "PNG (Lossless)", "Hybrid (Smart PNG/JPEG)"])
        self.auto_open = QCheckBox("Open output folder when done")
        self.auto_open.setChecked(True)

        self.btn_create = QPushButton("Create EPUB")
        self.btn_create.clicked.connect(self.convert)
        self.btn_clear = QPushButton("Clear Log")
        self.btn_clear.clicked.connect(lambda: self.log.setPlainText(""))
        self.btn_quit = QPushButton("Quit")
        self.btn_quit.clicked.connect(self.close)

        lgrid.addWidget(QLabel("1) Source PDF"), 0, 0)
        lgrid.addWidget(self.btn_pdf, 1, 0)
        lgrid.addWidget(self.pdf_path_lbl, 1, 1)
        lgrid.addWidget(QLabel("2) Output Folder"), 2, 0)
        lgrid.addWidget(self.btn_out, 3, 0)
        lgrid.addWidget(self.out_path_lbl, 3, 1)
        lgrid.addWidget(QLabel("2.5) Custom Cover"), 4, 0)
        lgrid.addWidget(self.btn_cover, 5, 0)
        lgrid.addWidget(self.cover_path_lbl, 5, 1)
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
        lgrid.addWidget(QLabel("JPEG quality (25-85)"), 11, 0)
        lgrid.addWidget(self.quality, 11, 1)
        lgrid.addWidget(QLabel("Page image format"), 12, 0)
        lgrid.addWidget(self.image_format, 12, 1)
        lgrid.addWidget(self.auto_open, 13, 0, 1, 2)

        btnrow = QHBoxLayout()
        btnrow.addWidget(self.btn_create)
        btnrow.addWidget(self.btn_clear)
        btnrow.addWidget(self.btn_quit)
        lgrid.addLayout(btnrow, 14, 0, 1, 2)

        self.cover = QLabel("No cover preview")
        self.cover.setFixedSize(220, 300)
        self.cover.setFrameShape(QFrame.StyledPanel)
        self.cover.setAlignment(Qt.AlignCenter)
        self.meta_title = QLabel("-")
        self.meta_title.setWordWrap(True)
        self.meta_author = QLabel("-")
        self.meta_stats = QLabel("-")
        self.output_preview = QLabel("Output file name will appear here")
        self.output_preview.setWordWrap(True)

        self.btn_open_out = QPushButton("Open Output Folder")
        self.btn_open_out.clicked.connect(self.open_out)
        self.btn_open_epub = QPushButton("Open Latest EPUB")
        self.btn_open_epub.setEnabled(False)
        self.btn_open_epub.clicked.connect(self.open_latest)

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

        rbtn = QHBoxLayout()
        rbtn.addWidget(self.btn_open_out)
        rbtn.addWidget(self.btn_open_epub)
        rgrid.addLayout(rbtn, 10, 0)

        self.status = QLabel("Ready.")
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        self.log.setStyleSheet("QTextEdit{border:2px solid rgba(64,64,64,128); border-radius:8px; background:#ffffff;}")
        layout.addWidget(self.status)
        layout.addWidget(self.log, 1)
        self.log_msg("Ready. 1) Select PDF 2) Output Folder 3) Create EPUB")

        wm = Path(__file__).resolve().parent / "assets" / "open_book_mono_full_v1_4_soft.png"
        if wm.exists():
            root.setStyleSheet(
                "#rootPanel{background-color:#ececec;"
                f"background-image:url({wm.as_posix()});"
                "background-position:center;"
                "background-repeat:no-repeat;}"
            )

    def log_msg(self, msg: str):
        self.log.append(msg)

    def apply_preset(self):
        p = self.preset.currentText()
        if p.startswith("High Quality"):
            self.width.setText("1600")
            self.width_unit.setCurrentText("Pixels (px)")
            self.quality.setText("72")
            self.image_format.setCurrentText("Hybrid (Smart PNG/JPEG)")
        elif p.startswith("Small Size"):
            self.width.setText("1000")
            self.width_unit.setCurrentText("Pixels (px)")
            self.quality.setText("48")
            self.image_format.setCurrentText("Auto (JPEG)")
        else:
            self.width.setText("1500")
            self.width_unit.setCurrentText("Pixels (px)")
            self.quality.setText("58")
            self.image_format.setCurrentText("Auto (JPEG)")

    def pick_pdf(self):
        p, _ = QFileDialog.getOpenFileName(self, "Select PDF", str(Path.home()), "PDF Files (*.pdf)")
        if not p:
            return
        path = Path(p)
        self.pdf_path_lbl.setText(str(path))
        file_name, title, author, stats = guess_output_name(path)
        self.output_preview.setText(file_name)
        self.meta_title.setText(title)
        self.meta_author.setText(author)
        self.meta_stats.setText(stats)
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
        d = QFileDialog.getExistingDirectory(self, "Select Output Folder", self.out_path_lbl.text())
        if d:
            self.out_path_lbl.setText(d)
            self.log_msg(f"Output folder: {d}")

    def pick_cover(self):
        p, _ = QFileDialog.getOpenFileName(
            self,
            "Select Cover Image",
            str(Path.home()),
            "Image Files (*.jpg *.jpeg *.png *.webp *.bmp *.tif *.tiff)",
        )
        if p:
            self.cover_path_lbl.setText(p)
            self.log_msg(f"Custom cover image: {p}")

    def set_busy(self, busy: bool):
        for w in [self.btn_pdf, self.btn_out, self.btn_cover, self.mode, self.preset, self.cover_source, self.width, self.width_unit, self.quality, self.image_format, self.btn_create]:
            w.setEnabled(not busy)

    def compute_width_px(self) -> int:
        # Baseline mapping for non-pixel units:
        # 100% -> 1500 px, 1 in -> 150 px.
        raw = float(self.width.text().strip())
        unit = self.width_unit.currentText()
        if unit.startswith("Percent"):
            width_px = round(1500.0 * (raw / 100.0))
        elif unit.startswith("Inches"):
            width_px = round(raw * 150.0)
        else:
            width_px = round(raw)
        return max(700, min(2600, int(width_px)))

    def convert(self):
        pdf = Path(self.pdf_path_lbl.text())
        out = Path(self.out_path_lbl.text())
        if not pdf.exists():
            QMessageBox.critical(self, "Missing PDF", "Select a valid PDF.")
            return
        if not out.exists():
            QMessageBox.critical(self, "Missing Output Folder", "Select a valid output folder.")
            return
        try:
            width = self.compute_width_px()
            quality = max(25, min(85, int(self.quality.text())))
        except ValueError:
            QMessageBox.critical(self, "Invalid Settings", "Width and quality must be numeric values.")
            return

        mode = "hybrid"
        if self.mode.currentText().startswith("Image Pages"):
            mode = "image"
        elif self.mode.currentText().startswith("Text Pages"):
            mode = "text"
        image_format_mode = "auto_jpeg"
        if self.image_format.currentText().startswith("PNG"):
            image_format_mode = "png"
        elif self.image_format.currentText().startswith("Hybrid"):
            image_format_mode = "hybrid"
        cover_source = "auto"
        if self.cover_source.currentText().startswith("PDF"):
            cover_source = "pdf"
        elif self.cover_source.currentText().startswith("Online"):
            cover_source = "online"
        self.set_busy(True)
        self.status.setText("Converting... Please wait.")
        self.top_progress.setRange(0, 100)
        self.top_progress.setValue(0)
        self.top_progress.setRange(0, 0)
        self.log_msg(
            f"Starting conversion mode={mode}, imgfmt={image_format_mode}, cover={cover_source}, width={self.width.text().strip()} {self.width_unit.currentText()} -> {width}px, quality={quality}"
        )
        cover_image = self.cover_path_lbl.text().strip()
        if cover_image.startswith("None "):
            cover_image = ""
        if cover_image and not os.path.exists(cover_image):
            QMessageBox.critical(self, "Missing Cover Image", "Custom cover image path is invalid.")
            self.set_busy(False)
            return
        self.worker = ConvertWorker(pdf, out, mode, width, quality, image_format_mode, cover_source, cover_image)
        self.worker.done.connect(self.on_done)
        self.worker.failed.connect(self.on_fail)
        self.worker.start()

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
        QMessageBox.information(self, "Complete", f"EPUB created:\n{out_path}")

    def on_fail(self, err: str):
        self.set_busy(False)
        self.top_progress.setRange(0, 100)
        self.top_progress.setValue(0)
        self.status.setText("Conversion failed")
        self.log_msg(f"Error: {err}")
        QMessageBox.critical(self, "Error", err)

    def open_out(self):
        d = Path(self.out_path_lbl.text())
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


def main_qt():
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main_qt())
