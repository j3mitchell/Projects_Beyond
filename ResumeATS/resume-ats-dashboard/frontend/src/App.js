import React, { useMemo, useState } from 'react';

const API = 'http://127.0.0.1:8000';

export default function App() {
  const [resume, setResume] = useState(null);
  const [jobUrl, setJobUrl] = useState('');
  const [outputFormat, setOutputFormat] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const thumb = useMemo(() => data?.thumbnail || '', [data]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!resume || !jobUrl) {
      setError('Please provide both a resume file and a job URL.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('resume', resume);
      form.append('job_url', jobUrl);
      form.append('output_format', outputFormat);

      const resp = await fetch(`${API}/generate`, { method: 'POST', body: form });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body || 'Unknown API error');
      }
      setData(await resp.json());
    } catch (err) {
      setError(`Generation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="panel">
        <h1>Resume ATS Optimizer</h1>
        <p>Upload your resume + job URL to generate ATS-optimized DOCX/PDF/RTF locally.</p>

        <form onSubmit={handleSubmit} className="form">
          <label>
            Resume file
            <input type="file" accept=".docx,.txt,.md,.rtf" onChange={(e) => setResume(e.target.files?.[0] || null)} />
          </label>

          <label>
            Job URL
            <input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://company.com/careers/role" />
          </label>

          <label>
            Output
            <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
              <option value="all">DOCX + PDF + RTF</option>
              <option value="docx">DOCX</option>
              <option value="pdf">PDF</option>
              <option value="rtf">RTF</option>
            </select>
          </label>

          <button disabled={loading}>{loading ? 'Generating…' : 'Generate resume'}</button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>

      <section className="panel">
        <h2>Preview</h2>
        {!data && <p>No generated resume yet.</p>}
        {data && (
          <>
            <p className="meta">Role: <strong>{data.job_title}</strong> · Company: <strong>{data.company}</strong></p>
            <div className="thumbnail">{thumb}</div>
            <pre className="preview">{data.preview}</pre>
            <div className="downloads">
              {Object.entries(data.files).map(([ext, path]) => (
                <a key={ext} href={`${API}${path}`} target="_blank" rel="noreferrer">
                  Download {ext.toUpperCase()}
                </a>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
