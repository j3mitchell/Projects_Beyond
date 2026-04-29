import React, { useState } from 'react';

const CoverLetterEditor = () => {
  const [fileContent, setFileContent] = useState('');
  const [inputs, setInputs] = useState(Array(10).fill(''));

  // Handle file upload
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    if (file.type === 'text/plain') {
      reader.onload = (e) => setFileContent(e.target.result);
      reader.readAsText(file);
    } else if (file.type === 'application/pdf') {
      reader.onload = async (e) => {
        const pdfjsLib = await import('pdfjs-dist/build/pdf');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((item) => item.str).join(' ') + '\n';
        }
        setFileContent(text);
      };
      reader.readAsArrayBuffer(file);
    } else {
      alert('Only TXT and PDF files are supported.');
    }
  };

  // Handle input changes
  const handleInputChange = (index, value) => {
    const newInputs = [...inputs];
    newInputs[index] = value;
    setInputs(newInputs);
  };

  // Handle download
  const handleDownload = () => {
    const blob = new Blob([fileContent + '\n\n' + inputs.join('\n')], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'cover_letter.txt';
    link.click();
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: 'auto' }}>
      <h2>Cover Letter Editor</h2>

      <div style={{ marginBottom: '15px' }}>
        <label>
          Upload TXT or PDF: 
          <input type="file" accept=".txt,.pdf" onChange={handleFileUpload} />
        </label>
      </div>

      {fileContent && (
        <div style={{ marginBottom: '15px' }}>
          <h4>Original Content:</h4>
          <textarea
            value={fileContent}
            onChange={(e) => setFileContent(e.target.value)}
            rows={10}
            style={{ width: '100%' }}
          />
        </div>
      )}

      <div>
        <h4>Fill in the fields:</h4>
        {inputs.map((val, idx) => (
          <input
            key={idx}
            type="text"
            placeholder={`Field ${idx + 1}`}
            value={val}
            onChange={(e) => handleInputChange(idx, e.target.value)}
            style={{ display: 'block', width: '100%', marginBottom: '8px' }}
          />
        ))}
      </div>

      <button onClick={handleDownload} style={{ marginTop: '15px', padding: '10px 20px' }}>
        Download TXT
      </button>
    </div>
  );
};

export default CoverLetterEditor;
