import React, { useEffect, useRef, useState } from 'react';
import { apiFetch, gatewayUrl, hosted, platform } from './platform';
import {
  generateResponseSchema,
  generationFormSchema,
  resumeExtractionSchema,
  resumeFileSchema,
  zodErrorMessage,
} from './validation';

const JOB_URL_STORAGE_KEY = 'resumeATS.jobUrlSuggestions.v1';
const JOB_URL_SUGGESTION_LIMIT = 12;

function loadJobUrlSuggestions() {
  try {
    const saved = JSON.parse(localStorage.getItem(JOB_URL_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(Boolean).slice(0, JOB_URL_SUGGESTION_LIMIT) : [];
  } catch {
    return [];
  }
}

function firstFiveWords(value = '') {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 5) return words.join(' ');
  return `${words.slice(0, 5).join(' ')}…`;
}

function IndexedSection({ title, prefix, items }) {
  return (
    <div className="extract-block">
      <h3>{title}</h3>
      {items.length ? (
        <ul className="extract-list">
          {items.map((item, index) => (
            <li key={`${prefix}-${index}-${item}`}>
              <span className="variable-label">[{prefix}{index + 1}]</span>{' '}
              {item}
            </li>
          ))}
        </ul>
      ) : <p className="muted">Not detected</p>}
    </div>
  );
}

export default function App() {
  const [resume, setResume] = useState(null);
  const [jobUrl, setJobUrl] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [jobUrlSuggestions, setJobUrlSuggestions] = useState(loadJobUrlSuggestions);
  const [outputFormat, setOutputFormat] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [extraction, setExtraction] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');

  const [preview, setPreview] = useState('');
  const [downloading, setDownloading] = useState('');
  const [access, setAccess] = useState(hosted ? 'checking' : 'ready');
  const [accessError, setAccessError] = useState('');
  const extractionRequest = useRef(0);

  useEffect(() => {
    if (!hosted) return undefined;
    let mounted = true;
    async function check() {
      try {
        await apiFetch('/access');
        if (mounted) { setAccess('ready'); setAccessError(''); }
      } catch (err) {
        if (mounted) { setAccess('locked'); setAccessError(err.message); }
      }
    }
    check();
    const { data: listener } = platform.auth.onAuthStateChange(() => { setTimeout(check, 0); });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  const executiveSummary = extraction?.executive_summary || '';
  const contact = extraction || {};
  const skills = extraction?.skills || [];
  const jobs = extraction?.experience || [];
  const education = extraction?.education || [];
  const clearances = extraction?.clearances || [];
  const certifications = extraction?.certifications || [];
  const targetPositionTitle = extraction?.target_position_title || '';

  function rememberJobUrl(rawUrl) {
    const url = rawUrl.trim();
    if (!url) return;

    setJobUrlSuggestions((current) => {
      const next = [url, ...current.filter((item) => item !== url)].slice(0, JOB_URL_SUGGESTION_LIMIT);
      try { localStorage.setItem(JOB_URL_STORAGE_KEY, JSON.stringify(next)); } catch { /* Storage is optional. */ }
      return next;
    });
  }

  async function handleResumeChange(e) {
    const requestId = ++extractionRequest.current;
    const file = e.target.files?.[0] || null;
    setResume(null);
    setExtraction(null);
    setExtractError('');
    setData(null);
    setPreview('');
    setExtracting(false);

    if (!file) return;

    const fileValidation = resumeFileSchema.safeParse(file);
    if (!fileValidation.success) {
      setExtractError(zodErrorMessage(fileValidation, 'Invalid resume file.'));
      e.target.value = '';
      return;
    }

    setResume(file);
    setExtracting(true);
    try {
      const form = new FormData();
      form.append('resume', file);

      const resp = await apiFetch('/extract', { method: 'POST', body: form });

      const payload = await resp.json();
      const validation = resumeExtractionSchema.safeParse(payload);
      if (!validation.success) {
        throw new Error(`Extraction validation failed: ${zodErrorMessage(validation)}`);
      }

      if (requestId === extractionRequest.current) setExtraction(validation.data);
    } catch (err) {
      if (requestId === extractionRequest.current) setExtractError(`Extraction failed: ${err.message}`);
    } finally {
      if (requestId === extractionRequest.current) setExtracting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const validation = generationFormSchema.safeParse({
      resume,
      jobUrl,
      jobDescription,
      outputFormat,
    });

    if (!validation.success) {
      setError(zodErrorMessage(validation, 'Please correct the form data.'));
      return;
    }

    const validated = validation.data;
    setLoading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('resume', validated.resume);
      form.append('job_url', validated.jobUrl);
      form.append('job_description', validated.jobDescription);
      form.append('output_format', validated.outputFormat);

      const resp = await apiFetch('/generate', { method: 'POST', body: form });

      const payload = await resp.json();
      const responseValidation = generateResponseSchema.safeParse(payload);
      if (!responseValidation.success) {
        throw new Error(`Response validation failed: ${zodErrorMessage(responseValidation)}`);
      }

      rememberJobUrl(validated.jobUrl);
      setJobUrl(validated.jobUrl);
      setData(responseValidation.data);
      setPreview(responseValidation.data.preview);
    } catch (err) {
      setError(`Generation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function download(format) {
    setDownloading(format);
    setError('');
    try {
      const response = await apiFetch('/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: preview, job_title: data.job_title, output_format: format }),
      });
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `resume.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setError(`Download failed: ${err.message}`);
    } finally { setDownloading(''); }
  }

  if (access !== 'ready') return (
    <main className="access-panel panel">
      <a href="https://jisystems.net/">J.I. Systems</a>
      <h1>ResumeATS</h1>
      <p role="status">{access === 'checking' ? 'Checking your platform access…' : accessError}</p>
      {access === 'locked' && <a href={gatewayUrl}>Sign in or check access</a>}
    </main>
  );

  return (
    <main className="shell">
      <section className="panel left-panel">
        {hosted && <a href="https://jisystems.net/tools/">← J.I. Systems tools</a>}
        <h1>Resume ATS Optimizer</h1>
        <p>Review your resume against a job description, edit the full preview, and download DOCX, PDF, or RTF.</p>

        <form onSubmit={handleSubmit} className="form">
          <label>
            Resume file
            <input type="file" accept=".docx,.pdf,.txt,.md,.rtf" disabled={loading} onChange={handleResumeChange} />
          </label>

          <label>
            Job URL
            <input
              name="job_url"
              value={jobUrl}
              onChange={(e) => setJobUrl(e.target.value)}
              placeholder="https://company.com/careers/role"
              list="job-url-suggestions"
              autoComplete="on"
            />
            <datalist id="job-url-suggestions">
              {jobUrlSuggestions.map((url) => <option value={url} key={url} />)}
            </datalist>
          </label>

          <label>
            Or paste the job description
            <textarea value={jobDescription} onChange={(e) => setJobDescription(e.target.value)}
              maxLength={30000} rows={4} placeholder="Use this if the job page requires a login or blocks access." />
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

          <button disabled={loading || extracting || !resume}>{loading ? 'Preparing…' : 'Prepare resume'}</button>
          {error && <p className="error">{error}</p>}
        </form>

        <section className="extraction-panel">
          <div className="extraction-header">
            <h2>Resume Extraction</h2>
            {extracting && <span className="extracting">Extracting…</span>}
          </div>

          {!resume && !extractError && <p className="empty-state">Upload a resume to populate its extracted elements.</p>}
          {resume && !extracting && !extraction && !extractError && (
            <p className="empty-state">No extracted elements yet.</p>
          )}
          {extractError && <p className="error">{extractError}</p>}

          {extraction && (
            <div className="extraction-content">
              <div className="extract-block contact-block">
                <h3>Contact Information</h3>
                <p><span className="variable-label">[NameF]</span> {contact.name_first || 'Not detected'}</p>
                <p><span className="variable-label">[NameL]</span> {contact.name_last || 'Not detected'}</p>
                <p><span className="variable-label">[Suffix]</span> {contact.suffix || 'Not detected'}</p>
                <p><span className="variable-label">[Phone]</span> {contact.phone || 'Not detected'}</p>
                <p><span className="variable-label">[City]</span> {contact.city || 'Not detected'}, <span className="variable-label">[State]</span> {contact.state || 'Not detected'}</p>
                <p><span className="variable-label">[Email]</span> {contact.email || 'Not detected'}</p>
                <p><span className="variable-label">[LinkedIn]</span> {contact.linkedin || 'Not detected'}</p>
                <p><span className="variable-label">[Site]</span> {contact.site || 'Not detected'}</p>
                <p><span className="variable-label">[cred]</span> {contact.cred || 'Not detected'}</p>
              </div>

              <div className="extract-block">
                <h3>Executive Summary</h3>
                <p>{executiveSummary || 'Not detected'}</p>
              </div>

              <div className="extract-block">
                <h3>Skills</h3>
                {skills.length ? (
                  <div className="skill-list">
                    {skills.map((skill, index) => (
                      <span className="skill-chip" key={`${skill}-${index}`}>{skill}</span>
                    ))}
                  </div>
                ) : <p className="muted">Not detected</p>}
              </div>

              <div className="extract-block">
                <h3>Experience (Jobs)</h3>
                {jobs.length ? (
                  <div className="job-list">
                    {jobs.map((job, index) => {
                      const jobNumber = job.number || index + 1;
                      const jobTitle = job.job || 'Not detected';
                      const company = job.company || 'Not detected';
                      const dateRange = job.date_range || 'Not detected';
                      const descriptions = job.descriptions || [];

                      return (
                        <div className="job-entry" key={`${jobNumber}-${jobTitle}-${company}`}>
                          <div className="job-heading">
                            <strong><span className="variable-label">[job{jobNumber}]</span> {jobTitle}</strong>
                            <strong><span className="variable-label">[comp{jobNumber}]</span> {company}</strong>
                            <strong><span className="variable-label">[date{jobNumber}]</span> {dateRange}</strong>
                          </div>

                          {descriptions.length ? (
                            <ul className="job-description-list">
                              {descriptions.map((description, descriptionIndex) => (
                                <li key={`${jobNumber}-${descriptionIndex}-${description}`}>
                                  <span className="variable-label">[desc{descriptionIndex + 1}]</span>{' '}
                                  {firstFiveWords(description)}
                                </li>
                              ))}
                            </ul>
                          ) : <p className="muted job-no-description">No line items detected</p>}
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="muted">Not detected</p>}
              </div>

              <IndexedSection title="Education" prefix="edu" items={education} />
              <IndexedSection title="Clearances" prefix="clr" items={clearances} />
              <IndexedSection title="Certifications" prefix="cert" items={certifications} />

              <div className="extract-block target-title-block">
                <h3>Target Position Title</h3>
                <p>{targetPositionTitle || 'Not detected'}</p>
              </div>
            </div>
          )}
        </section>
      </section>

      <section className="panel">
        <h2>Preview</h2>
        {!data && <p>No generated resume yet.</p>}
        {data && (
          <>
            <p className="meta">Role: <strong>{data.job_title}</strong> · Company: <strong>{data.company}</strong></p>
            <p className="muted">Your original facts are preserved. Add suggested keywords only when they accurately describe your experience.</p>
            {data.keywords.length > 0 && <div className="keyword-panel" aria-label="Job keyword review">
              {data.keywords.map(({ keyword, status }) => <span className="skill-chip" key={keyword}>{keyword} · {status === 'present' ? 'in resume' : 'review'}</span>)}
            </div>}
            <label>Editable resume preview
              <textarea className="preview" value={preview} maxLength={100000} onChange={(e) => setPreview(e.target.value)} />
            </label>
            <div className="downloads">
              {(outputFormat === 'all' ? ['docx', 'pdf', 'rtf'] : [outputFormat]).map((ext) => (
                <button key={ext} type="button" disabled={Boolean(downloading) || !preview.trim()} onClick={() => download(ext)}>
                  {downloading === ext ? 'Preparing…' : `Download ${ext.toUpperCase()}`}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
