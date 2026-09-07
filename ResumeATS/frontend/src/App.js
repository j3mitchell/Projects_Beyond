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

function hasValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

function hasJobValue(job) {
  return hasValue(job?.job) || hasValue(job?.company) || hasValue(job?.date_range)
    || (Array.isArray(job?.descriptions) && job.descriptions.some(hasValue));
}

function previewText(value, maxLength = 76) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trimEnd()}…` : clean;
}

function ExpansionIndicator() {
  return (
    <span className="expansion-indicator" aria-hidden="true">
      <span className="expansion-closed">Expand</span>
      <span className="expansion-open">Collapse</span>
    </span>
  );
}

function EditableValue({ label, value, onChange, onBlurValue, field, multiline = false, type = 'text', placeholder = '' }) {
  const Input = multiline ? 'textarea' : 'input';
  const inputRef = useRef(null);

  useEffect(() => {
    if (!multiline || !inputRef.current) return;
    const element = inputRef.current;
    element.style.height = 'auto';
    const contentHeight = element.scrollHeight;
    element.style.height = `${Math.min(Math.max(contentHeight, 27), 240)}px`;
    element.style.overflowY = contentHeight > 240 ? 'auto' : 'hidden';
  }, [multiline, value]);

  function cleanTrailingLines(nextValue) {
    return nextValue.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
  }

  return (
    <div className="editable-field" data-field={field || label}>
      <label>
        <span className="variable-label">{label}</span>
        <Input
          ref={multiline ? inputRef : undefined}
          className="editable-input"
          type={multiline ? undefined : type}
          value={value || ''}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => {
            const cleaned = cleanTrailingLines(event.target.value);
            onChange(cleaned);
            onBlurValue?.(cleaned);
          }}
          rows={multiline ? 1 : undefined}
        />
      </label>
    </div>
  );
}

function EditableList({ title, prefix, items, onChange, field }) {
  const values = Array.isArray(items) ? items : [];
  const [draftIndex, setDraftIndex] = useState(null);

  function updateItem(index, value) {
    onChange(values.map((item, itemIndex) => itemIndex === index ? value : item));
  }

  function removeItem(index) {
    onChange(values.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <details className="extract-block editable-list collapsible-section" data-field={field || prefix}>
      <summary><span>{title}</span><ExpansionIndicator /></summary>
      <div className="collapsible-content">
        {values.map((item, index) => {
          if (!hasValue(item) && index !== draftIndex) return null;
          return (
          <div className="editable-list-row" key={`${prefix}-${index}`}>
            <EditableValue
              label={`[${prefix}${index + 1}]`}
              value={item}
              field={`${prefix}${index + 1}`}
              onChange={(value) => {
                updateItem(index, value);
                if (hasValue(value)) setDraftIndex(null);
              }}
              onBlurValue={(value) => {
                if (!hasValue(value)) setDraftIndex(null);
              }}
            />
            <button type="button" className="field-remove" onClick={() => removeItem(index)} aria-label={`Remove ${title} ${index + 1}`}>Remove</button>
          </div>
          );
        })}
        {!values.some(hasValue) && draftIndex === null && <p className="muted">Not detected</p>}
        <button type="button" className="field-add" onClick={() => { setDraftIndex(values.length); onChange([...values, '']); }}>Add {title.toLowerCase()}</button>
      </div>
    </details>
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
  const [jobModel, setJobModel] = useState('deterministic');
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
  const [draftJobIndex, setDraftJobIndex] = useState(null);
  const [draftDescriptionIndexes, setDraftDescriptionIndexes] = useState({});

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
    if (descriptions.some(hasValue)) {
      setDraftJobIndex(null);
      setDraftDescriptionIndexes((current) => {
        const next = { ...current };
        delete next[index];
        return next;
      });
    }
  }

  function removeJob(index) {
    updateExtraction('experience', jobs
      .filter((_, jobIndex) => jobIndex !== index)
      .map((job, jobIndex) => ({ ...job, number: jobIndex + 1 })));
    setDraftJobIndex(null);
    setDraftDescriptionIndexes((current) => {
      const next = {};
      Object.entries(current).forEach(([key, value]) => {
        const numericKey = Number(key);
        if (numericKey < index) next[numericKey] = value;
        if (numericKey > index) next[numericKey - 1] = value;
      });
      return next;
    });
  }

  function addJob() {
    setDraftJobIndex(jobs.length);
    setDraftDescriptionIndexes((current) => ({ ...current, [jobs.length]: 0 }));
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
    setDraftJobIndex(null);
    setDraftDescriptionIndexes({});

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
      jobModel,
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
      form.append('job_model', validated.jobModel);

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

          <fieldset className="model-picker">
            <legend>Job URL analysis</legend>
            <div className="model-picker__labels"><span>Deterministic</span><span>AI</span></div>
            <input
              className="model-slider"
              type="range"
              min="0"
              max="1"
              step="1"
              value={jobModel === 'ai' ? 1 : 0}
              onChange={(event) => setJobModel(event.target.value === '1' ? 'ai' : 'deterministic')}
              aria-label="Choose job URL analysis model"
            />
            <output>{jobModel === 'ai' ? 'AI structured extraction' : 'Deterministic taxonomy ranking'}</output>
            <p className="muted">AI mode uses the server provider when configured.</p>
          </fieldset>

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
              <details className="extract-block contact-block collapsible-section" data-field="contact">
                <summary><span>Contact Information</span><ExpansionIndicator /></summary>
                <div className="collapsible-content">
                  {hasValue(contact.name_first) && <EditableValue label="[NameF]" field="name_first" value={contact.name_first} onChange={(value) => updateExtraction('name_first', value)} />}
                  {hasValue(contact.name_last) && <EditableValue label="[NameL]" field="name_last" value={contact.name_last} onChange={(value) => updateExtraction('name_last', value)} />}
                  {hasValue(contact.suffix) && <EditableValue label="[Suffix]" field="suffix" value={contact.suffix} onChange={(value) => updateExtraction('suffix', value)} />}
                  {hasValue(contact.phone) && <EditableValue label="[Phone]" field="phone" value={contact.phone} onChange={(value) => updateExtraction('phone', value)} type="tel" />}
                  {(hasValue(contact.city) || hasValue(contact.state)) && <div className="contact-location">
                    {hasValue(contact.city) && <EditableValue label="[City]" field="city" value={contact.city} onChange={(value) => updateExtraction('city', value)} />}
                    {hasValue(contact.state) && <EditableValue label="[State]" field="state" value={contact.state} onChange={(value) => updateExtraction('state', value)} />}
                  </div>}
                  {hasValue(contact.email) && <EditableValue label="[Email]" field="email" value={contact.email} onChange={(value) => updateExtraction('email', value)} type="email" />}
                  {hasValue(contact.linkedin) && <EditableValue label="[LinkedIn]" field="linkedin" value={contact.linkedin} onChange={(value) => updateExtraction('linkedin', value)} type="url" />}
                  {hasValue(contact.site) && <EditableValue label="[Site]" field="site" value={contact.site} onChange={(value) => updateExtraction('site', value)} type="url" />}
                  {hasValue(contact.cred) && <EditableValue label="[cred]" field="cred" value={contact.cred} onChange={(value) => updateExtraction('cred', value)} multiline />}
                </div>
              </details>

              {hasValue(executiveSummary) && <details className="extract-block collapsible-section" data-field="executive_summary">
                <summary><span>Executive Summary</span><ExpansionIndicator /></summary>
                <div className="collapsible-content">
                  <EditableValue label="[summary]" field="executive_summary" value={executiveSummary} onChange={(value) => updateExtraction('executive_summary', value)} multiline />
                </div>
              </details>}

              <EditableSection title="Skills" prefix="skill" items={skills} onChange={(values) => updateExtraction('skills', values)} field="skills" />

              <details className="extract-block collapsible-section" data-field="experience">
                <summary><span>Experience (Jobs)</span><ExpansionIndicator /></summary>
                <div className="collapsible-content">
                  {jobs.some(hasJobValue) || draftJobIndex !== null ? (
                    <div className="job-list">
                      {jobs.map((job, index) => {
                        const jobNumber = index + 1;
                        const descriptions = Array.isArray(job.descriptions) ? job.descriptions : [];
                        const isDraftJob = index === draftJobIndex;
                        if (!hasJobValue(job) && !isDraftJob) return null;
                        const draftDescriptionIndex = draftDescriptionIndexes[index];

                        return (
                          <details className="job-entry editable-job" key={`job-${index}`} data-field={`experience.${index}`}>
                            <summary className="job-summary">
                              <div className="job-summary-main">
                                {hasValue(job.job) && <div className="job-summary-role"><span className="variable-label">[job{jobNumber}]</span> <strong>{job.job}</strong></div>}
                                {hasValue(job.company) && <div className="job-summary-company"><span className="variable-label">[comp{jobNumber}]</span> <strong>{job.company}</strong></div>}
                                {hasValue(job.date_range) && <div className="job-summary-date"><span className="variable-label">[date{jobNumber}]</span> {job.date_range}</div>}
                                {!hasJobValue(job) && <div className="job-summary-role"><span className="variable-label">[job{jobNumber}]</span> <strong>New job</strong></div>}
                              </div>
                              {descriptions.some(hasValue) && <ul className="job-summary-descriptions">
                                {descriptions.map((description, descriptionIndex) => hasValue(description) && (
                                  <li key={`summary-${index}-${descriptionIndex}`}><span className="variable-label">[desc{descriptionIndex + 1}]</span> {previewText(description)}</li>
                                ))}
                              </ul>}
                              <ExpansionIndicator />
                            </summary>
                            <div className="job-fields">
                              {(isDraftJob || hasValue(job.job)) && <EditableValue label={`[job${jobNumber}]`} field={`job${jobNumber}`} value={job.job} onChange={(value) => { updateJob(index, 'job', value); if (hasValue(value)) setDraftJobIndex(null); }} onBlurValue={(value) => { if (!hasValue(value) && !hasJobValue(job)) setDraftJobIndex(null); }} />}
                              {(isDraftJob || hasValue(job.company)) && <EditableValue label={`[comp${jobNumber}]`} field={`comp${jobNumber}`} value={job.company} onChange={(value) => { updateJob(index, 'company', value); if (hasValue(value)) setDraftJobIndex(null); }} onBlurValue={(value) => { if (!hasValue(value) && !hasJobValue(job)) setDraftJobIndex(null); }} />}
                              {(isDraftJob || hasValue(job.date_range)) && <EditableValue label={`[date${jobNumber}]`} field={`date${jobNumber}`} value={job.date_range} onChange={(value) => { updateJob(index, 'date_range', value); if (hasValue(value)) setDraftJobIndex(null); }} placeholder="mm/yy - mm/yy" onBlurValue={(value) => { if (!hasValue(value) && !hasJobValue(job)) setDraftJobIndex(null); }} />}
                              <div className="job-description-editor">
                                <span className="section-label">Descriptions</span>
                                {descriptions.map((description, descriptionIndex) => {
                                  const isDraftDescription = descriptionIndex === draftDescriptionIndex;
                                  if (!hasValue(description) && !isDraftDescription) return null;
                                  return (
                                    <div className="editable-list-row" key={`job-${index}-description-${descriptionIndex}`}>
                                      <EditableValue
                                        label={`[desc${descriptionIndex + 1}]`}
                                        field={`desc${jobNumber}-${descriptionIndex + 1}`}
                                        value={description}
                                        onChange={(value) => updateJobDescriptions(index, descriptions.map((item, itemIndex) => itemIndex === descriptionIndex ? value : item))}
                                        onBlurValue={(value) => { if (!hasValue(value)) setDraftDescriptionIndexes((current) => { const next = { ...current }; delete next[index]; return next; }); }}
                                        multiline
                                      />
                                      <button type="button" className="field-remove" onClick={() => updateJobDescriptions(index, descriptions.filter((_, itemIndex) => itemIndex !== descriptionIndex))} aria-label={`Remove description ${descriptionIndex + 1} from job ${jobNumber}`}>Remove</button>
                                    </div>
                                  );
                                })}
                                {!descriptions.some(hasValue) && draftDescriptionIndex === undefined && <p className="muted">No line items detected</p>}
                                <button type="button" className="field-add" onClick={() => { setDraftDescriptionIndexes((current) => ({ ...current, [index]: descriptions.length })); updateJob(index, 'descriptions', [...descriptions, '']); }}>Add description</button>
                              </div>
                              <button type="button" className="field-remove job-remove" onClick={() => removeJob(index)} aria-label={`Remove job ${jobNumber}`}>Remove job</button>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  ) : <p className="muted">Not detected</p>}
                  <button type="button" className="field-add" onClick={addJob}>Add job</button>
                </div>
              </details>

              <EditableSection title="Education" prefix="edu" items={education} onChange={(values) => updateExtraction('education', values)} field="education" />
              <EditableSection title="Clearances" prefix="clr" items={clearances} onChange={(values) => updateExtraction('clearances', values)} field="clearances" />
              <EditableSection title="Certifications" prefix="cert" items={certifications} onChange={(values) => updateExtraction('certifications', values)} field="certifications" />

              {hasValue(targetPositionTitle) && <details className="extract-block target-title-block collapsible-section" data-field="target_position_title">
                <summary><span>Target Position Title</span><ExpansionIndicator /></summary>
                <div className="collapsible-content">
                  <EditableValue label="[target]" field="target_position_title" value={targetPositionTitle} onChange={(value) => updateExtraction('target_position_title', value)} />
                </div>
              </details>}
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
            {data.analysis && <div className="analysis-panel" aria-label="Job analysis results">
              <p className="analysis-mode">Model: <strong>{data.analysis.mode === 'ai' ? 'AI' : 'Deterministic'}</strong> · Industry: <strong>{data.analysis.industry || 'General'}</strong></p>
              {data.analysis.skills.length > 0 && <div className="keyword-panel" aria-label="Ranked job skills">
                {data.analysis.skills.map((skill) => <span className="skill-chip" key={`${skill.name}-${skill.source}`}>{skill.name} · {Math.round(skill.score)}</span>)}
              </div>}
            </div>}
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
