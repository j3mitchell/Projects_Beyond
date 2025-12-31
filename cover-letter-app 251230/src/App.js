// src/App.js
import React, { useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist/webpack";
import "./App.css";
import { DndProvider, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { DraggableBox } from "./DraggableBox";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

function getRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset);
    r.collapse(true);
    return r;
  }
  return null;
}

function AppInner() {
  const editableRef = useRef(null);
  const [fileContent, setFileContent] = useState("");
  const [inputs, setInputs] = useState(Array(10).fill(""));

  // ----------- FILE UPLOAD -----------
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();

    if (file.type === "text/plain") {
      reader.onload = (ev) => {
        const clean = ev.target.result
          .replace(/\r\n/g, "\n")
          .replace(/\n/g, "<br>");
        setFileContent(clean);
      };
      reader.readAsText(file);
      return;
    }

    if (file.type === "application/pdf") {
      reader.onload = async (ev) => {
        const pdfData = new Uint8Array(ev.target.result);
        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((it) => it.str).join(" ") + "<br>";
        }
        text = text.replace(/(<br>\s*){2,}/g, "<br>");
        setFileContent(text);
      };
      reader.readAsArrayBuffer(file);
      return;
    }
  };

  // ----------- EDITABLE SYNC -----------
  const onEditableInput = () => setFileContent(editableRef.current.innerHTML);

  const clearCaret = () => {
    const caret = editableRef.current?.querySelector(".insertion-caret");
    if (caret) caret.remove();
  };

  const showCaret = useCallback((range) => {
    clearCaret();
    if (!range) return;
    const caret = document.createElement("span");
    caret.className = "insertion-caret";
    caret.style.width = "2px";
    caret.style.height = "1em";
    caret.style.background = "#007bff";
    caret.style.display = "inline-block";
    range.insertNode(caret);
  }, []);

  const insertAtRange = useCallback((range, text) => {
    range.deleteContents();
    const span = document.createElement("span");
    span.textContent = text;
    span.style.color = "red"; // dropped text appears RED
    range.insertNode(span);

    const newRange = document.createRange();
    newRange.setStartAfter(span);
    newRange.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(newRange);
  }, []);

  // ----------- DROP HANDLING -----------
  const [, dropRef] = useDrop({
    accept: "BOX",
    hover(item, monitor) {
      const off = monitor.getClientOffset();
      if (!off) return clearCaret();
      const range = getRangeFromPoint(off.x, off.y);
      if (range && editableRef.current.contains(range.startContainer)) {
        showCaret(range);
      } else clearCaret();
    },
    drop(item, monitor) {
      const off = monitor.getClientOffset();
      clearCaret();
      if (!off) return;

      let range = getRangeFromPoint(off.x, off.y);
      if (!range || !editableRef.current.contains(range.startContainer)) {
        range = document.createRange();
        range.selectNodeContents(editableRef.current);
        range.collapse(false);
      }

      insertAtRange(range, `}}${item.text}{{`);

      setTimeout(() => setFileContent(editableRef.current.innerHTML), 10);
    },
  });

  const combinedRef = (node) => {
    editableRef.current = node;
    dropRef(node);
  };

  // ----------- EXPORT CLEANUP -----------
  const cleanExportText = (html) => {
    return html
      .replace(/<br>/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .replace(/^<br>/gm, "")
      .replace(/}}/g, "")
      .replace(/{{/g, "");
  };

  const download = (clean = false) => {
    const out = clean ? cleanExportText(fileContent) : fileContent;
    const blob = new Blob([out], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = clean ? "final.txt" : "with_markers.txt";
    a.click();
  };

  return (
    <div style={{ display: "flex", padding: 20, gap: 20 }}>
      {/* ---------- LEFT: CV TEXT ---------- */}
      <div style={{ flex: 2 }}>
        <h2>Cover Letter Editor</h2>

        <input
          type="file"
          accept=".txt,.pdf"
          onChange={handleFileUpload}
          style={{ marginBottom: 10 }}
        />
        <button onClick={() => download(false)} style={{ marginLeft: 10 }}>
          Download (raw)
        </button>
        <button onClick={() => download(true)} style={{ marginLeft: 10 }}>
          Final (clean)
        </button>

        <div
          ref={combinedRef}
          contentEditable
          suppressContentEditableWarning
          onInput={onEditableInput}
          style={{
            border: "1px solid #ccc",
            minHeight: 400,
            marginTop: 20,
            padding: 10,
            whiteSpace: "normal",
            lineHeight: "1.3",
          }}
          dangerouslySetInnerHTML={{ __html: fileContent }}
        />
      </div>

      {/* ---------- RIGHT: Fields + Draggable Boxes ---------- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <h2>Fields</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: 10 }}>
          {inputs.map((v, i) => (
            <DraggableBox key={i} id={i} text={v} index={i} />
          ))}
        </div>

        {inputs.map((v, i) => (
          <input
            key={i}
            value={v}
            onChange={(e) => {
              const arr = [...inputs];
              arr[i] = e.target.value.slice(0, 20); // max 20 chars
              setInputs(arr);
            }}
            placeholder={`Field ${i + 1}`}
            style={{ marginBottom: 6 }}
          />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <DndProvider backend={HTML5Backend}>
      <AppInner />
    </DndProvider>
  );
}
