const { useState, useRef } = React;

// Default export component — single-file React page.
// Tailwind classes used for styling (no imports required if your project already includes Tailwind).
// Features:
// - Paste resume text OR upload .txt or .pdf (client-side PDF parsing via pdfjs-dist CDN)
// - Enter a job posting URL OR paste job posting text
// - Lightweight local template cover-letter generator (no external API required)
// - Optional: call OpenAI's API directly from the browser if you provide an API key (CORS and security warnings apply)

function ResumeToCoverLetter() {
  const [resumeText, setResumeText] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [jobText, setJobText] = useState("");
  const [loading, setLoading] = useState(false);
  const [coverLetter, setCoverLetter] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const fileInputRef = useRef(null);

  // Minimal stopwords set for keyword extraction
  const STOPWORDS = new Set([
    "a","an","the","and","or","of","to","for","in","on","with","as","by","is","are","be","that","this","we","you","your","our","at","from","will","have","has","it","its"
  ]);

  // Basic helper: tokenize and return frequency map
  function wordFrequencies(text) {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s\-#\+]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.replace(/^[-#\+]+|[-#\+]+$/g, ""));

    const freq = new Map();
    for (const w of words) {
      if (w.length < 2) continue;
      if (STOPWORDS.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    return freq;
  }

  function topKeywords(text, n = 10) {
    const freq = wordFrequencies(text);
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(x => x[0]);
  }

  // Try to fetch job posting HTML and extract readable text (subject to CORS)
  async function fetchJobUrl(url) {
    setLoading(true);
    setJobText("");
    try {
      const res = await fetch(`https://api.scraperapi.com?api_key=KEY&url=...`)

      const html = await res.text();
      // Parse HTML string into DOM
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Try to get title, meta description, job posting main text
      const title = doc.querySelector("h1")?.innerText || doc.title || "";
      const metaDesc = doc.querySelector('meta[name="description"]')?.content || doc.querySelector('meta[property="og:description"]')?.content || "";

      // get visible paragraphs
      const paragraphs = Array.from(doc.querySelectorAll("p"))
        .map(p => p.innerText.trim())
        .filter(Boolean)
        .slice(0, 80); // limit

      const combined = [title, metaDesc, ...paragraphs].join("\n\n");
      setJobText(combined);
    } catch (e) {
      setJobText(`Unable to fetch job posting. CORS or network blocked. Paste job text manually. (Error: ${e.message})`);
    }
    setLoading(false);
  }

  // Read uploaded file: .txt or .pdf (pdf via pdfjs-dist from CDN)
  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.txt') || name.endsWith('.md')) {
      const txt = await file.text();
      setResumeText(txt);
      return;
    }

    if (name.endsWith('.pdf')) {
      // Dynamically load pdfjs-dist from UNPKG CDN
      setLoading(true);
      try {
        if (!window.pdfjsLib) {
          await loadScript('https://unpkg.com/pdfjs-dist@3.7.107/build/pdf.min.js');
          // workerSrc required
          window.pdfjsLib.GlobalWorkerOptions = { workerSrc: 'https://unpkg.com/pdfjs-dist@3.7.107/build/pdf.worker.min.js' };
        }
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const strings = content.items.map(item => item.str);
          fullText += strings.join(' ') + '\n\n';
        }
        setResumeText(fullText);
      } catch (err) {
        setResumeText(`Failed to parse PDF: ${err.message}`);
      }
      setLoading(false);
      return;
    }

    // fallback try to read as text
    try {
      const txt = await file.text();
      setResumeText(txt);
    } catch (err) {
      setResumeText(`Unable to read file: ${err.message}`);
      console.error(err);
    }
  }

  // Dynamic script loader
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) return existing.onload ? resolve() : existing.addEventListener('load', resolve);
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  // Basic template generator that matches keywords from job posting and resume
  function generateTemplateCoverLetter(resume, job) {
    if (!resume && !job) return '';

    const resumeKeywords = topKeywords(resume || '', 20);
    const jobKeywords = topKeywords(job || '', 20);

    // intersection prioritized
    const intersection = jobKeywords.filter(k => resumeKeywords.includes(k)).slice(0, 8);
    const highlight = intersection.length ? intersection.join(', ') : resumeKeywords.slice(0, 6).join(', ');

    // try to extract job title/company
    const titleMatch = job.match(/\b([A-Z][a-zA-Z0-9 &\-]{2,50})\b/);
    const jobTitle = (job.split('\n')[0] || titleMatch?.[1] || 'the role').trim();

    // pick candidate name from resume if present (simple heuristic)
    const nameMatch = resume.match(/^(?:name[:\-\s]*)?([A-Z][a-z]+\s[A-Z][a-z]+)$/m);
    const candidateName = nameMatch?.[1] || '';

    const opening = `Dear Hiring Manager,\n\nI am writing to express my interest in ${jobTitle}. With proven experience in ${highlight} and a track record of delivering results, I am confident I would be a strong fit for your team.`;

    const body = `In my previous roles I have demonstrated the skills and responsibilities you seek — including ${highlight}. My resume (attached) outlines accomplishments such as: \n- ${resume.split('\n').find(l=>/\b(project|led|developed|built|created|improved)\b/i) || 'Relevant project experience and measurable outcomes.'}\n\nI am excited about the opportunity to bring my experience to this position and to contribute to your team’s goals.`;

    const closing = `Thank you for considering my application. I look forward to the possibility of discussing how my background aligns with your needs.\n\nSincerely,\n${candidateName || '[Your Name]'}\n`;

    return `${opening}\n\n${body}\n\n${closing}`;
  }

  // Optional: call OpenAI (requires key). This is provided as an option — keys in-browser are insecure and CORS may block.
  async function generateWithOpenAI() {
    if (!openAiKey) {
      alert('Provide an OpenAI API key in the box (or use template generator). Keep in mind keys in browser are insecure.');
      return;
    }
    setLoading(true);
    try {
      const prompt = `You are a professional resume and cover letter writer. Generate a concise, persuasive cover letter (approx. 3 short paragraphs) tailored to the following job posting and resume. Job posting:\n\n${jobText}\n\nResume:\n\n${resumeText}\n\nProduce only the cover letter.`;

      const payload = {
        model: "gpt-4o-mini", // user can change when integrating; note: ensure the model exists for their account
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.2,
      };

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`${res.status} ${res.statusText} -- ${t}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || JSON.stringify(data);
      setCoverLetter(text);
    } catch (err) {
      setCoverLetter(`OpenAI error: ${err.message}`);
    }
    setLoading(false);
  }

  function downloadTxt(filename, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex flex-col items-center">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow p-6">
        <h1 className="text-2xl font-semibold mb-4">Resume → Cover Letter</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Upload resume (.txt, .md, .pdf) or paste below</label>
            <div className="mt-2 flex gap-2">
              <input ref={fileInputRef} onChange={handleFileUpload} type="file" accept=".txt,.md,.pdf" className="block w-full text-sm text-slate-500" />
            </div>
            <textarea value={resumeText} onChange={e => setResumeText(e.target.value)} rows={10} className="mt-3 w-full p-3 border rounded-md" placeholder="Paste resume text here (or upload a .txt/.pdf)"></textarea>
          </div>

          <div>
            <label className="block text-sm font-medium">Job posting URL or paste job text</label>
            <div className="mt-2 flex gap-2">
              <input value={jobUrl} onChange={e => setJobUrl(e.target.value)} className="flex-1 p-2 border rounded-md" placeholder="https://... or leave blank and paste the job text" />
              <button onClick={() => fetchJobUrl(jobUrl)} className="px-3 py-2 bg-indigo-600 text-white rounded-md">Fetch</button>
            </div>
            <textarea value={jobText} onChange={e => setJobText(e.target.value)} rows={10} className="mt-3 w-full p-3 border rounded-md" placeholder="Fetched job posting text or paste the job description here"></textarea>
          </div>
        </div>

        <div className="mt-4 flex flex-col md:flex-row gap-3 items-start">
          <div className="flex gap-2">
            <button disabled={loading} onClick={() => setCoverLetter(generateTemplateCoverLetter(resumeText, jobText))} className="px-4 py-2 bg-green-600 text-white rounded-md">Generate (Template)</button>
            <button disabled={loading} onClick={generateWithOpenAI} className="px-4 py-2 bg-blue-600 text-white rounded-md">Generate with OpenAI</button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <input value={openAiKey} onChange={e => setOpenAiKey(e.target.value)} className="p-2 border rounded-md w-72" placeholder="Optional OpenAI API key (browser use is insecure)" />
          </div>
        </div>

        <div className="mt-6">
          <label className="block text-sm font-medium mb-2">Generated Cover Letter</label>
          <div className="p-4 border rounded-md bg-slate-50 min-h-[160px] whitespace-pre-wrap">{loading ? 'Working...' : (coverLetter || 'No cover letter generated yet.')}</div>

          <div className="flex gap-2 mt-3">
            <button onClick={() => downloadTxt('cover-letter.txt', coverLetter || '')} className="px-4 py-2 bg-slate-700 text-white rounded-md">Download .txt</button>
            <button onClick={() => navigator.clipboard?.writeText(coverLetter || '')} className="px-4 py-2 bg-slate-300 rounded-md">Copy to clipboard</button>
          </div>

          <div className="mt-4 text-sm text-slate-500">
            <strong>Notes:</strong>
            <ul className="list-disc ml-5">
              <li>If the job URL fetch fails, the site probably blocks cross-origin requests — paste the job text manually.</li>
              <li>PDF parsing uses a small client-side PDF library loaded from UNPKG; it may take a moment for large PDFs.</li>
              <li>OpenAI option requires an API key. Do not paste sensitive keys in shared browsers. CORS, billing, and model availability may affect the request.</li>
            </ul>
          </div>
        </div>

      </div>

      <div className="mt-6 text-sm text-slate-500 max-w-4xl">
        Tip: paste high-quality resume text and a clear job description for best results. Use the OpenAI option if you want a more human-sounding letter (you must supply your key).
      </div>
    </div>
  );
}
// Only needed for the browser — renders root component for ReactDOM 18
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<ResumeToCoverLetter />);

