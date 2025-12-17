// src/App.js
import React, { useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist/webpack";
import "./App.css";
import { DndProvider, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { DraggableBox } from "./DraggableBox";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// small helper: get a Range from client coordinates
function getRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }
  // Firefox
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

function AppInner() {
  const editableRef = useRef(null);
  const [fileContent, setFileContent] = useState(""); // SAVED AS VARIABLE (state)
  const [inputs, setInputs] = useState(Array(10).fill(""));

  // update input values (text fields)
  const handleInputChange = (idx, val) => {
    const newInputs = [...inputs];
    newInputs[idx] = val;
    setInputs(newInputs);
  };

  // file upload: txt or pdf -> capture as innerHTML/text
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();

    if (file.type === "text/plain") {
      reader.onload = (ev) => setFileContent(ev.target.result);
      reader.readAsText(file);
    } else if (file.type === "application/pdf") {
      reader.onload = async (ev) => {
        const pdfData = new Uint8Array(ev.target.result);
        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((item) => item.str).join(" ") + "\n";
        }
        setFileContent(text);
      };
      reader.readAsArrayBuffer(file);
    } else {
      alert("Only TXT and PDF files are supported.");
    }
  };

  // helper: remove any existing visual caret marker
  const clearVisualCaret = useCallback(() => {
    const root = editableRef.current;
    if (!root) return;
    const existing = root.querySelector(".insertion-caret");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }, []);

  // helper: show a thin caret span at range (visual hover)
  const showVisualCaret = useCallback((range) => {
    clearVisualCaret();
    if (!range || !editableRef.current) return;
    const caret = document.createElement("span");
    caret.className = "insertion-caret";
    caret.style.display = "inline-block";
    caret.style.width = "2px";
    caret.style.height = "1.2em";
    caret.style.background = "#007bff";
    caret.style.verticalAlign = "text-bottom";
    caret.style.marginLeft = "-1px";
    // insert caret (clone of range collapsed)
    const frag = document.createDocumentFragment();
    frag.appendChild(caret);
    range.insertNode(frag);
  }, [clearVisualCaret]);

  // helper: insert marker text at a range
  const insertMarkerAtRange = useCallback((range, markerText) => {
    if (!range) return;
    // delete any selected contents first
    range.deleteContents();
    // create text node
    const node = document.createTextNode(markerText);
    range.insertNode(node);
    // move caret after inserted node
    const afterRange = document.createRange();
    afterRange.setStartAfter(node);
    afterRange.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(afterRange);
  }, []);

  // useDrop hook bound to the editable area (works for hover & drop)
  const [, dropRef] = useDrop({
    accept: "BOX",
    hover(item, monitor) {
      const clientOffset = monitor.getClientOffset();
      if (!clientOffset) {
        clearVisualCaret();
        return;
      }
      const { x, y } = clientOffset;
      const range = getRangeFromPoint(x, y);
      if (range && editableRef.current && editableRef.current.contains(range.startContainer)) {
        // show visual caret inside the editable area
        showVisualCaret(range);
      } else {
        clearVisualCaret();
      }
    },
    drop(item, monitor) {
      // on drop insert marker at caret (based on drop point)
      const clientOffset = monitor.getClientOffset();
      clearVisualCaret();
      if (!clientOffset) return;
      const { x, y } = clientOffset;
      const range = getRangeFromPoint(x, y);
      if (!range) return;
      // only insert if inside editableRef
      if (!editableRef.current || !editableRef.current.contains(range.startContainer)) {
        // if not inside, fall back to appending at end
        const node = editableRef.current;
        node.focus();
        const r = document.createRange();
        r.selectNodeContents(node);
        r.collapse(false);
        insertMarkerAtRange(r, `}}${item.text}{{`);
      } else {
        insertMarkerAtRange(range, `}}${item.text}{{`);
      }
      // update saved variable (state) with current innerHTML/plainText
      // using innerHTML to preserve formatting (user preferred variable)
      setTimeout(() => {
        // small timeout so DOM updates settle
        if (editableRef.current) {
          setFileContent(editableRef.current.innerHTML);
        }
      }, 0);
      return undefined;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  // attach dropRef to the editable wrapper via ref callback so we can also keep editableRef
  const editableWrapperRef = (node) => {
    editableRef.current = node;
    dropRef(node);
  };

  // clear visual caret when user types or on blur
  const onEditableInput = (e) => {
    clearVisualCaret();
    // store innerHTML as the saved variable
    setFileContent(e.currentTarget.innerHTML);
  };

  const handleDownload = () => {
    // final download: remove markers (if user chooses to finalize)
    // Here we build a cleaned version where markers are left as-is, as user requested earlier they will remove on approval.
    // If you want final cleaned file (no markers), run the cleaning step before creating blob:
    const blob = new Blob([fileContent + "\n\n" + inputs.join("\n")], {
      type: "text/plain",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "cover_letter.txt";
    link.click();
  };

  // optional finalize: remove all }} and {{ markers
  const finalizeAndDownload = () => {
    const cleaned = fileContent.replace(/}}/g, "").replace(/{{/g, "");
    const blob = new Blob([cleaned + "\n\n" + inputs.join("\n")], {
      type: "text/plain",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "cover_letter_final.txt";
    link.click();
  };

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "20px auto" }}>
      <h2>Cover Letter Editor — drag to insert at caret</h2>

      <div style={{ marginBottom: 10 }}>
        <input type="file" accept=".txt,.pdf" onChange={handleFileUpload} />
        <button onClick={finalizeAndDownload} style={{ marginLeft: 8 }}>
          Finalize & Download (clean markers)
        </button>
        <button onClick={handleDownload} style={{ marginLeft: 8 }}>
          Download (with markers)
        </button>
      </div>

      <div
        ref={editableWrapperRef}
        contentEditable
        suppressContentEditableWarning
        onInput={onEditableInput}
        onBlur={() => clearVisualCaret()}
        style={{
          border: "1px solid #ccc",
          minHeight: 220,
          padding: 12,
          whiteSpace: "pre-wrap",
          outline: "none",
        }}
        // dangerouslySetInnerHTML avoided to keep children editable and be able to directly manipulate DOM;
        // we initialize content by rendering a child (only when fileContent is HTML string)
        // To avoid React complaining about children vs dangerouslySetInnerHTML, we render the content as a single text node via dangerouslySetInnerHTML only when setting initial fileContent.
        // Here for runtime simplicity, we assign innerHTML directly if fileContent exists:
        dangerouslySetInnerHTML={fileContent ? { __html: fileContent } : undefined}
      ></div>

      <div style={{ marginTop: 12 }}>
        <strong>Draggable boxes (drag onto the CV):</strong>
        <div style={{ marginTop: 8 }}>
          {inputs.map((val, idx) => (
            <DraggableBox key={idx} id={idx} text={val} index={idx} onChange={handleInputChange} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <h4>Field editors</h4>
        {inputs.map((val, idx) => (
          <input
            key={idx}
            type="text"
            placeholder={`Field ${idx + 1}`}
            value={val}
            onChange={(e) => handleInputChange(idx, e.target.value)}
            style={{ width: "100%", margin: "6px 0", padding: 8 }}
          />
        ))}
      </div>
    </div>
  );
}

// Wrap with DndProvider at top level
export default function App() {
  return (
    <DndProvider backend={HTML5Backend}>
      <AppInner />
    </DndProvider>
  );
}
