import React, { useState } from "react";
import * as pdfjsLib from "pdfjs-dist/webpack";
import "./App.css";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { DraggableBox } from "./DraggableBox";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

function App() {
  const [fileContent, setFileContent] = useState("");
  const [inputs, setInputs] = useState(Array(10).fill(""));

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

  const handleInputChange = (idx, val) => {
    const newInputs = [...inputs];
    newInputs[idx] = val;
    setInputs(newInputs);
  };

  const moveBox = (fromIndex, toIndex) => {
    const updated = [...inputs];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    setInputs(updated);
  };

  const handleDownload = () => {
    const blob = new Blob([fileContent + "\n\n" + inputs.join("\n")], {
      type: "text/plain",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "cover_letter.txt";
    link.click();
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div style={{ padding: "20px", maxWidth: "600px", margin: "auto" }}>
        <h2>Cover Letter Editor</h2>

        <input type="file" accept=".txt,.pdf" onChange={handleFileUpload} />

        {fileContent && (
          <div
            contentEditable
            suppressContentEditableWarning
            style={{
              border: "1px solid #ccc",
              minHeight: "200px",
              padding: "10px",
              marginTop: "10px",
              whiteSpace: "pre-wrap",
            }}
            onInput={(e) => setFileContent(e.currentTarget.innerHTML)}
            dangerouslySetInnerHTML={{ __html: fileContent }}
          >
            {inputs.map((val, idx) => (
              <DraggableBox
                key={idx}
                id={idx}
                index={idx}
                text={val}
                moveBox={moveBox}
                onChange={handleInputChange}
              />
            ))}
          </div>
        )}

        <h4>Fill in the fields:</h4>
        {inputs.map((val, idx) => (
          <input
            key={idx}
            type="text"
            placeholder={`Field ${idx + 1}`}
            value={val}
            onChange={(e) => handleInputChange(idx, e.target.value)}
            style={{ width: "100%", marginBottom: "6px" }}
          />
        ))}

        <button onClick={handleDownload} style={{ marginTop: "10px" }}>
          Download TXT
        </button>
      </div>
    </DndProvider>
  );
}

export default App;
