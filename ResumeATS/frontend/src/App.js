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

const INDICATOR_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'have', 'in', 'into',
  'is', 'of', 'on', 'or', 'the', 'to', 'with', 'work', 'working', 'years', 'year', 'ability',
  'experience', 'including', 'preferred', 'required', 'requirements', 'qualification', 'qualifications',
]);

const CREDENTIAL_TERM_RE = /\b(?:cpa|p\.?e\.?|rn|pmp|j\.?d\.?|m\.?d\.?|cissp|cism|cisa|ccna|ccnp|security\+|network\+|a\+|ocp|oca|mba|ph\.?d\.?|doctorate|bachelor|master|associate|license|licensed|certif(?:ied|ication)|clearance|public trust|ts\/?sci)\b/i;

function searchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchTerms(value) {
  return [...new Set(searchText(value).split(' ').filter((term) => (
    term && !INDICATOR_STOP_WORDS.has(term) && (term.length >= 3 || /[+#.]/.test(term))
  )))];
}

function matchesSearchText(haystack, needle) {
  const hay = searchText(haystack);
  const phrase = searchText(needle);
  if (!hay || !phrase) return false;
  if (hay.includes(phrase)) return true;
  const terms = searchTerms(needle);
  if (!terms.length) return false;
  const matched = terms.filter((term) => hay.includes(term));
  return matched.length >= Math.max(1, Math.ceil(terms.length * 0.6));
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!hasValue(value)) return false;
    const key = searchText(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resumeSearchCorpus(extraction) {
  const jobs = Array.isArray(extraction?.experience) ? extraction.experience : [];
  return [
    extraction?.name,
    extraction?.target_position_title,
    extraction?.executive_summary,
    extraction?.cred,
    ...(Array.isArray(extraction?.skills) ? extraction.skills : []),
    ...(Array.isArray(extraction?.education) ? extraction.education : []),
    ...(Array.isArray(extraction?.clearances) ? extraction.clearances : []),
    ...(Array.isArray(extraction?.certifications) ? extraction.certifications : []),
    ...jobs.flatMap((job) => [job?.job, job?.company, job?.date_range, ...(Array.isArray(job?.descriptions) ? job.descriptions : [])]),
  ].filter(hasValue).join(' ');
}

function latestResumeJob(jobs) {
  return jobs
    .map((job, index) => {
      const dates = [...String(job?.date_range || '').matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
      const dateText = String(job?.date_range || '').toLowerCase();
      const score = /\b(?:present|current|now)\b/.test(dateText)
        ? 999999 - index
        : ((dates[dates.length - 1] || 0) * 100) - index;
      return { job, score };
    })
    .filter(({ job }) => hasJobValue(job))
    .sort((left, right) => right.score - left.score)[0]?.job || null;
}

function seniorityLevel(title) {
  const value = searchText(title);
  if (!value) return null;
  if (/\b(?:chief|c suite|vp|vice president|director|head)\b/.test(value)) return 5;
  if (/\b(?:principal|manager|supervisor)\b/.test(value)) return 4;
  if (/\b(?:senior|sr|lead)\b/.test(value)) return 3;
  if (/\b(?:associate)\b/.test(value)) return 1;
  if (/\b(?:junior|jr|entry|intern|trainee)\b/.test(value)) return 0;
  return 2;
}

function indicatorTone(score, pendingStatus = 'Awaiting job') {
  if (score === null) return { tone: 'pending', status: pendingStatus };
  if (score >= 80) return { tone: 'good', status: 'Strong' };
  if (score >= 50) return { tone: 'review', status: 'Review' };
  return { tone: 'needs', status: 'Needs review' };
}

const INDICATOR_WEIGHTS = {
  'Parsing compatibility': 30,
  'Hard requirements': 20,
  'Keyword matching': 20,
  'Context + recency': 15,
  'Title/seniority alignment': 10,
  Credentials: 5,
};

function calculateAtsGrade(indicators) {
  const scored = indicators.filter((indicator) => indicator.score !== null);
  const totalWeight = scored.reduce((sum, indicator) => sum + (INDICATOR_WEIGHTS[indicator.label] || 0), 0);
  const weightedScore = scored.reduce((sum, indicator) => (
    sum + (indicator.score * (INDICATOR_WEIGHTS[indicator.label] || 0))
  ), 0);
  return {
    score: totalWeight ? Math.round(weightedScore / totalWeight) : 0,
    scoredCount: scored.length,
    pendingCount: indicators.length - scored.length,
  };
}

function buildResumeIndicators(extraction, targetAnalysis, fileName) {
  const jobs = Array.isArray(extraction?.experience) ? extraction.experience : [];
  const skills = Array.isArray(extraction?.skills) ? extraction.skills : [];
  const education = Array.isArray(extraction?.education) ? extraction.education : [];
  const certifications = Array.isArray(extraction?.certifications) ? extraction.certifications : [];
  const clearances = Array.isArray(extraction?.clearances) ? extraction.clearances : [];
  const corpus = resumeSearchCorpus(extraction);
  const latestJob = latestResumeJob(jobs);
  const latestJobCorpus = latestJob
    ? [latestJob.job, latestJob.company, latestJob.date_range, ...(latestJob.descriptions || [])].filter(hasValue).join(' ')
    : '';
  const targetSkills = uniqueValues((Array.isArray(targetAnalysis?.skills) ? targetAnalysis.skills : []).map((skill) => skill?.name));

  const parsingFields = [
    ['name', extraction?.name || [extraction?.name_first, extraction?.name_last].filter(hasValue).join(' ')],
    ['title', extraction?.target_position_title || latestJob?.job],
    ['employer', jobs.some((job) => hasValue(job?.company))],
    ['dates', jobs.some((job) => hasValue(job?.date_range))],
    ['skills', skills.length > 0],
    ['education', education.length > 0],
    ['credentials', hasValue(extraction?.cred) || certifications.length > 0 || clearances.length > 0],
  ];
  const parsedCount = parsingFields.filter(([, value]) => hasValue(value)).length;
  const missingFields = parsingFields.filter(([, value]) => !hasValue(value)).map(([label]) => label);
  const parsingScore = Math.round((parsedCount / parsingFields.length) * 100);
  const parsingSubitems = parsingFields.map(([label, value]) => ({
    text: `${label}: ${hasValue(value) ? 'detected' : 'not detected'}`,
    tone: hasValue(value) ? 'good' : 'needs',
  }));

  const indicators = [{
    label: 'Parsing compatibility',
    score: parsingScore,
    detail: `${parsedCount}/${parsingFields.length} core fields detected${missingFields.length ? ` · Review ${missingFields.join(', ')}` : ''}. Text extraction cannot verify graphics or visual-only content in columns, headers, or footers${fileName ? ` · ${fileName}` : ''}.`,
    subitems: parsingSubitems,
  }];

  if (!targetAnalysis) {
    indicators.push({
      label: 'Hard requirements',
      score: null,
      detail: 'Analyze a target job to compare degree, certification or license, location, work authorization, and years of experience.',
      subitems: [
        { text: 'Degree or education requirement: awaiting job', tone: 'pending' },
        { text: 'Certification or license: awaiting job', tone: 'pending' },
        { text: 'Location, authorization, and years: awaiting job', tone: 'pending' },
      ],
    });
  } else {
    const requirements = uniqueValues([
      ...(Array.isArray(targetAnalysis.qual) ? targetAnalysis.qual : []),
      ...(Array.isArray(targetAnalysis.skills_min) ? targetAnalysis.skills_min : []),
    ]);
    if (!requirements.length) {
      indicators.push({
        label: 'Hard requirements',
        score: null,
        pendingStatus: 'Unavailable',
        detail: 'No explicit minimum requirements were extracted from the target job; verify the posting manually.',
        subitems: [{ text: 'No minimum requirement lines available from the target job', tone: 'pending' }],
      });
    } else {
      const matched = requirements.filter((requirement) => matchesSearchText(corpus, requirement));
      const missing = requirements.filter((requirement) => !matchesSearchText(corpus, requirement));
      indicators.push({
        label: 'Hard requirements',
        score: Math.round((matched.length / requirements.length) * 100),
        detail: `${matched.length}/${requirements.length} extracted minimum requirements have resume evidence${missing.length ? ` · Review ${missing.slice(0, 2).map(previewText).join('; ')}` : ''}. Location, work authorization, and years still need confirmation.`,
        subitems: [
          ...matched.slice(0, 6).map((requirement) => ({ text: `Matched: ${previewText(requirement)}`, tone: 'good' })),
          ...missing.slice(0, 6).map((requirement) => ({ text: `Review: ${previewText(requirement)}`, tone: 'needs' })),
        ],
      });
    }
  }

  if (!targetAnalysis || !targetSkills.length) {
    indicators.push({
      label: 'Keyword matching',
      score: null,
      pendingStatus: targetAnalysis ? 'Unavailable' : 'Awaiting job',
      detail: targetAnalysis ? 'No structured ATS keywords were extracted from the target job.' : 'Analyze a target job to compare exact and related ATS keywords with this resume.',
      subitems: [{ text: targetAnalysis ? 'No structured keywords available' : 'Target job analysis required', tone: 'pending' }],
    });
    indicators.push({
      label: 'Context + recency',
      score: null,
      pendingStatus: targetAnalysis ? 'Unavailable' : 'Awaiting job',
      detail: 'Analyze a target job to check whether keywords appear in recent experience with supporting results.',
      subitems: [{ text: 'Requires target keywords and dated job experience', tone: 'pending' }],
    });
  } else {
    const matched = targetSkills.filter((skill) => matchesSearchText(corpus, skill));
    const contextual = targetSkills.filter((skill) => jobs.some((job) => matchesSearchText(
      [job?.job, job?.company, ...(job?.descriptions || [])].filter(hasValue).join(' '),
      skill,
    )));
    const recent = latestJob && targetSkills.filter((skill) => matchesSearchText(latestJobCorpus, skill));
    indicators.push({
      label: 'Keyword matching',
      score: Math.round((matched.length / targetSkills.length) * 100),
      detail: `${matched.length}/${targetSkills.length} target keywords found in imported resume fields.`,
      subitems: [
        ...matched.slice(0, 8).map((skill) => ({ text: `Matched: ${skill}`, tone: 'good' })),
        ...targetSkills.filter((skill) => !matched.includes(skill)).slice(0, 8).map((skill) => ({ text: `Review: ${skill}`, tone: 'needs' })),
      ],
    });
    const contextualCount = contextual.length;
    const recentCount = recent ? recent.length : 0;
    indicators.push({
      label: 'Context + recency',
      score: Math.round(((contextualCount / targetSkills.length) * 70) + ((recentCount / targetSkills.length) * 30)),
      detail: `${contextualCount}/${targetSkills.length} keywords appear in job experience; ${recentCount}/${targetSkills.length} appear in the most recent dated role.`,
      subitems: [
        { text: `Experience context: ${contextualCount}/${targetSkills.length} keywords`, tone: contextualCount ? 'good' : 'needs' },
        { text: `Most recent dated role: ${recentCount}/${targetSkills.length} keywords`, tone: recentCount ? 'good' : 'needs' },
      ],
    });
  }

  if (!targetAnalysis?.title) {
    indicators.push({
      label: 'Title/seniority alignment',
      score: null,
      pendingStatus: targetAnalysis ? 'Unavailable' : 'Awaiting job',
      detail: 'Analyze a target job to compare its title and seniority with the most recent resume role.',
      subitems: [{ text: targetAnalysis ? 'Target title not available' : 'Target job analysis required', tone: 'pending' }],
    });
  } else {
    const resumeTitle = latestJob?.job || extraction?.target_position_title || '';
    if (!resumeTitle) {
      indicators.push({
        label: 'Title/seniority alignment',
        score: 0,
        detail: `Target title: ${targetAnalysis.title} · No resume title was detected.`,
        subitems: [{ text: 'Resume title: not detected', tone: 'needs' }],
      });
    } else {
      const targetTerms = searchTerms(targetAnalysis.title);
      const resumeTerms = new Set(searchTerms(resumeTitle));
      const overlap = targetTerms.filter((term) => resumeTerms.has(term)).length;
      const lexicalScore = targetTerms.length ? overlap / targetTerms.length : 0;
      const targetLevel = seniorityLevel(targetAnalysis.title);
      const resumeLevel = seniorityLevel(resumeTitle);
      const seniorityScore = targetLevel !== null && resumeLevel !== null && Math.abs(targetLevel - resumeLevel) <= 1 ? 1 : 0;
      const score = Math.round((lexicalScore * 70) + (seniorityScore * 30));
      indicators.push({
        label: 'Title/seniority alignment',
        score,
        detail: `Target: ${targetAnalysis.title} · Resume: ${resumeTitle}${targetLevel !== null && resumeLevel !== null && Math.abs(targetLevel - resumeLevel) > 1 ? ' · Seniority levels differ; review.' : '.'}`,
        subitems: [
          { text: `Target title: ${targetAnalysis.title}`, tone: 'pending' },
          { text: `Resume title: ${resumeTitle}`, tone: lexicalScore >= 0.5 ? 'good' : 'needs' },
          { text: `Seniority: ${targetLevel !== null && resumeLevel !== null && Math.abs(targetLevel - resumeLevel) <= 1 ? 'aligned' : 'review'}`, tone: targetLevel !== null && resumeLevel !== null && Math.abs(targetLevel - resumeLevel) <= 1 ? 'good' : 'needs' },
        ],
      });
    }
  }

  const credentialEntries = uniqueValues([
    extraction?.cred,
    ...certifications,
    ...clearances,
  ]);
  const credentialCorpus = [...credentialEntries, ...education].join(' ');
  const requiredCredentials = targetAnalysis
    ? uniqueValues([
      ...(Array.isArray(targetAnalysis.qual) ? targetAnalysis.qual : []),
      ...(Array.isArray(targetAnalysis.skills_min) ? targetAnalysis.skills_min : []),
    ]).filter((item) => CREDENTIAL_TERM_RE.test(item))
    : [];
  if (requiredCredentials.length) {
    const matched = requiredCredentials.filter((requirement) => matchesSearchText(credentialCorpus, requirement));
    indicators.push({
      label: 'Credentials',
      score: Math.round((matched.length / requiredCredentials.length) * 100),
      detail: `${matched.length}/${requiredCredentials.length} credential or degree requirements have matching resume evidence${credentialEntries.length ? ` · Detected: ${credentialEntries.slice(0, 3).join(', ')}` : ''}.`,
      subitems: [
        ...matched.slice(0, 6).map((requirement) => ({ text: `Matched: ${previewText(requirement)}`, tone: 'good' })),
        ...requiredCredentials.filter((requirement) => !matched.includes(requirement)).slice(0, 6).map((requirement) => ({ text: `Review: ${previewText(requirement)}`, tone: 'needs' })),
      ],
    });
  } else if (credentialEntries.length) {
    indicators.push({
      label: 'Credentials',
      score: 100,
      detail: `Detected ${credentialEntries.length} credential, certification, license, or clearance entr${credentialEntries.length === 1 ? 'y' : 'ies'}: ${credentialEntries.slice(0, 3).join(', ')}.`,
      subitems: credentialEntries.slice(0, 8).map((entry) => ({ text: `Detected: ${entry}`, tone: 'good' })),
    });
  } else {
    indicators.push({
      label: 'Credentials',
      score: 0,
      detail: 'No credential, certification, license, or clearance entry was detected.',
      subitems: [{ text: 'No credential evidence detected', tone: 'needs' }],
    });
  }

  return indicators.map((indicator) => ({ ...indicator, ...indicatorTone(indicator.score, indicator.pendingStatus) }));
}

function ResumeAtsIndicators({ extraction, targetAnalysis, fileName }) {
  const indicators = buildResumeIndicators(extraction, targetAnalysis, fileName);
  const grade = calculateAtsGrade(indicators);
  const gradeTone = indicatorTone(grade.score);
  return (
    <details className="resume-indicators collapsible-section" aria-label="ATS readiness checklist" open>
      <summary><span>ATS readiness checklist</span><ExpansionIndicator /></summary>
      <div className="resume-indicators__content">
        <p className="muted">Screening signals from the imported resume. Job comparisons appear after a target job is analyzed.</p>
        <div className={`resume-grade resume-grade--${gradeTone.tone}`}>
          <div className="resume-grade__heading">
            <span>ATS compatibility / compliance</span>
            <strong>{grade.score}%</strong>
          </div>
          <div className="resume-grade__meter" role="progressbar" aria-label="ATS compatibility and compliance grade" aria-valuemin="0" aria-valuemax="100" aria-valuenow={grade.score}>
            <span style={{ width: `${grade.score}%` }} />
          </div>
          <p>{grade.scoredCount}/{indicators.length} checks scored{grade.pendingCount ? ` · ${grade.pendingCount} awaiting target-job data` : ''}.</p>
        </div>
        <div className="resume-indicators__grid">
          {indicators.map((indicator) => (
            <article className={`resume-indicator resume-indicator--${indicator.tone}`} key={indicator.label}>
              <div className="resume-indicator__heading">
                <span className="resume-indicator__icon" aria-hidden="true">{indicator.tone === 'good' ? '✓' : indicator.tone === 'pending' ? '·' : '!'}</span>
                <h4>{indicator.label}</h4>
                <span className="resume-indicator__status">{indicator.score !== null ? `${indicator.score}% · ` : ''}{indicator.status}</span>
              </div>
              <p>{indicator.detail}</p>
              {indicator.subitems?.length > 0 && <ul className="resume-indicator__subitems">
                {indicator.subitems.map((item, index) => {
                  const subitem = typeof item === 'string' ? { text: item, tone: 'review' } : item;
                  return <li key={`${indicator.label}-subitem-${index}`} className={`resume-indicator__subitem resume-indicator__subitem--${subitem.tone}`}>
                    <span aria-hidden="true">{subitem.tone === 'good' ? '✓' : subitem.tone === 'pending' ? '·' : '!'}</span>
                    {subitem.text}
                  </li>;
                })}
              </ul>}
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}

function needsBrowserCapture(analysis) {
  if (!analysis || analysis.mode !== 'deterministic') return false;
  const fields = [analysis.title, analysis.location, analysis.type, analysis.work, analysis.task, analysis.pay]
    .filter(hasValue).length;
  const skillCount = (Array.isArray(analysis.skills) ? analysis.skills : [])
    .filter((skill) => hasValue(skill?.name)).length;
  return fields < 3 || skillCount < 2;
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

function PreviewSkills({ items, title = 'Skills', field = 'skills', itemPrefix = 'skill' }) {
  const [view, setView] = useState('chips');
  const values = Array.isArray(items) ? items : [];
  const hasItems = values.some(hasValue);
  return (
    <details className="extract-block preview-list-block collapsible-section" data-field={field}>
      <summary><span>{title}</span><ExpansionIndicator /></summary>
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
            hasValue(item) && <li key={`${itemPrefix}-list-${index}`}><span className="variable-label">[{itemPrefix}{index + 1}]</span> {item}</li>
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
      {needsBrowserCapture(analysis) && (
        <p className="browser-capture-hint" role="status">
          Deterministic extraction was incomplete. On the job page, choose the ResumeATS Capture extension; it will send the visible listing to Paste Job Description and analyze it automatically.
        </p>
      )}
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
  const [captureNotice, setCaptureNotice] = useState('');

  const [preview, setPreview] = useState('');
  const [downloading, setDownloading] = useState('');
  const [access, setAccess] = useState(hosted ? 'checking' : 'ready');
  const [accessError, setAccessError] = useState('');
  const [paidMember, setPaidMember] = useState(!hosted);
  const extractionRequest = useRef(0);
  const receivedCaptureIds = useRef(new Set());
  const captureAttempt = useRef({ url: '', status: '' });

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
  const atsKeywords = Array.isArray(targetAnalysis?.skills)
    ? targetAnalysis.skills.map((skill) => skill?.name).filter(hasValue)
    : [];
  const fallbackKeywords = Array.isArray(data?.keywords)
    ? data.keywords.map((item) => item?.keyword).filter(hasValue)
    : [];
  const atsKeywordItems = atsKeywords.length ? atsKeywords : fallbackKeywords;
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
  const browserCaptureNeeded = /No readable job description|Paste it instead/i.test(error);

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

  async function generateJob({ jobUrlValue = jobUrl, jobDescriptionValue = jobDescription, captureSourceUrl = '' } = {}) {
    const validation = generationFormSchema.safeParse({
      resume,
      jobUrl: jobUrlValue,
      jobDescription: jobDescriptionValue,
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
    setCaptureNotice(captureSourceUrl ? 'Browser page captured. Analyzing the pasted job description…' : '');
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
      if (captureSourceUrl) {
        rememberJobUrl(captureSourceUrl);
        setJobUrl(captureSourceUrl);
        setCaptureNotice('Browser capture analyzed through Paste Job Description.');
      }
    } catch (err) {
      setError(`Generation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await generateJob();
  }

  async function handleCapturedJob(payload) {
    const text = String(payload?.text || '').trim();
    if (!text || loading) return;
    setJobDescription(text);
    setJobUrl(String(payload?.sourceUrl || '').trim());
    setCaptureNotice('Browser page captured. Analyzing the pasted job description…');
    await generateJob({ jobUrlValue: '', jobDescriptionValue: text, captureSourceUrl: payload?.sourceUrl || '' });
  }

  useEffect(() => {
    const sourceUrl = jobUrl.trim();
    if (!browserCaptureNeeded || !sourceUrl || loading || captureAttempt.current.url === sourceUrl) return undefined;

    captureAttempt.current = { url: sourceUrl, status: 'pending' };
    setCaptureNotice('Browser fallback activated. Copying the visible job page…');
    window.postMessage({
      type: 'resumeats:job-capture:start',
      payload: { sourceUrl },
    }, window.location.origin);

    const timeout = window.setTimeout(() => {
      if (captureAttempt.current.url === sourceUrl && captureAttempt.current.status === 'pending') {
        setCaptureNotice('Install or reload the ResumeATS Capture extension, then retry this job URL.');
      }
    }, 2500);
    return () => window.clearTimeout(timeout);
  }, [browserCaptureNeeded, jobUrl, loading]);

  useEffect(() => {
    function receiveCapture(event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type === 'resumeats:job-capture:status') {
        const status = event.data.payload || {};
        captureAttempt.current.status = status.ok ? 'captured' : 'failed';
        setCaptureNotice(status.ok ? 'Job page copied. Submitting Analyze Job…' : (status.error || 'Browser capture could not read that page.'));
        return;
      }
      if (event.data?.type !== 'resumeats:job-capture') return;
      const payload = event.data.payload || {};
      const captureId = String(payload.id || `${payload.sourceUrl || ''}:${payload.capturedAt || ''}`);
      if (!hasValue(payload.text) || loading || receivedCaptureIds.current.has(captureId)) return;
      receivedCaptureIds.current.add(captureId);
      captureAttempt.current.status = 'received';
      void handleCapturedJob(payload);
    }

    window.addEventListener('message', receiveCapture);
    if (access === 'ready' && !loading) {
      window.postMessage({ type: 'resumeats:job-capture:request' }, window.location.origin);
    }
    return () => window.removeEventListener('message', receiveCapture);
  }, [access, resume, outputFormat, jobModel, loading]);

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
          {browserCaptureNeeded && jobUrl.trim() && !jobDescription.trim() && (
            <section className="browser-capture-panel" aria-label="Browser capture fallback">
              <strong>Browser fallback activated.</strong>
              <p>ResumeATS is asking the Capture extension to copy the visible job page, paste it into Paste Job Description, and submit Analyze Job automatically.</p>
              <p className="muted">Install the unpacked extension from <code>ResumeATS/browser-extension</code> first.</p>
            </section>
          )}
          {captureNotice && <p className="capture-notice" role="status">{captureNotice}</p>}
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
              <ResumeAtsIndicators extraction={extraction} targetAnalysis={targetAnalysis} fileName={resume?.name} />

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
        {atsKeywordItems.length > 0 && <PreviewSkills
          title="ATS Keywords"
          field="ats-keywords"
          itemPrefix="keyword"
          items={atsKeywordItems}
        />}
      </section>
      </div>
    </main>
  );
}
