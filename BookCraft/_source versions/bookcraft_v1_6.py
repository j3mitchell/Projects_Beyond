#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

import fitz
from bookcraft_v1_4 import convert_pdf_to_epub
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
APP_VERSION = "v1_6"


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
    progress = Signal(int, str)

    def __init__(
        self,
        pdf: Path,
        out: Path,
        mode: str,
        width: int,
        quality: int,
        image_format_mode: str,
        output_filename: str,
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
        self.output_filename = output_filename
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
                output_filename=self.output_filename,
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
        self.mode.addItems(["Flowable Hybrid (Image + Text)", "Image Pages (Image Only)", "Text Pages (Images Rare)"])
        self.preset = QComboBox()
        self.preset.addItems(["Balanced (Recommended)", "High Quality (Larger)", "Small Size (Smaller)"])
        self.preset.currentIndexChanged.connect(self.apply_preset)
        self.cover_source = QComboBox()
        self.cover_source.addItems(["Auto (Online then PDF)", "PDF First Page", "Online Only"])

        self.width = QLineEdit("1500")
        self.width.setStyleSheet("QLineEdit{padding-left:8px;}")
        self.width_unit = QComboBox()
        self.width_unit.addItems(["Pixels (px)", "Percent (%)", "Inches (in)"])
        self.width_unit.setFixedWidth(150)
        self.quality = QLineEdit("58")
        self.quality.setStyleSheet("QLineEdit{padding-left:8px;}")
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
        self.btn_restart = QPushButton("Restart App")
        self.btn_restart.clicked.connect(self.restart_app)
        self.btn_create.setFixedWidth(150)
        self.btn_clear.setFixedWidth(150)
        self.btn_quit.setFixedWidth(150)
        self.btn_restart.setFixedWidth(150)

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
        lgrid.addWidget(QLabel("JPEG quality (25-85)"), 11, 0)
        quality_row = QWidget()
        quality_row_layout = QHBoxLayout(quality_row)
        quality_row_layout.setContentsMargins(0, 0, 0, 0)
        quality_row_layout.addWidget(self.quality, 1)
        lgrid.addWidget(quality_row, 11, 1)
        lgrid.addWidget(QLabel("Page image format"), 12, 0)
        lgrid.addWidget(self.image_format, 12, 1)
        lgrid.addWidget(self.auto_open, 13, 0, 1, 2)

        btnrow = QHBoxLayout()
        btnrow.addWidget(self.btn_create)
        btnrow.addWidget(self.btn_clear)
        btnrow.addWidget(self.btn_quit)
        btnrow.addWidget(self.btn_restart)
        lgrid.addLayout(btnrow, 14, 0, 1, 2)

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
        # Always refresh the suggested output filename when a new PDF is selected.
        self.output_preview.setText(file_name)
        self.output_preview.setCursorPosition(0)
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
            self.log_msg(f"Custom cover image: {p}")

    def set_busy(self, busy: bool):
        for w in [self.btn_pdf, self.btn_out, self.btn_cover, self.mode, self.preset, self.cover_source, self.width, self.width_unit, self.quality, self.image_format, self.output_preview, self.btn_create, self.btn_restart]:
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
        out = Path(self.out_dir)
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
        output_filename = self.output_preview.text().strip()
        self.worker = ConvertWorker(pdf, out, mode, width, quality, image_format_mode, output_filename, cover_source, cover_image)
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
        QMessageBox.information(self, "Complete", f"EPUB created:\n{out_path}")

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
