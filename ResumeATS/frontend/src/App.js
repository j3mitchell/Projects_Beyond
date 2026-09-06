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

function EditableValue({ label, value, onChange, field, multiline = false, type = 'text', placeholder = '' }) {
  const Input = multiline ? 'textarea' : 'input';
  return (
    <div className="editable-field" data-field={field || label}>
      <label>
        <span className="variable-label">{label}</span>
        <Input
          className="editable-input"
          type={multiline ? undefined : type}
          value={value || ''}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function EditableList({ title, prefix, items, onChange, field }) {
  const values = Array.isArray(items) ? items : [];

  function updateItem(index, value) {
    onChange(values.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function removeItem(index) {
    onChange(values.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="extract-block editable-list" data-field={field || prefix}>
      <h3>{title}</h3>
      {values.map((item, index) => (
        <div className="editable-list-row" key={`${prefix}-${index}`}>
          <EditableValue
            label={`[${prefix}${index + 1}]`}
            value={item}
            field={`${prefix}${index + 1}`}
            onChange={(value) => updateItem(index, value)}
          />
          <button type="button" className="field-remove" onClick={() => removeItem(index)} aria-label={`Remove ${title} ${index + 1}`}>Remove</button>
        </div>
      ))}
      {!values.length && <p className="muted">Not detected</p>}
      <button type="button" className="field-add" onClick={() => onChange([...values, ''])}>Add {title.toLowerCase()}</button>
    </div>
  );
}

function EditableSection({ title, prefix, items, onChange, field }) {
  return (
    <EditableList title={title} prefix={prefix} items={items} onChange={onChange} field={field} />
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

  function updateExtraction(field, value) {
    setExtraction((current) => current ? { ...current, [field]: value } : current);
  }

  function updateJob(index, field, value) {
    setExtraction((current) => {
      if (!current) return current;
      const experience = Array.isArray(current.experience) ? current.experience : [];
      return {
        ...current,
        experience: experience.map((job, jobIndex) => (
          jobIndex === index ? { ...job, [field]: value } : job
        )),
      };
    });
  }

  function updateJobDescriptions(index, descriptions) {
    updateJob(index, 'descriptions', descriptions);
  }

  function removeJob(index) {
    updateExtraction('experience', jobs
      .filter((_, jobIndex) => jobIndex !== index)
      .map((job, jobIndex) => ({ ...job, number: jobIndex + 1 })));
  }

  function addJob() {
    updateExtraction('experience', [
      ...jobs,
      { number: jobs.length + 1, job: '', company: '', date_range: '', descriptions: [''] },
    ]);
  }

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
            <input type="file" accept=".docx,.pdf,.txt,.md,.rtf,.html,.htm,.doc,.odt,.json,.xml,.pages,.zip" disabled={loading} onChange={handleResumeChange} />
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
              <div className="extract-block contact-block" data-field="contact">
                <h3>Contact Information</h3>
                <EditableValue label="[NameF]" field="name_first" value={contact.name_first} onChange={(value) => updateExtraction('name_first', value)} />
                <EditableValue label="[NameL]" field="name_last" value={contact.name_last} onChange={(value) => updateExtraction('name_last', value)} />
                <EditableValue label="[Suffix]" field="suffix" value={contact.suffix} onChange={(value) => updateExtraction('suffix', value)} />
                <EditableValue label="[Phone]" field="phone" value={contact.phone} onChange={(value) => updateExtraction('phone', value)} type="tel" />
                <div className="contact-location">
                  <EditableValue label="[City]" field="city" value={contact.city} onChange={(value) => updateExtraction('city', value)} />
                  <EditableValue label="[State]" field="state" value={contact.state} onChange={(value) => updateExtraction('state', value)} />
                </div>
                <EditableValue label="[Email]" field="email" value={contact.email} onChange={(value) => updateExtraction('email', value)} type="email" />
                <EditableValue label="[LinkedIn]" field="linkedin" value={contact.linkedin} onChange={(value) => updateExtraction('linkedin', value)} type="url" />
                <EditableValue label="[Site]" field="site" value={contact.site} onChange={(value) => updateExtraction('site', value)} type="url" />
                <EditableValue label="[cred]" field="cred" value={contact.cred} onChange={(value) => updateExtraction('cred', value)} multiline />
              </div>

              <div className="extract-block" data-field="executive_summary">
                <h3>Executive Summary</h3>
                <EditableValue label="[summary]" field="executive_summary" value={executiveSummary} onChange={(value) => updateExtraction('executive_summary', value)} multiline />
              </div>

              <EditableSection title="Skills" prefix="skill" items={skills} onChange={(values) => updateExtraction('skills', values)} field="skills" />

              <div className="extract-block" data-field="experience">
                <h3>Experience (Jobs)</h3>
                {jobs.length ? (
                  <div className="job-list">
                    {jobs.map((job, index) => {
                      const jobNumber = index + 1;
                      const descriptions = Array.isArray(job.descriptions) ? job.descriptions : [];

                      return (
                        <div className="job-entry editable-job" key={`job-${index}`} data-field={`experience.${index}`}>
                          <EditableValue label={`[job${jobNumber}]`} field={`job${jobNumber}`} value={job.job} onChange={(value) => updateJob(index, 'job', value)} />
                          <EditableValue label={`[comp${jobNumber}]`} field={`comp${jobNumber}`} value={job.company} onChange={(value) => updateJob(index, 'company', value)} />
                          <EditableValue label={`[date${jobNumber}]`} field={`date${jobNumber}`} value={job.date_range} onChange={(value) => updateJob(index, 'date_range', value)} placeholder="mm/yy - mm/yy" />
                          <div className="job-description-editor">
                            <span className="section-label">Descriptions</span>
                            {descriptions.map((description, descriptionIndex) => (
                              <div className="editable-list-row" key={`job-${index}-description-${descriptionIndex}`}>
                                <EditableValue
                                  label={`[desc${descriptionIndex + 1}]`}
                                  field={`desc${jobNumber}-${descriptionIndex + 1}`}
                                  value={description}
                                  onChange={(value) => updateJobDescriptions(index, descriptions.map((item, itemIndex) => itemIndex === descriptionIndex ? value : item))}
                                  multiline
                                />
                                <button type="button" className="field-remove" onClick={() => updateJobDescriptions(index, descriptions.filter((_, itemIndex) => itemIndex !== descriptionIndex))} aria-label={`Remove description ${descriptionIndex + 1} from job ${jobNumber}`}>Remove</button>
                              </div>
                            ))}
                            {!descriptions.length && <p className="muted">No line items detected</p>}
                            <button type="button" className="field-add" onClick={() => updateJobDescriptions(index, [...descriptions, ''])}>Add description</button>
                          </div>
                          <button type="button" className="field-remove job-remove" onClick={() => removeJob(index)} aria-label={`Remove job ${jobNumber}`}>Remove job</button>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="muted">Not detected</p>}
                <button type="button" className="field-add" onClick={addJob}>Add job</button>
              </div>

              <EditableSection title="Education" prefix="edu" items={education} onChange={(values) => updateExtraction('education', values)} field="education" />
              <EditableSection title="Clearances" prefix="clr" items={clearances} onChange={(values) => updateExtraction('clearances', values)} field="clearances" />
              <EditableSection title="Certifications" prefix="cert" items={certifications} onChange={(values) => updateExtraction('certifications', values)} field="certifications" />

              <div className="extract-block target-title-block" data-field="target_position_title">
                <h3>Target Position Title</h3>
                <EditableValue label="[target]" field="target_position_title" value={targetPositionTitle} onChange={(value) => updateExtraction('target_position_title', value)} />
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
