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

function PreviewValue({ label, value, field, multiline = false, emphasized = false }) {
  if (!hasValue(value)) return null;
  const content = <span className={`preview-value${emphasized ? ' preview-value--emphasized' : ''}`} style={multiline ? { whiteSpace: 'pre-wrap' } : undefined}>{value}</span>;
  return (
    <div className="preview-field" data-field={field || label}>
      <span className="variable-label">{label}</span>
      {content}
    </div>
  );
}

function PreviewList({ title, prefix, items, field }) {
  const values = Array.isArray(items) ? items : [];
  const hasItems = values.some(hasValue);
  return (
    <details className="extract-block preview-list-block collapsible-section" data-field={field || prefix}>
      <summary><span>{title}</span><ExpansionIndicator /></summary>
      <div className="collapsible-content preview-list-content">
        {hasItems ? (
          <ul className="extract-list preview-list">
            {values.map((item, index) => (
              hasValue(item) && <li key={`${prefix}-${index}`}><span className="variable-label">[{prefix}{index + 1}]</span> {item}</li>
            ))}
          </ul>
        ) : <p className="muted">Not detected</p>}
      </div>
    </details>
  );
}

function PreviewLabeledList({ label, items, field, itemPrefix = '' }) {
  const values = Array.isArray(items) ? items.filter(hasValue) : [];
  if (!values.length) return null;
  return (
    <div className="preview-field preview-field-list" data-field={field || label}>
      <span className="variable-label">{label}</span>
      <ul className="extract-list">
        {values.map((item, index) => (
          <li key={`${field || label}-${index}`}>
            {itemPrefix && <span className="variable-label">[{itemPrefix}{String(index + 1).padStart(2, '0')}]</span>} {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompensationValue({ value }) {
  if (!hasValue(value)) return null;
  const clean = String(value).trim();
  const match = clean.match(/^(.*?)\s*(?:–|—|-|\bto\b)\s*(.*?)\s*((?:\/|per)\s*.+)?$/i);
  if (!match) return <PreviewValue label="[pay]" field="target.pay" value={clean} emphasized />;
  const first = match[1].trim();
  const second = match[2].trim();
  const term = (match[3] || '').trim();
  return (
    <div className="preview-field" data-field="target.pay">
      <span className="variable-label">[pay]</span>
      <span className="preview-value pay-value">
        <strong>{first}</strong><span aria-hidden="true">–</span><strong>{second}</strong>{term && <span className="pay-term">{term}</span>}
      </span>
    </div>
  );
}

function PreviewSkills({ items }) {
  const [view, setView] = useState('chips');
  const values = Array.isArray(items) ? items : [];
  const hasItems = values.some(hasValue);
  return (
    <details className="extract-block preview-list-block collapsible-section" data-field="skills">
      <summary><span>Skills</span><ExpansionIndicator /></summary>
      <div className="collapsible-content preview-list-content">
        <div className="skills-view-choice" role="group" aria-label="Skills view">
          <span className="skills-view-label">View</span>
          <button type="button" className={view === 'chips' ? 'is-selected' : ''} aria-pressed={view === 'chips'} onClick={() => setView('chips')}>Chips</button>
          <button type="button" className={view === 'list' ? 'is-selected' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
        </div>
        {!hasItems && <p className="muted">Not detected</p>}
        {hasItems && view === 'chips' && <div className="skill-list preview-skill-list">
          {values.map((item, index) => (
            hasValue(item) && <span className="skill-chip" key={`skill-${index}`}>{item}</span>
          ))}
        </div>}
        {hasItems && view === 'list' && <ul className="extract-list preview-list">
          {values.map((item, index) => (
            hasValue(item) && <li key={`skill-list-${index}`}><span className="variable-label">[skill{index + 1}]</span> {item}</li>
          ))}
        </ul>}
      </div>
    </details>
  );
}

function TargetJobPreview({ analysis }) {
  if (!analysis) return null;
  const skills = Array.isArray(analysis.skills) ? analysis.skills.filter((skill) => hasValue(skill?.name)) : [];
  const description = analysis.description || analysis.work || analysis.summary || analysis.raw_text;
  return (
    <section className="target-job-preview" aria-label="Target job extraction">
      <div className="target-job-preview__header">
        <h3>Target Job Extraction</h3>
        <span className="target-job-preview__mode">{analysis.mode === 'ai' ? 'AI' : 'Deterministic'}</span>
      </div>
      <PreviewValue label="[title]" field="target.title" value={analysis.title} emphasized />
      <PreviewValue label="[loc]" field="target.loc" value={analysis.location} />
      <PreviewValue label="[type]" field="target.type" value={analysis.type} />
      <PreviewValue label="[work]" field="target.work" value={analysis.work} />
      <PreviewValue label="[task]" field="target.task" value={analysis.task} />
      <PreviewLabeledList label="[qual]" field="target.qualifications" items={analysis.qual} itemPrefix="sMin" />
      <PreviewLabeledList label="[skMin]" field="target.skMin" items={analysis.skills_min} itemPrefix="skMin" />
      <PreviewLabeledList label="[skMax]" field="target.skMax" items={analysis.skills_max} itemPrefix="skMax" />
      <CompensationValue value={analysis.pay} />
      <PreviewValue label="[desc]" field="target.desc" value={description} multiline />
      {skills.length > 0 && <details className="target-job-skills collapsible-section" open={analysis.skills_min?.length === 0 && analysis.skills_max?.length === 0}>
        <summary><span>Ranked skills</span><ExpansionIndicator /></summary>
        <div className="collapsible-content">
          <ul className="extract-list">
            {skills.map((skill, index) => (
              <li key={`${skill.name}-${index}`}><span className="variable-label">[skill{index + 1}]</span> {skill.name}</li>
            ))}
          </ul>
        </div>
      </details>}
    </section>
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
  const [jobAnalysis, setJobAnalysis] = useState(null);

  const [preview, setPreview] = useState('');
  const [downloading, setDownloading] = useState('');
  const [access, setAccess] = useState(hosted ? 'checking' : 'ready');
  const [accessError, setAccessError] = useState('');
  const [paidMember, setPaidMember] = useState(!hosted);
  const extractionRequest = useRef(0);

  useEffect(() => {
    if (!hosted) return undefined;
    let mounted = true;
    async function check() {
      try {
        const response = await apiFetch('/access');
        const details = await response.json();
        if (mounted) {
          setAccess('ready');
          setAccessError('');
          setPaidMember(Boolean(details.paid_member));
          if (!details.paid_member) setJobModel('deterministic');
        }
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
  const targetAnalysis = jobAnalysis || data?.analysis || null;
  const statusText = access === 'checking'
    ? 'Checking access…'
    : access === 'locked'
      ? 'Access required'
      : extractError || error
        ? 'Needs attention'
        : extracting
          ? 'Extracting resume…'
          : loading
            ? 'Preparing preview…'
            : 'Ready';
  const statusProgress = access !== 'ready'
    ? access === 'checking' ? 20 : 0
    : extractError || error
      ? 0
      : extracting
        ? 58
        : loading
          ? 84
          : 100;

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
      if (validated.resume) form.append('resume', validated.resume);
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
      setJobAnalysis(responseValidation.data.analysis);
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
    <main className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <p className="eyebrow">ResumeATS</p>
          <h1>Build ATS optimized resumes</h1>
          <p className="subhead">Sign in through the J.I. Systems platform to open your resume workspace.</p>
        </div>
      </header>
      <section className="status-panel" role="status" aria-live="polite">
        <div className="status-panel__row"><strong>System status: {statusText}</strong><strong>{statusProgress}%</strong></div>
        <div className="progress-track" aria-label="ResumeATS process status">
          <div className="progress-fill" style={{ width: `${statusProgress}%` }} />
        </div>
      </section>
      <section className="access-panel panel">
        <p role="status">{access === 'checking' ? 'Checking your platform access…' : accessError}</p>
        {access === 'locked' && <a href={gatewayUrl}>Sign in or check access</a>}
      </section>
    </main>
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <p className="eyebrow">ResumeATS</p>
          <h1>Build ATS optimized resumes</h1>
          <p className="subhead">Use AI to customize your resume for the position you target.</p>
        </div>
        <div className="header-actions">
          {hosted && <a className="button button-link" href="https://jisystems.net/tools/">J.I. Systems</a>}
          {hosted && <a className="button button-link" href="https://jisystems.net/memberships/">Memberships</a>}
        </div>
      </header>

      <section className="status-panel" role="status" aria-live="polite">
        <div className="status-panel__row"><strong>System status: {statusText}</strong><strong>{statusProgress}%</strong></div>
        <div className="progress-track" aria-label="ResumeATS process status">
          <div className="progress-fill" style={{ width: `${statusProgress}%` }} />
        </div>
      </section>

      <div className="shell">
      <section className="panel left-panel">
        <div className="panel-section-heading">
          <p className="section-kicker">Resume workspace</p>
          <h2>Build a targeted resume</h2>
          <p>Upload a resume, add a job URL, then review the extracted fields and preview.</p>
        </div>

        <form onSubmit={handleSubmit} className="form">
          <label>
            Resume file (optional for job extraction)
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
            <div className="model-picker__labels"><span>Free · Deterministic</span><span>Paid · AI</span></div>
            <input
              className="model-slider"
              type="range"
              min="0"
              max="1"
              step="1"
              value={jobModel === 'ai' ? 1 : 0}
              disabled={!paidMember}
              onChange={(event) => setJobModel(event.target.value === '1' ? 'ai' : 'deterministic')}
              aria-label="Choose job URL analysis model"
            />
            <output>{jobModel === 'ai' ? 'Paid AI structured extraction' : 'Free deterministic taxonomy ranking'}</output>
            <p className="muted">{paidMember ? 'AI mode uses the configured paid provider.' : <><strong>AI extraction is for paid members.</strong> <a href="https://jisystems.net/memberships/">View memberships</a></>}</p>
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

          <button disabled={loading || extracting || (!resume && !jobUrl.trim() && !jobDescription.trim())}>{loading ? 'Preparing…' : resume ? 'Prepare resume' : 'Analyze job'}</button>
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
                  <PreviewValue label="[NameF]" field="name_first" value={contact.name_first} />
                  <PreviewValue label="[NameL]" field="name_last" value={contact.name_last} />
                  <PreviewValue label="[Suffix]" field="suffix" value={contact.suffix} />
                  <PreviewValue label="[Phone]" field="phone" value={contact.phone} />
                  {(hasValue(contact.city) || hasValue(contact.state)) && <div className="contact-location">
                    <PreviewValue label="[City]" field="city" value={contact.city} />
                    <PreviewValue label="[State]" field="state" value={contact.state} />
                  </div>}
                  <PreviewValue label="[Email]" field="email" value={contact.email} />
                  <PreviewValue label="[LinkedIn]" field="linkedin" value={contact.linkedin} />
                  <PreviewValue label="[Site]" field="site" value={contact.site} />
                  <PreviewValue label="[cred]" field="cred" value={contact.cred} multiline />
                </div>
              </details>

              {hasValue(executiveSummary) && <details className="extract-block collapsible-section" data-field="executive_summary">
                <summary><span>Executive Summary</span><ExpansionIndicator /></summary>
                <div className="collapsible-content">
                  <PreviewValue label="[summary]" field="executive_summary" value={executiveSummary} multiline />
                </div>
              </details>}

              <PreviewSkills items={skills} />

              <details className="extract-block collapsible-section" data-field="experience">
                <summary><span>Experience (Jobs)</span><ExpansionIndicator /></summary>
                <div className="collapsible-content">
                  {jobs.some(hasJobValue) ? (
                    <div className="job-list">
                      {jobs.map((job, index) => {
                        const jobNumber = index + 1;
                        const descriptions = Array.isArray(job.descriptions) ? job.descriptions : [];
                        if (!hasJobValue(job)) return null;

                        return (
                          <details className="job-entry preview-job" key={`job-${index}`} data-field={`experience.${index}`}>
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
                            <div className="job-preview-details">
                              <PreviewValue label={`[job${jobNumber}]`} field={`job${jobNumber}`} value={job.job} />
                              <PreviewValue label={`[comp${jobNumber}]`} field={`comp${jobNumber}`} value={job.company} />
                              <PreviewValue label={`[date${jobNumber}]`} field={`date${jobNumber}`} value={job.date_range} />
                              {descriptions.some(hasValue) && <ul className="extract-list preview-job-descriptions">
                                {descriptions.map((description, descriptionIndex) => hasValue(description) && (
                                  <li key={`job-${index}-description-${descriptionIndex}`}><span className="variable-label">[desc{descriptionIndex + 1}]</span> {description}</li>
                                ))}
                              </ul>}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  ) : <p className="muted">Not detected</p>}
                </div>
              </details>

              <PreviewList title="Education" prefix="edu" items={education} field="education" />
              <PreviewList title="Clearances" prefix="clr" items={clearances} field="clearances" />
              <PreviewList title="Certifications" prefix="cert" items={certifications} field="certifications" />

              {hasValue(targetPositionTitle) && <details className="extract-block target-title-block collapsible-section" data-field="target_position_title">
                <summary><span>Target Position Title</span><ExpansionIndicator /></summary>
                <div className="collapsible-content">
                  <PreviewValue label="[target]" field="target_position_title" value={targetPositionTitle} />
                </div>
              </details>}
            </div>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="panel-section-heading panel-section-heading--preview">
          <p className="section-kicker">Output workspace</p>
          <h2>Preview</h2>
        </div>
        {!data && !targetAnalysis && <p>No generated resume yet.</p>}
        {data && <p className="meta">Role: <strong>{data.job_title}</strong> · Company: <strong>{data.company}</strong></p>}
        {targetAnalysis && <TargetJobPreview analysis={targetAnalysis} />}
        {!data && targetAnalysis && <p className="muted">No resume uploaded. The target job extraction is shown above.</p>}
        {data && (
          <>
            {resume && <p className="muted">Your original facts are preserved. Add suggested keywords only when they accurately describe your experience.</p>}
            {resume && data.keywords.length > 0 && <div className="keyword-panel" aria-label="Job keyword review">
              {data.keywords.map(({ keyword, status }) => <span className="skill-chip" key={keyword}>{keyword} · {status === 'present' ? 'in resume' : 'review'}</span>)}
            </div>}
            {data.preview ? <label>Editable resume preview
              <textarea className="preview" value={preview} maxLength={100000} onChange={(e) => setPreview(e.target.value)} />
            </label> : <p className="muted">No resume uploaded. The target job extraction is shown above.</p>}
            {data.preview && <div className="downloads">
              {(outputFormat === 'all' ? ['docx', 'pdf', 'rtf'] : [outputFormat]).map((ext) => (
                <button key={ext} type="button" disabled={Boolean(downloading) || !preview.trim()} onClick={() => download(ext)}>
                  {downloading === ext ? 'Preparing…' : `Download ${ext.toUpperCase()}`}
                </button>
              ))}
            </div>}
          </>
        )}
      </section>
      </div>
    </main>
  );
}
