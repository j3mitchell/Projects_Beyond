#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import fitz
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
    QCheckBox,
    QComboBox,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

APP_NAME = "BookCraft"
APP_VERSION = "v1_3 (Qt)"


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
    subtitle_part = sanitize_for_filename(subtitle)
    author_last = split_author_last(author)
    file_name = f"{title_part}{' - ' + subtitle_part if subtitle_part else ''}, {author_last} - edit.epub"
    return file_name, title, author, f"{pages} pages, {toc_count} bookmarks"


class ConvertWorker(QThread):
    done = Signal(str)
    failed = Signal(str)

    def __init__(self, script_path: Path, pdf: Path, out: Path, mode: str, width: int, quality: int):
        super().__init__()
        self.script_path = script_path
        self.pdf = pdf
        self.out = out
        self.mode = mode
        self.width = width
        self.quality = quality

    def run(self):
        cmd = [
            sys.executable,
            str(self.script_path),
            "--nogui",
            "--pdf",
            str(self.pdf),
            "--out",
            str(self.out),
            "--mode",
            self.mode,
            "--image-max-width",
            str(self.width),
            "--image-quality",
            str(self.quality),
        ]
        try:
            out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True).strip()
            self.done.emit(out)
        except subprocess.CalledProcessError as e:
            self.failed.emit(e.output.strip() or "Conversion failed")


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(f"{APP_NAME} {APP_VERSION}")
        self.resize(1220, 820)
        self.script_path = Path(__file__).resolve().parent / "bookcraft_v1_3.py"
        self.worker: ConvertWorker | None = None
        self.last_out = ""

        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)

        h1 = QLabel(f"{APP_NAME} {APP_VERSION}")
        h1.setStyleSheet("font-size: 28px; font-weight: 700; color: #0f172a;")
        h2 = QLabel("Native macOS dashboard: stable rendering, cover preview, and full conversion controls.")
        h2.setStyleSheet("font-size: 13px; color: #334155;")
        layout.addWidget(h1)
        layout.addWidget(h2)

        row = QHBoxLayout()
        layout.addLayout(row)

        left = QGroupBox("Conversion Setup")
        left.setStyleSheet("QGroupBox{font-weight:700; font-size:13px;}")
        lgrid = QGridLayout(left)
        row.addWidget(left, 3)

        right = QGroupBox("Book Details")
        right.setStyleSheet("QGroupBox{font-weight:700; font-size:13px;}")
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

        self.mode = QComboBox()
        self.mode.addItems(["Flowable Hybrid (Image + Text)", "Image Pages (Image Only)"])
        self.preset = QComboBox()
        self.preset.addItems(["Balanced (Recommended)", "High Quality (Larger)", "Small Size (Smaller)"])
        self.preset.currentIndexChanged.connect(self.apply_preset)

        self.width = QLineEdit("1200")
        self.quality = QLineEdit("58")
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
        lgrid.addWidget(QLabel("Render Mode"), 4, 0)
        lgrid.addWidget(self.mode, 4, 1)
        lgrid.addWidget(QLabel("Preset"), 5, 0)
        lgrid.addWidget(self.preset, 5, 1)
        lgrid.addWidget(QLabel("Image max width"), 6, 0)
        lgrid.addWidget(self.width, 6, 1)
        lgrid.addWidget(QLabel("JPEG quality (25-85)"), 7, 0)
        lgrid.addWidget(self.quality, 7, 1)
        lgrid.addWidget(self.auto_open, 8, 0, 1, 2)

        btnrow = QHBoxLayout()
        btnrow.addWidget(self.btn_create)
        btnrow.addWidget(self.btn_clear)
        btnrow.addWidget(self.btn_quit)
        lgrid.addLayout(btnrow, 9, 0, 1, 2)

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
        layout.addWidget(self.status)
        layout.addWidget(self.log, 1)
        self.log_msg("Ready. 1) Select PDF 2) Output Folder 3) Create EPUB")

        wm = Path(__file__).resolve().parent / "assets" / "open_book_large_v1_3.png"
        if wm.exists():
            right.setStyleSheet(
                "QGroupBox{font-weight:700; font-size:13px;"
                f"background-image:url({wm.as_posix()}); background-position:center; background-repeat:no-repeat;}}"
            )

    def log_msg(self, msg: str):
        self.log.append(msg)

    def apply_preset(self):
        p = self.preset.currentText()
        if p.startswith("High Quality"):
            self.width.setText("1600")
            self.quality.setText("72")
        elif p.startswith("Small Size"):
            self.width.setText("1000")
            self.quality.setText("48")
        else:
            self.width.setText("1200")
            self.quality.setText("58")

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

    def set_busy(self, busy: bool):
        for w in [self.btn_pdf, self.btn_out, self.mode, self.preset, self.width, self.quality, self.btn_create]:
            w.setEnabled(not busy)

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
            width = max(700, min(2000, int(self.width.text())))
            quality = max(25, min(85, int(self.quality.text())))
        except ValueError:
            QMessageBox.critical(self, "Invalid Settings", "Width/quality must be whole numbers.")
            return

        mode = "image" if self.mode.currentText().startswith("Image Pages") else "hybrid"
        self.set_busy(True)
        self.status.setText("Converting... Please wait.")
        self.log_msg(f"Starting conversion mode={mode}, width={width}, quality={quality}")
        self.worker = ConvertWorker(self.script_path, pdf, out, mode, width, quality)
        self.worker.done.connect(self.on_done)
        self.worker.failed.connect(self.on_fail)
        self.worker.start()

    def on_done(self, out_path: str):
        self.set_busy(False)
        self.last_out = out_path
        self.btn_open_epub.setEnabled(True)
        self.status.setText(f"Done: {out_path}")
        self.log_msg(f"Done: {out_path}")
        if self.auto_open.isChecked():
            self.open_out()
        QMessageBox.information(self, "Complete", f"EPUB created:\n{out_path}")

    def on_fail(self, err: str):
        self.set_busy(False)
        self.status.setText("Conversion failed")
        self.log_msg(f"Error: {err}")
        QMessageBox.critical(self, "Error", err)

    def open_out(self):
        d = Path(self.out_path_lbl.text())
        if d.exists():
            subprocess.Popen(["open", str(d)] if sys.platform == "darwin" else ["xdg-open", str(d)])

    def open_latest(self):
        p = Path(self.last_out)
        if p.exists():
            subprocess.Popen(["open", str(p)] if sys.platform == "darwin" else ["xdg-open", str(p)])


def main_qt():
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main_qt())
