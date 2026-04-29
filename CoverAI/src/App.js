import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  fieldArrayToValueMap,
  normalizeAiFieldSuggestions,
  requestAiDraftLetter,
  requestAiExtractJob,
  requestControlRestart,
  requestControlStatus,
  requestControlStop,
} from "./ai";

// This key is the "name tag" used when saving data in the browser.
const STORAGE_KEY = "coverLetterStudio.v1";
// Separate storage for the "File > Recent" list.
const RECENT_SESSIONS_KEY = "coverLetterStudio.recent.v1";
const RECENT_SESSIONS_LIMIT = 5;
// Stores user company frequency counts for the Company Name dropdown.
const COMPANY_USAGE_KEY = "coverLetterStudio.companyUsage.v1";
const COMPANY_DROPDOWN_LIMIT = 25;
// Shared picker id so browser reuses one "CoverAI home" folder across open/save/import/export.
const COVERAI_PICKER_ID = "coverai-home";
// Saved style library (4 locked presets + 1 editable user slot).
const STYLE_LIBRARY_KEY = "coverLetterStudio.styleLibrary.v1";
const BROWSER_SESSION_PREF_KEY = "coverLetterStudio.useCurrentBrowserSession.v1";
// This pattern finds tokens like {{company_name}} inside the template text.
const TOKEN_REGEX = /{{\s*([a-z0-9_]+)\s*}}/gi;

// User-provided starter company list. We seed suggestions from this on first use.
const DEFAULT_COMPANY_SEED = [
  "SAIC",
  "Northrop Grumman",
  "Oracle",
  "Tesla",
  "General Dynamics",
  "Robert Half",
  "IBM",
  "Booz Allen",
  "Deloitte & Touche",
  "US Government",
  "Amazon",
  "Google",
  "Walmart",
  "Accenture",
  "Allied Universal",
  "FedEx",
  "United Parcel Service",
  "Home Depot",
  "Starbucks",
  "United Health",
  "Kroger Co",
  "Marriott Interntional",
  "Berkshire Hathaway",
  "CostCo",
  "JPMorgan Chase",
  "CVS Health",
  "Apple",
  "Microsoft",
  "Keller Williams",
];

// Starter position-title list for the Position Title dropdown.
const DEFAULT_POSITION_SEED = [
  "Software Engineer",
  "Web Developer",
  "Database Administrator",
  "Administrative Asst.",
  "Customer Service",
  "Consultant",
  "Accountant",
  "Graphic Designer",
  "Analyst",
  "Maintenance",
  "Manager",
  "Sales Rep.",
  "Marketing",
  "CEO",
  "Financial Officer",
  "Military",
  "Secretary",
  "Care Giver",
  "Writer",
  "Musician",
  "Clergy",
  "Banker",
  "Police",
  "Fire Fighter",
  "Nurse",
  "Doctor",
  "Lawyer",
  "Cook",
  "Driver",
  "Entrepreneur",
  "Self Employed",
];

// Starter skill list used by Pos Skill 1-3 dropdowns.
const DEFAULT_POSITION_SKILL_SEED = [
  "Database",
  "Programming",
  "JavaScript",
  "Python",
  "React",
  "C++",
  "Oracle",
  "MS SQL Server",
  "Accounting",
  "Management",
  "Marketing",
  "Customer Service",
  "Sales",
  "Educator",
  "Trainer",
  "Fitness",
  "Electrical Engineer",
  "Mechanical Engineer",
  "Medical",
];

// We keep a single shared promise so PDF.js is loaded only once.
let pdfJsPromise;

// Dynamically load PDF.js only when needed (smaller startup bundle).
async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist/webpack").then((module) => {
      const lib = module.default || module;
      // Point PDF.js to its worker file so PDF parsing works in the browser.
      lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version}/pdf.worker.min.js`;
      return lib;
    });
  }
  return pdfJsPromise;
}

// Starter placeholders shown on first load and after reset.
const DEFAULT_FIELDS = [
  { id: "f1", key: "hiring_manager", label: "", value: "" },
  { id: "f2", key: "company_name", label: "", value: "" },
  { id: "f3", key: "position_title", label: "", value: "" },
  { id: "f4", key: "pos_skill_1", label: "", value: "" },
  { id: "f5", key: "pos_skill_2", label: "", value: "" },
  { id: "f6", key: "pos_skill_3", label: "", value: "" },
  { id: "f7", key: "job_url", label: "", value: "" },
  { id: "f8", key: "job_listing_ref_title", label: "", value: "" },
  { id: "f9", key: "job_listing_ref_url", label: "", value: "" },
  { id: "f10", key: "prev_company", label: "", value: "" },
  { id: "f11", key: "my_skill_1", label: "", value: "" },
  { id: "f12", key: "my_skill_2", label: "", value: "" },
  { id: "f13", key: "my_skill_3", label: "", value: "" },
  { id: "f14", key: "additional_exp_1", label: "", value: "" },
  { id: "f15", key: "additional_exp_2", label: "", value: "" },
  { id: "f16", key: "my_signature", label: "", value: "" },
  { id: "f17", key: "ref", label: "", value: "" },
];
const DEFAULT_FIELD_KEY_SET = new Set(DEFAULT_FIELDS.map((field) => field.key));

// Starter letter template that includes tokens wrapped in {{ }}.
const DEFAULT_TEMPLATE = `Dear {{hiring_manager}},

I am excited to apply for the {{position_title}} role at {{company_name}}.

I reviewed the role requirements, including {{pos_skill_1}}, {{pos_skill_2}}, and {{pos_skill_3}}.
Relevant examples from my background include work at {{prev_company}}, plus strengths in {{my_skill_1}}, {{my_skill_2}}, and {{my_skill_3}}.
Additional experience: {{additional_exp_1}} and {{additional_exp_2}}.

Job posting: {{job_url}}
Referred By: {{ref}}

Sincerely,
{{my_signature}}`;

// Preset style templates loaded by the style selector.
const STYLE_TEMPLATE_MAP = {
  eng: `Dear {{hiring_manager}},

I am excited to apply for the {{position_title}} role at {{company_name}}.

My background aligns with your needs in {{pos_skill_1}}, {{pos_skill_2}}, and {{pos_skill_3}}.
I have applied these strengths in hands-on delivery at {{prev_company}}, with additional impact in {{additional_exp_1}} and {{additional_exp_2}}.

Job posting: {{job_url}}
Referred By: {{ref}}

Sincerely,
{{my_signature}}`,
  cus: `Dear {{hiring_manager}},

I am applying for the {{position_title}} opportunity with {{company_name}}.

My customer-facing experience includes {{pos_skill_1}}, {{pos_skill_2}}, and {{pos_skill_3}}.
At {{prev_company}}, I focused on service quality and communication outcomes, including {{additional_exp_1}} and {{additional_exp_2}}.

Job posting: {{job_url}}
Referred By: {{ref}}

Sincerely,
{{my_signature}}`,
  fin: `Dear {{hiring_manager}},

Please accept my application for the {{position_title}} position at {{company_name}}.

My qualifications include {{pos_skill_1}}, {{pos_skill_2}}, and {{pos_skill_3}} with practical results at {{prev_company}}.
I also bring experience in {{additional_exp_1}} and {{additional_exp_2}}.

Job posting: {{job_url}}
Referred By: {{ref}}

Sincerely,
{{my_signature}}`,
  mgr: `Dear {{hiring_manager}},

I am writing to express interest in the {{position_title}} role at {{company_name}}.

My management background includes {{pos_skill_1}}, {{pos_skill_2}}, and {{pos_skill_3}}.
I have led outcomes at {{prev_company}}, including {{additional_exp_1}} and {{additional_exp_2}}.

Job posting: {{job_url}}
Referred By: {{ref}}

Sincerely,
{{my_signature}}`,
  custom_1: DEFAULT_TEMPLATE,
  custom_2: DEFAULT_TEMPLATE,
};

const STYLE_SLOT_META = {
  eng: { label: "Engineer", locked: true },
  cus: { label: "Service", locked: true },
  fin: { label: "Financial", locked: true },
  mgr: { label: "Management", locked: true },
  custom_1: { label: "User Defined", locked: false },
};

const FIELD_SUGGESTIONS = {
  hiring_manager: "e.g., Jordan Lee",
  company_name: "e.g., OpenAI",
  position_title: "e.g., Product Operations Manager",
  pos_skill_1: "e.g., Stakeholder communication",
  pos_skill_2: "e.g., Project planning",
  pos_skill_3: "e.g., Data analysis",
  job_url: "e.g., https://company.com/careers/job-123",
  job_listing_ref_title: "e.g., Senior Product Operations Manager",
  job_listing_ref_url: "e.g., https://company.com/careers/job-123",
  ref: "e.g., Kelli Quinn (Smyrna, GA) (LinkedIn)",
  prev_company: "e.g., Google",
  my_skill_1: "e.g., Cross-functional leadership",
  my_skill_2: "e.g., Process improvement",
  my_skill_3: "e.g., SQL reporting",
  additional_exp_1: "e.g., Led onboarding redesign across 4 teams",
  additional_exp_2: "e.g., Built KPI dashboard used by executives",
  my_signature: "e.g., Jane Doe | jane@email.com",
};

const FIELD_LABEL_SUGGESTIONS = {
  hiring_manager: "Hiring Manager",
  company_name: "Company Name",
  position_title: "Position Title",
  pos_skill_1: "Pos Skill 1",
  pos_skill_2: "Pos Skill 2",
  pos_skill_3: "Pos Skill 3",
  job_url: "Job URL",
  job_listing_ref_title: "Ref Title",
  job_listing_ref_url: "Ref URL",
  ref: "Referred By",
  prev_company: "Prev Company",
  my_skill_1: "My Skill 1",
  my_skill_2: "My Skill 2",
  my_skill_3: "My Skill 3",
  additional_exp_1: "Additional Exp 1",
  additional_exp_2: "Additional Exp 2",
  my_signature: "My Signature",
};

const AI_REVIEW_FIELD_ORDER = [
  "company_name",
  "position_title",
  "job_listing_ref_title",
  "job_url",
  "job_listing_ref_url",
  "pos_skill_1",
  "pos_skill_2",
  "pos_skill_3",
  "my_skill_1",
  "my_skill_2",
  "my_skill_3",
  "additional_exp_1",
  "additional_exp_2",
];
const HISTORY_LIMIT = 80;

function buildChipElement(fieldKey, labelByKey) {
  const chip = document.createElement("span");
  chip.className = "editor-chip";
  chip.setAttribute("contenteditable", "false");
  chip.dataset.tokenKey = fieldKey;
  const rawLabel = labelByKey[fieldKey] || fieldKey;
  // Show compact URL label in the template chip, while field data keeps full URL.
  chip.textContent =
    ["job_url", "job_listing_ref_url"].includes(fieldKey) && isHttpUrl(rawLabel) ? toLinkLabel(rawLabel) : rawLabel;
  return chip;
}

function normalizeEditorTemplate(rootNode) {
  const chunks = [];

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      chunks.push(node.textContent || "");
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node;

    if (element.classList?.contains("editor-chip") && element.dataset.tokenKey) {
      chunks.push(`{{${element.dataset.tokenKey}}}`);
      return;
    }

    if (element.tagName === "BR") {
      chunks.push("\n");
      return;
    }

    Array.from(element.childNodes).forEach(walk);

    if (element.tagName === "DIV" || element.tagName === "P") {
      chunks.push("\n");
    }
  };

  Array.from(rootNode.childNodes).forEach(walk);
  return chunks.join("").replace(/\n{3,}/g, "\n\n");
}

function renderEditorNodes(templateText, labelByKey) {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let match = TOKEN_REGEX.exec(templateText);

  while (match) {
    const tokenStart = match.index;
    const tokenEnd = match.index + match[0].length;
    const tokenKey = match[1].toLowerCase();

    if (tokenStart > cursor) {
      fragment.appendChild(document.createTextNode(templateText.slice(cursor, tokenStart)));
    }
    fragment.appendChild(buildChipElement(tokenKey, labelByKey));
    cursor = tokenEnd;
    match = TOKEN_REGEX.exec(templateText);
  }
  TOKEN_REGEX.lastIndex = 0;

  if (cursor < templateText.length) {
    fragment.appendChild(document.createTextNode(templateText.slice(cursor)));
  }

  return fragment;
}

// Ensure saved/imported projects always include the current default field set.
function mergeFieldsWithDefaults(inputFields) {
  const incoming = Array.isArray(inputFields) ? inputFields : [];
  const byKey = new Map(incoming.map((field) => [field.key, field]));
  return DEFAULT_FIELDS.map((defaultField) => {
    const matched = byKey.get(defaultField.key);
    if (!matched) return { ...defaultField };
    return {
      ...defaultField,
      ...matched,
      id: matched.id || defaultField.id,
    };
  });
}

function extractTokenKey(rawToken) {
  const match = rawToken?.match(/{{\s*([a-z0-9_]+)\s*}}/i);
  return match ? match[1].toLowerCase() : "";
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function titleFromUrlPath(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const segment = parsed.pathname.split("/").filter(Boolean).pop();
    if (!segment) return parsed.hostname.replace(/^www\./, "");
    return segment
      .replace(/[-_]+/g, " ")
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "Job Listing";
  }
}

function withTimeout(ms, task) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    task()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isNumericOnlyTitle(value) {
  return /^\d+$/.test((value || "").replace(/\s+/g, ""));
}

// Job-board models in priority order requested by user.
const JOB_SITE_MODELS = [
  {
    name: "LinkedIn",
    domains: ["linkedin.com"],
    titlePatterns: [
      /href="https:\/\/www\.linkedin\.com\/jobs\/view\/[^"]+"[^>]*>([^<]+)</i,
      /<title>\s*([^<]+?)\s*\|\s*LinkedIn/i,
      /^Title:\s*(.+)$/im,
    ],
  },
  {
    name: "Indeed",
    domains: ["indeed.com"],
    titlePatterns: [/<title>\s*([^<]+?)\s*-\s*Indeed/i, /^Title:\s*(.+)$/im],
  },
  {
    name: "Glassdoor",
    domains: ["glassdoor.com"],
    titlePatterns: [/<title>\s*([^<]+?)\s*\|\s*Glassdoor/i, /^Title:\s*(.+)$/im],
  },
  {
    name: "ZipRecruiter",
    domains: ["ziprecruiter.com"],
    titlePatterns: [/<title>\s*([^<]+?)\s*-\s*ZipRecruiter/i, /^Title:\s*(.+)$/im],
  },
  {
    name: "Monster",
    domains: ["monster.com"],
    titlePatterns: [/<title>\s*([^<]+?)\s*-\s*Monster/i, /^Title:\s*(.+)$/im],
  },
  {
    name: "Dice",
    domains: ["dice.com"],
    titlePatterns: [/<title>\s*([^<]+?)\s*-\s*Dice/i, /^Title:\s*(.+)$/im],
  },
  {
    name: "AngelList Talent",
    domains: ["wellfound.com", "angel.co"],
    titlePatterns: [/<title>\s*([^<]+?)\s*-\s*(Wellfound|AngelList)/i, /^Title:\s*(.+)$/im],
  },
  {
    name: "USAJOBS",
    domains: ["usajobs.gov"],
    titlePatterns: [/<title>\s*([^<]+?)\s*-\s*USAJOBS/i, /^Title:\s*(.+)$/im],
  },
  {
    name: "FlexJobs",
    domains: ["flexjobs.com"],
    titlePatterns: [/<title>\s*([^<]+?)\s*-\s*FlexJobs/i, /^Title:\s*(.+)$/im],
  },
  {
    name: "SimplyHired",
    domains: ["simplyhired.com"],
    titlePatterns: [/<title>\s*([^<]+?)\s*-\s*SimplyHired/i, /^Title:\s*(.+)$/im],
  },
];

const JOB_BOARD_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
  "dice.com",
  "wellfound.com",
  "angel.co",
  "usajobs.gov",
  "flexjobs.com",
  "simplyhired.com",
];

function getJobSiteModel(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return JOB_SITE_MODELS.find((model) => model.domains.some((domain) => host.includes(domain))) || null;
  } catch {
    return null;
  }
}

function normalizeTitleCandidate(rawTitle) {
  if (!rawTitle) return "";
  const text = rawTitle
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function extractTitleTag(content) {
  if (!content) return "";
  const match = content.match(/<title>\s*([^<]+)\s*<\/title>/i);
  if (match?.[1]) return normalizeTitleCandidate(match[1]);
  // r.jina.ai mirror pages often expose the title as plain text: "Title: ...".
  const textTitle = content.match(/^Title:\s*(.+)$/im)?.[1];
  return normalizeTitleCandidate(textTitle || "");
}

// Simple title parser for URL commit:
// 1) before first "|" => job title
// 2) after first "|" and before second "|" => company
function extractTitleAndCompanyFromTitleTag(content) {
  const titleTag = extractTitleTag(content);
  if (!titleTag) return { title: "", company: "", refTitle: "" };

  const parts = titleTag.split("|").map((part) => normalizeTitleCandidate(part));
  const title = parts[0] || "";
  const company = parts[1] || "";
  return { title, company, refTitle: titleTag };
}

// For unknown job sites, take the first segment from <title> as the job title.
// This keeps title extraction simple and predictable when we do not have a site profile.
function extractGenericJobTitleFromTitleTag(content) {
  const rawTitle = extractTitleTag(content);
  if (!rawTitle) return "";
  return rawTitle
    .split("|")[0]
    .split(" - ")[0]
    .split(" – ")[0]
    .trim();
}

// LinkedIn titles sometimes append extra details after a slash.
// Keep only the title portion before the first slash.
function truncateLinkedInJobTitle(rawTitle) {
  const title = normalizeTitleCandidate(rawTitle);
  if (!title) return "";
  const slashIndex = title.search(/\s*\/\s*/);
  if (slashIndex < 0) return title;
  return title.slice(0, slashIndex).trim();
}

function cleanPositionTitle(rawTitle, companyHint = "") {
  const title = normalizeTitleCandidate(rawTitle)
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return "";

  let cleaned = title;
  const company = normalizeTitleCandidate(companyHint).trim();
  const escapedCompany = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  cleaned = cleaned
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+[|/-]\s+(linkedin|indeed|glassdoor|ziprecruiter|monster|dice|wellfound|angelist|usajobs|flexjobs|simplyhired).*$/i, "")
    .replace(/\s+\bat\s+[^|/-]+$/i, "")
    .replace(/\s+\bwith\s+[^|/-]+$/i, "")
    .replace(/\s+\bfor\s+[^|/-]+$/i, "");

  if (escapedCompany) {
    cleaned = cleaned
      .replace(new RegExp(`\\s+[|/-]\\s+${escapedCompany}\\b.*$`, "i"), "")
      .replace(new RegExp(`\\s+at\\s+${escapedCompany}\\b.*$`, "i"), "")
      .replace(new RegExp(`\\s+for\\s+${escapedCompany}\\b.*$`, "i"), "");
  }

  const roleKeywordPattern =
    /\b(administrator|engineer|developer|manager|analyst|architect|specialist|consultant|director|designer|coordinator|technician|officer|writer|editor|trainer|planner|lead|dba)\b/i;
  const companyLikePattern =
    /\b(llc|inc|corp|corporation|technologies|technology|systems|industries|industry|group|services|service|company|solutions|holdings|partners|international)\b/i;
  const dashParts = cleaned.split(/\s[-–]\s/).map((part) => part.trim()).filter(Boolean);
  if (dashParts.length >= 2) {
    const first = dashParts[0];
    const rest = dashParts.slice(1).join(" - ");
    if ((companyLikePattern.test(first) || /^[A-Z][A-Za-z0-9&.\- ]+$/.test(first)) && roleKeywordPattern.test(rest)) {
      cleaned = rest;
    }
  }

  cleaned = cleaned
    .split("|")[0]
    .trim()
    .replace(/\s+/g, " ");

  if (!roleKeywordPattern.test(cleaned)) {
    cleaned = cleaned
      .split(" - ")
      .slice(-1)[0]
      .split(" – ")
      .slice(-1)[0]
      .trim()
      .replace(/\s+/g, " ");
  } else {
    cleaned = cleaned
      .split(" - ")[0]
      .split(" – ")[0]
      .trim()
      .replace(/\s+/g, " ");
  }

  cleaned = cleaned
    .trim()
    .replace(/\s+/g, " ");

  cleaned = cleaned
    .replace(/^(principal|senior|sr|lead|staff|junior|jr|associate|mid-level|mid level|expert)\s+/i, "")
    .replace(/\b(contract|temporary|temp|remote|hybrid|onsite|on-site)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const roleMappings = [
    { regex: /\b(dba|database administrator)\b/i, value: "Database Administrator" },
    { regex: /\bsoftware engineer\b/i, value: "Software Engineer" },
    { regex: /\bweb developer\b/i, value: "Web Developer" },
    { regex: /\bproject manager\b/i, value: "Project Manager" },
  ];
  for (const entry of roleMappings) {
    if (entry.regex.test(cleaned)) return entry.value;
  }

  return cleaned;
}

function extractCompanyFromTitleTag(content, rawUrl) {
  const titleTag = extractTitleTag(content);
  if (!titleTag) return "";

  // Job boards commonly format <title> as:
  // "Job Title | Company Name | Board Name"
  // So we first try the exact segment right after the first pipe.
  const rawParts = titleTag
    .split("|")
    .map((part) => normalizeTitleCandidate(part))
    .filter(Boolean);
  if (rawParts.length < 2) return "";
  const parts = rawParts.map((p) => cleanCompanyName(p)).filter(Boolean);

  const siteModel = getJobSiteModel(rawUrl);
  const siteName = siteModel?.name?.toLowerCase() || "";

  const candidate = parts[1] || "";
  if (candidate && !candidate.toLowerCase().includes(siteName) && isValidCompanyCandidate(candidate)) {
    return candidate;
  }

  // Fallback: pick first valid segment that is not the board name.
  for (const part of parts) {
    if (!part) continue;
    if (siteName && part.toLowerCase().includes(siteName)) continue;
    if (isValidCompanyCandidate(part)) return part;
  }

  return "";
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function collectJsonObjectsFromText(content) {
  const objects = [];
  if (!content) return objects;

  // JSON-LD blocks.
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch = jsonLdRegex.exec(content);
  while (jsonLdMatch) {
    const parsed = safeJsonParse(jsonLdMatch[1].trim());
    if (parsed) objects.push(parsed);
    jsonLdMatch = jsonLdRegex.exec(content);
  }

  return objects;
}

function findValuesDeep(node, key) {
  const results = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      if (k === key && typeof v === "string") results.push(v);
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(node);
  return results;
}

function extractLinkedInJsonData(content) {
  const jsonObjects = collectJsonObjectsFromText(content);
  const titleCandidates = [];
  const companyCandidates = [];

  for (const obj of jsonObjects) {
    titleCandidates.push(...findValuesDeep(obj, "title"));
    titleCandidates.push(...findValuesDeep(obj, "jobTitle"));
    companyCandidates.push(...findValuesDeep(obj, "companyName"));
    companyCandidates.push(...findValuesDeep(obj, "name"));

    const hiringOrgValues = findValuesDeep(obj, "hiringOrganization");
    companyCandidates.push(...hiringOrgValues);
  }

  const bestTitle = titleCandidates.map(normalizeTitleCandidate).find(Boolean) || "";
  const bestCompany = bestCompanyCandidate(companyCandidates.map(cleanCompanyName).filter(Boolean));

  return { title: bestTitle, company: bestCompany };
}

function companyFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (JOB_BOARD_DOMAINS.some((domain) => host.includes(domain))) return "";
    const hostParts = parsed.hostname.replace(/^www\./, "").split(".");
    if (hostParts.length < 2) return "";
    const root = hostParts[hostParts.length - 2] || "";
    return root.toUpperCase();
  } catch {
    return "";
  }
}

function cleanCompanyName(raw) {
  const fluffTailPattern =
    /\s*,?\s*(incorporated|inc|corporation|corp|company|co|llc|l\.l\.c|ltd|limited|plc|gmbh|s\.a\.|s\.a|ag|technologies|technology|systems|industries|industry|group|services|service|solutions|holdings|partners|international)\.?$/i;
  const cleaned = (raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    // Convert markdown links: [Name](https://...) -> Name
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
    // Remove raw URLs and broken markdown tails.
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\]\([^)]+/g, " ")
    .replace(/[[\]()]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Some scraped pages space letters like "T r i n i t y".
  // Merge consecutive single-letter tokens into normal words.
  const collapseSingleLetterRuns = (value) => {
    const tokens = value.split(/\s+/).filter(Boolean);
    const output = [];
    let run = [];

    const flushRun = () => {
      if (run.length === 0) return;
      output.push(run.join(""));
      run = [];
    };

    for (const token of tokens) {
      if (token.length === 1 && /[a-z]/i.test(token)) {
        run.push(token);
        continue;
      }
      flushRun();
      output.push(token);
    }
    flushRun();

    return output.join(" ").trim();
  };

  const deSpaced = collapseSingleLetterRuns(cleaned);
  // If collapse created glued CamelCase words (ex: "RobertHalf"),
  // split them back to normal spacing.
  const deSpacedWithWordBoundaries = deSpaced.replace(/([a-z])([A-Z])/g, "$1 $2");

  // Remove common legal/business suffixes at the end only.
  let normalized = deSpacedWithWordBoundaries;
  while (fluffTailPattern.test(normalized)) {
    normalized = normalized.replace(fluffTailPattern, "").trim();
  }

  const words = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index, source) => {
      if (source.length <= 1) return true;
      const lowered = word.toLowerCase();
      return !["corp", "llc", "inc", "technologies", "technology", "systems", "industries", "industry", "group", "services", "service", "company", "solutions", "holdings", "partners", "international"].includes(lowered);
    });

  const capped = words.slice(0, Math.min(words.length, 2));
  return toTitleCasePhrase(capped.join(" "));
}

function getFieldButtonLabel(field) {
  const rawLabel = field.label || FIELD_LABEL_SUGGESTIONS[field.key] || field.key;
  if (["job_url", "job_listing_ref_url"].includes(field.key) && isHttpUrl(rawLabel)) {
    return toLinkLabel(rawLabel);
  }
  return rawLabel;
}

function isValidCompanyCandidate(value) {
  const candidate = cleanCompanyName(value);
  if (!candidate) return false;
  if (/https?:\/\//i.test(candidate)) return false;
  if (/\]\(|\[|\]/.test(candidate)) return false;
  if (candidate.length < 2) return false;
  const words = candidate.split(/\s+/).filter(Boolean);
  const singleLetterWords = words.filter((w) => w.length === 1).length;
  if (singleLetterWords >= 3) return false;
  return true;
}

function companyFromLinkedInSlug(rawUrl) {
  const match = (rawUrl || "").match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (!match?.[1]) return "";
  const slug = decodeURIComponent(match[1]);
  const withSpaces = slug
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return cleanCompanyName(withSpaces);
}

function companyCandidateScore(rawValue) {
  const value = cleanCompanyName(rawValue);
  if (!isValidCompanyCandidate(value)) return -1000;

  const words = value.split(/\s+/).filter(Boolean);
  const singleLetterWords = words.filter((w) => w.length === 1).length;
  const longWords = words.filter((w) => w.length >= 3).length;
  const alphaChars = (value.match(/[a-z]/gi) || []).length;
  const badArtifacts = /https?:\/\/|\]\(|\{|\}/i.test(value) ? 1 : 0;

  // Heuristic: prefer normal human-readable names, penalize spaced-letter noise.
  let score = 0;
  score += Math.min(alphaChars, 40);
  score += longWords * 8;
  score -= singleLetterWords * 10;
  score -= badArtifacts * 50;
  if (words.length >= 2 && words.length <= 4) score += 20;
  return score;
}

function bestCompanyCandidate(candidates) {
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = cleanCompanyName(candidate || "");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }
  if (unique.length === 0) return "";
  unique.sort((a, b) => companyCandidateScore(b) - companyCandidateScore(a));
  return unique[0];
}

function extractCompanyFromContent(content, rawUrl, titleHint = "") {
  if (!content) return "";
  const siteModel = getJobSiteModel(rawUrl);
  const titleTagCompany = extractCompanyFromTitleTag(content, rawUrl);
  if (titleTagCompany) return titleTagCompany;

  // LinkedIn-specific first pass.
  if (siteModel?.name === "LinkedIn") {
    // Fast path first: company link/name blocks and company slug.
    const slugCandidates = Array.from(
      content.matchAll(/href="https:\/\/www\.linkedin\.com\/company\/([^"?#/]+)[^"]*"/gi)
    )
      .map((m) => companyFromLinkedInSlug(`https://www.linkedin.com/company/${m[1]}/`))
      .filter((value) => isValidCompanyCandidate(value));

    const linkedInMatches = [
      content.match(/Company,\s*([^.<\n]+)\./i)?.[1],
      content.match(/href="https:\/\/www\.linkedin\.com\/company\/[^"]+"[^>]*>\s*([^<]+)\s*<\/a>/i)?.[1],
      content.match(/job-details-jobs-unified-top-card__company-name[\s\S]*?<a[^>]*>\s*([^<]+)\s*<\/a>/i)?.[1],
      content.match(/company-name[^>]*>\s*<a[^>]*>\s*([^<]+)\s*</i)?.[1],
      content.match(/\bat\s+([A-Z][A-Za-z0-9&.\- ]{2,60})\b/)?.[1],
    ]
      .map((value) => cleanCompanyName(value || ""))
      .filter((value) => isValidCompanyCandidate(value));
    const topLinkedIn = bestCompanyCandidate([...slugCandidates, ...linkedInMatches]);
    if (topLinkedIn) return topLinkedIn;

    // JSON-LD fallback only if fast HTML patterns missed.
    const linkedInJson = extractLinkedInJsonData(content);
    if (linkedInJson.company) return linkedInJson.company;
  }

  // Generic JSON-LD/metadata style matches.
  const genericMatches = [
    content.match(/"hiringOrganization"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i)?.[1],
    content.match(/"name"\s*:\s*"([^"]+)"\s*,\s*"@type"\s*:\s*"Organization"/i)?.[1],
    content.match(/Company[^:\n]*:\s*([^\n<|]+)/i)?.[1],
  ]
    .map((value) => cleanCompanyName(value || ""))
    .filter((value) => isValidCompanyCandidate(value));
  const topGeneric = bestCompanyCandidate(genericMatches);
  if (topGeneric) return topGeneric;

  // Pull from title patterns like "... at Company" as last content-based step.
  const titleSource = titleHint || content.match(/^Title:\s*(.+)$/im)?.[1] || "";
  const atMatch = titleSource.match(/\bat\s+([A-Z][A-Za-z0-9&.\- ]{2,60})$/i)?.[1];
  const byMatch = titleSource.match(/\b-\s*([A-Z][A-Za-z0-9&.\- ]{2,60})\s*$/i)?.[1];
  const titleDerived = cleanCompanyName(atMatch || byMatch || "");
  if (titleDerived) return titleDerived;

  return "";
}

function cleanSkillLine(line) {
  return line
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize text before writing into a field card.
// This keeps spacing consistent even when scraped pages contain odd whitespace.
function normalizeFieldValue(raw) {
  return (raw || "")
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCasePhrase(value) {
  const hardAcronyms = new Set(["OOP", "SQL", "JELC", "IT", "AI", "C2"]);
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (hardAcronyms.has(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function washSkillToShortPhrase(rawSkill) {
  const cleaned = cleanSkillLine(rawSkill)
    .replace(/[()]/g, " ")
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const mapped = [
    { regex: /\bobject[- ]oriented programming\b/i, phrase: "OOP" },
    { regex: /\bdata structures?\b/i, phrase: "Data Structures" },
    { regex: /\balgorithms?\b/i, phrase: "Algorithms" },
    { regex: /\bproject management\b/i, phrase: "Project Management" },
    { regex: /\bprogram management\b/i, phrase: "Program Management" },
    { regex: /\boperations planning\b/i, phrase: "Operations Planning" },
    { regex: /\bexercise planning\b/i, phrase: "Exercise Planning" },
    { regex: /\bjoint exercise life cycle\b|\bjelc\b/i, phrase: "JELC" },
    { regex: /\bstakeholder management\b/i, phrase: "Stakeholder Management" },
    { regex: /\bcommunication\b/i, phrase: "Team Communication" },
    { regex: /\bcoordination\b/i, phrase: "Team Coordination" },
    { regex: /\banalysis\b/i, phrase: "Data Analysis" },
    { regex: /\brisk management\b/i, phrase: "Risk Management" },
    { regex: /\bcybersecurity\b|\binformation security\b/i, phrase: "Cybersecurity" },
    { regex: /\bsoftware development\b/i, phrase: "Software Development" },
  ];
  for (const entry of mapped) {
    if (entry.regex.test(cleaned)) return entry.phrase;
  }

  // Fallback: strip filler words and keep 2-3 meaningful words.
  const filler = new Set([
    "strong",
    "knowledge",
    "experience",
    "ability",
    "understanding",
    "including",
    "required",
    "requirements",
    "qualification",
    "qualifications",
    "skills",
    "skill",
    "with",
    "of",
    "in",
    "and",
    "the",
    "to",
    "for",
  ]);

  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9/-]/gi, ""))
    .filter(Boolean)
    .filter((w) => !filler.has(w.toLowerCase()));

  if (words.length === 0) return toTitleCasePhrase(cleaned.split(/\s+/).slice(0, 3).join(" "));
  const kept = words.slice(0, Math.min(3, Math.max(2, words.length)));
  return toTitleCasePhrase(kept.join(" "));
}

function extractTopSkillsFromText(rawText) {
  if (!rawText) return [];
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const skills = [];
  const seen = new Set();
  const sectionHeaderPattern =
    /(requirements?|required skills?|required experience|qualifications?|desired skills?|you(?:'|’)ll have|you will have)/i;
  const stopSectionPattern =
    /^(overview|about us|job description|responsibilities|benefits|security clearance|education|travel|equal opportunity)/i;
  const bulletPattern = /^[-*•\d.)\s]/;
  const addSkill = (line) => {
    const cleaned = cleanSkillLine(line);
    if (cleaned.length < 16 || cleaned.length > 180) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    skills.push(cleaned);
  };

  // Primary pass: from section headers, take the first 2 bullet/list entries.
  for (let i = 0; i < lines.length; i += 1) {
    if (!sectionHeaderPattern.test(lines[i])) continue;
    let bulletsCollected = 0;

    for (let j = i + 1; j < Math.min(lines.length, i + 35); j += 1) {
      const current = lines[j];
      if (stopSectionPattern.test(current)) break;

      if (bulletPattern.test(current)) {
        addSkill(current);
        bulletsCollected += 1;
        if (skills.length >= 3) return skills.slice(0, 3);
        if (bulletsCollected >= 2) break;
      }
    }
  }

  // Secondary pass: broader scan under the same preferred sections.
  for (let i = 0; i < lines.length; i += 1) {
    if (!sectionHeaderPattern.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j += 1) {
      const current = lines[j];
      if (stopSectionPattern.test(current)) break;
      if (bulletPattern.test(current)) addSkill(current);
      if (skills.length >= 3) return skills.slice(0, 3);
    }
  }

  // Fallback: keyword-based extraction from full text.
  const skillKeywords =
    /(experience|knowledge|ability|proficien|planning|management|coordination|analysis|communication|exercise|jelc|operations)/i;
  for (const line of lines) {
    if (!skillKeywords.test(line)) continue;
    addSkill(line);
    if (skills.length >= 3) break;
  }

  return skills.slice(0, 3);
}

async function fetchJobInsightsFromUrl(rawUrl) {
  const siteModel = getJobSiteModel(rawUrl);
  // Use one shared mirror fetch so we do not double-hit the same endpoint.
  const mirrorTextPromise = withTimeout(12000, async () => {
    const mirror = await fetch(`https://r.jina.ai/${rawUrl}`);
    if (!mirror.ok) throw new Error("mirror not ok");
    return mirror.text();
  });

  // Run title/company lookup and mirror lookup at the same time.
  // allSettled keeps every rejection consumed so there are no uncaught promises.
  const [titleCompanyResult, mirrorResult] = await Promise.allSettled([
    Promise.any([
      withTimeout(12000, async () => {
        const direct = await fetch(rawUrl, { mode: "cors" });
        if (!direct.ok) throw new Error("direct not ok");
        const html = await direct.text();
        const parsed = extractTitleAndCompanyFromTitleTag(html);
        if (!parsed.title && !parsed.company) throw new Error("no title tag values");
        return parsed;
      }),
      mirrorTextPromise.then((content) => {
        const parsed = extractTitleAndCompanyFromTitleTag(content);
        if (!parsed.title && !parsed.company) throw new Error("no title tag values");
        return parsed;
      }),
    ]),
    mirrorTextPromise,
  ]);

  const fallbackTitle = titleFromUrlPath(rawUrl);
  const fallbackSafeTitle = isNumericOnlyTitle(fallbackTitle) ? "" : fallbackTitle;
  let title =
    titleCompanyResult.status === "fulfilled" ? titleCompanyResult.value.title || fallbackSafeTitle : fallbackSafeTitle;
  let refTitle =
    titleCompanyResult.status === "fulfilled" ? titleCompanyResult.value.refTitle || title : title;
  let company = titleCompanyResult.status === "fulfilled" ? titleCompanyResult.value.company || "" : "";
  let skills = [];

  try {
    if (mirrorResult.status !== "fulfilled") throw new Error("mirror unavailable");
    const content = mirrorResult.value;
    // Rule requested: on non-profiled, non-LinkedIn sites, prioritize <title> first for job title.
    if (!siteModel || siteModel.name !== "LinkedIn") {
      const genericTitle = extractGenericJobTitleFromTitleTag(content);
      if (genericTitle && !isNumericOnlyTitle(genericTitle)) {
        refTitle = refTitle || extractTitleTag(content);
        if (!title || isNumericOnlyTitle(title)) {
          title = genericTitle;
        }
      }
    }
    if (!refTitle) {
      refTitle = extractTitleTag(content);
    }
    skills = extractTopSkillsFromText(content);
    if (!company) {
      company = extractCompanyFromContent(content, rawUrl, title);
    }
  } catch {
    // Mirror can be slow or blocked; keep best-effort behavior.
  }

  if (!company) {
    company = companyFromUrl(rawUrl);
  }

  return { title, refTitle, company, skills };
}

function inferSkillsFromTitle(title) {
  const t = (title || "").toLowerCase();
  if (!t) return [];

  if (/(security|cyber|infosec|isso)/.test(t)) {
    return ["Cybersecurity", "Risk Management", "Compliance"];
  }
  if (/(training|exercise|planner|planning)/.test(t)) {
    return ["Exercise Planning", "Operations Coordination", "Communication"];
  }
  if (/(software|developer|engineer|programmer)/.test(t)) {
    return ["Software Development", "Data Structures", "Algorithms"];
  }
  if (/(manager|management|lead)/.test(t)) {
    return ["Leadership", "Project Management", "Stakeholder Management"];
  }

  return ["Domain Knowledge", "Project Management", "Communication"];
}

function getRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

// Turn human text into a safe token key (ex: "Top Skill" -> "top_skill").
function slugify(input) {
  const normalized = input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_");
  return normalized.replace(/^_+|_+$/g, "") || "field";
}

// Download plain text by creating a temporary browser link.
function downloadTextFile(text, name) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Save JSON with a real file dialog when available.
// We use one picker id so browser can remember a single CoverAI folder location.
// Caller should pass a base name without extension; this helper enforces .json.
async function saveJsonWithDialog(text, suggestedBaseName) {
  const suggestedJsonName = suggestedBaseName.toLowerCase().endsWith(".json")
    ? suggestedBaseName
    : `${suggestedBaseName}.json`;
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        id: COVERAI_PICKER_ID,
        startIn: "documents",
        suggestedName: suggestedJsonName,
        types: [
          {
            description: "JSON Files",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      const savedName = handle.name || suggestedJsonName;
      return savedName.toLowerCase().endsWith(".json") ? savedName : `${savedName}.json`;
    }
  } catch (error) {
    if (error?.name === "AbortError") return "";
  }

  const response = window.prompt("File name (no extension needed):", suggestedBaseName);
  if (response === null) return "";
  const trimmed = response.trim();
  const fileName = trimmed ? (trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`) : `${suggestedBaseName}.json`;
  downloadTextFile(text, fileName);
  return fileName;
}

// Template = current token layout with empty data values.
function toTemplateFields(fields) {
  return fields.map((field) => {
    const isDefaultField = DEFAULT_FIELD_KEY_SET.has(field.key);
    return {
      ...field,
      // Template contains placeholders only, so values are cleared.
      value: "",
      // Default fields reset to canonical names; custom fields keep their token names.
      label: isDefaultField ? FIELD_LABEL_SUGGESTIONS[field.key] || field.label : field.label,
    };
  });
}

function formatDateYYMMDD(dateObj = new Date()) {
  const yy = String(dateObj.getFullYear()).slice(-2);
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function sanitizeStyleCode(rawCode, fallback = "gen") {
  const normalized = (rawCode || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "");
  return normalized || fallback;
}

function getTemplateSequenceStorageKey(datePart, styleCode) {
  return `coverai.templateSeq.${datePart}.${styleCode}`;
}

function peekNextTemplateSequence(datePart, styleCode) {
  const key = getTemplateSequenceStorageKey(datePart, styleCode);
  const raw = Number.parseInt(localStorage.getItem(key) || "0", 10);
  const last = Number.isNaN(raw) ? 0 : raw;
  return last + 1;
}

function commitTemplateSequence(datePart, styleCode, seq) {
  const key = getTemplateSequenceStorageKey(datePart, styleCode);
  localStorage.setItem(key, String(seq));
}

// Keep a safe snapshot shape so recent sessions can be loaded reliably.
function normalizeSessionSnapshot(rawSnapshot) {
  if (!rawSnapshot || typeof rawSnapshot !== "object") return null;
  if (typeof rawSnapshot.template !== "string" || !Array.isArray(rawSnapshot.fields)) return null;
  return {
    template: rawSnapshot.template,
    fields: mergeFieldsWithDefaults(rawSnapshot.fields),
    selectedStyle:
      typeof rawSnapshot.selectedStyle === "string"
        ? rawSnapshot.selectedStyle
        : typeof rawSnapshot.style === "string"
        ? rawSnapshot.style
        : "eng",
    customStyle1Code: typeof rawSnapshot.customStyle1Code === "string" ? rawSnapshot.customStyle1Code : "cus1",
    customStyle2Code: typeof rawSnapshot.customStyle2Code === "string" ? rawSnapshot.customStyle2Code : "cus2",
  };
}

function buildDefaultStyleSnapshot(styleKey) {
  return normalizeSessionSnapshot({
    template: STYLE_TEMPLATE_MAP[styleKey] || DEFAULT_TEMPLATE,
    fields: toTemplateFields(DEFAULT_FIELDS),
    selectedStyle: styleKey,
    customStyle1Code: "cus1",
    customStyle2Code: "cus2",
  });
}

function normalizeStyleLibrary(rawLibrary) {
  const normalized = {};
  const keys = Object.keys(STYLE_SLOT_META);
  for (const styleKey of keys) {
    const meta = STYLE_SLOT_META[styleKey];
    const rawEntry = rawLibrary?.[styleKey];
    const rawSnapshot = rawEntry?.snapshot || rawEntry;
    const snapshot = normalizeSessionSnapshot(rawSnapshot);
    if (snapshot) {
      normalized[styleKey] = {
        ...meta,
        name: typeof rawEntry?.name === "string" && rawEntry.name.trim() ? rawEntry.name.trim() : meta.label,
        updatedAt:
          typeof rawEntry?.updatedAt === "string" && !Number.isNaN(Date.parse(rawEntry.updatedAt))
            ? rawEntry.updatedAt
            : new Date().toISOString(),
        snapshot,
      };
      continue;
    }
    // Locked presets always exist; user-defined style starts empty.
    if (meta.locked) {
      normalized[styleKey] = {
        ...meta,
        name: meta.label,
        updatedAt: new Date().toISOString(),
        snapshot: buildDefaultStyleSnapshot(styleKey),
      };
    } else {
      normalized[styleKey] = { ...meta, name: meta.label, updatedAt: "", snapshot: null };
    }
  }
  return normalized;
}

function normalizeRecentSessions(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const snapshot = normalizeSessionSnapshot(entry.snapshot);
      if (!snapshot) return null;
      return {
        id: typeof entry.id === "string" ? entry.id : `recent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : "Session",
        savedAt:
          typeof entry.savedAt === "string" && !Number.isNaN(Date.parse(entry.savedAt))
            ? entry.savedAt
            : new Date().toISOString(),
        snapshot,
      };
    })
    .filter(Boolean)
    .slice(0, RECENT_SESSIONS_LIMIT);
}

function normalizeCompanyName(raw) {
  return (raw || "").replace(/\s+/g, " ").trim();
}

function normalizeCompanyUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object") return {};
  const normalized = {};
  for (const [rawName, rawCount] of Object.entries(rawUsage)) {
    const name = normalizeCompanyName(rawName);
    const count = Number(rawCount);
    if (!name || !Number.isFinite(count) || count <= 0) continue;
    normalized[name] = Math.floor(count);
  }
  return normalized;
}

// Basic word counter used for quick stats in the UI.
function toWordCount(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

// Replace each token in the template with the matching field value.
// If a value is missing, keep a visible placeholder like [company_name].
function renderTemplate(template, valueByKey) {
  const unresolved = new Set();
  const rendered = template.replace(TOKEN_REGEX, (_, tokenKey) => {
    const key = tokenKey.toLowerCase();
    const value = valueByKey[key];
    if (!value) {
      unresolved.add(key);
      return `[${key}]`;
    }
    return value;
  });
  TOKEN_REGEX.lastIndex = 0;
  return { rendered, unresolved: [...unresolved] };
}

// Escape HTML so user-provided text is safe to inject into preview markup.
function escapeHtml(value) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Build a short readable label for links:
// www.domain.tld + " ... /" + last path segment.
function toLinkLabel(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const domainMatch = host.match(/(?:^|\.)([^.]+\.(com|org|gov))$/i);
    const domain = (domainMatch?.[1] || host).trim();

    const lastPathSegment =
      parsed.pathname
        .split("/")
        .filter(Boolean)
        .pop() || "";

    if (!lastPathSegment) return `www.${domain}`;
    return `www.${domain} ... /${decodeURIComponent(lastPathSegment)}`;
  } catch {
    return rawUrl;
  }
}

// Build preview HTML with clickable links for URLs while preserving line breaks.
function toPreviewHtml(text) {
  const source = text || "";
  const markdownLinks = new Map();
  let markdownIndex = 0;
  const tokenized = source.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_, label, url) => {
    const token = `__MD_LINK_${markdownIndex}__`;
    markdownLinks.set(token, { label, url });
    markdownIndex += 1;
    return token;
  });

  const urlPattern = /https?:\/\/[^\s]+/gi;
  const linkifySegment = (segment) => {
    urlPattern.lastIndex = 0;
    let html = "";
    let lastIndex = 0;
    let match = urlPattern.exec(segment);

    while (match) {
      const url = match[0];
      const start = match.index;
      const end = start + url.length;

      html += escapeHtml(segment.slice(lastIndex, start)).replace(/\n/g, "<br />");
      const label = toLinkLabel(url);
      html += `<a class="preview-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
        label
      )}</a>`;

      lastIndex = end;
      match = urlPattern.exec(segment);
    }

    html += escapeHtml(segment.slice(lastIndex)).replace(/\n/g, "<br />");
    return html;
  };

  const tokenPattern = /(__MD_LINK_\d+__)/g;
  const tokenParts = tokenized.split(tokenPattern);
  const html = tokenParts
    .map((part) => {
      if (!markdownLinks.has(part)) return linkifySegment(part);
      const markdownLink = markdownLinks.get(part);
      return `<a class="preview-link" href="${escapeHtml(markdownLink.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
        markdownLink.label
      )}</a>`;
    })
    .join("");
  return html;
}

// Pull text out of every page in a PDF and combine into one string.
async function readPdfAsText(file) {
  const pdfjsLib = await getPdfJs();
  const buffer = await file.arrayBuffer();
  const pdfData = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const pageTexts = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((item) => item.str).join(" ").trim();
    if (line) pageTexts.push(line);
  }

  return pageTexts.join("\n\n");
}

function getFieldTextByKey(fields, fieldKey) {
  const field = (fields || []).find((entry) => entry.key === fieldKey);
  if (!field) return "";
  return (field.value || field.label || "").trim();
}

function mergeSuggestionEntries(fieldSuggestions, fieldOrder = AI_REVIEW_FIELD_ORDER) {
  const normalized = normalizeAiFieldSuggestions(fieldSuggestions);
  const orderedKeys = [
    ...fieldOrder.filter((key) => normalized[key]),
    ...Object.keys(normalized).filter((key) => !fieldOrder.includes(key)),
  ];
  return orderedKeys.map((key) => ({
    key,
    label: FIELD_LABEL_SUGGESTIONS[key] || key,
    value: normalized[key],
  }));
}

function normalizeManagedFieldValues(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const company = cleanCompanyName(getFieldTextByKey(list, "company_name"));
  const currentTitle = getFieldTextByKey(list, "position_title");
  const referenceTitle = getFieldTextByKey(list, "job_listing_ref_title");

  const currentLooksWrong =
    !currentTitle ||
    currentTitle.toLowerCase() === company.toLowerCase() ||
    /\b(llc|inc|corp|corporation|technologies|systems|industries|group|services|company|solutions|holdings|partners)\b/i.test(
      currentTitle
    );

  const normalizedTitle =
    (currentLooksWrong ? cleanPositionTitle(referenceTitle, company) : "") || cleanPositionTitle(currentTitle, company);

  let changed = false;
  const next = list.map((field) => {
    if (field.key === "company_name") {
      const nextValue = company;
      if ((field.label || "") === nextValue && (field.value || "") === nextValue) return field;
      changed = true;
      return { ...field, label: nextValue, value: nextValue };
    }
    if (field.key === "position_title") {
      const nextValue = normalizedTitle;
      if (!nextValue) return field;
      if ((field.label || "") === nextValue && (field.value || "") === nextValue) return field;
      changed = true;
      return { ...field, label: nextValue, value: nextValue };
    }
    return field;
  });

  return changed ? next : list;
}

function buildWashedJobPayload(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawCompany = source.company_name || "";
  const rawRefTitle = source.job_listing_ref_title || "";
  const rawPositionTitle = source.position_title || rawRefTitle || "";
  const rawSkills = Array.isArray(source.skills) ? source.skills : [];

  const company = cleanCompanyName(rawCompany);
  const jobListingRefTitle = normalizeFieldValue(rawRefTitle);
  const positionTitle = cleanPositionTitle(rawPositionTitle, company);
  const skills = rawSkills
    .map((skill) => washSkillToShortPhrase(skill))
    .filter(Boolean)
    .filter((skill, index, arr) => arr.findIndex((item) => item.toLowerCase() === skill.toLowerCase()) === index)
    .slice(0, 3);

  const fieldSuggestions = {
    ...(source.fieldSuggestions && typeof source.fieldSuggestions === "object" ? source.fieldSuggestions : {}),
    ...(company ? { company_name: company } : {}),
    ...(positionTitle ? { position_title: positionTitle } : {}),
    ...(jobListingRefTitle ? { job_listing_ref_title: jobListingRefTitle } : {}),
    ...(source.job_url ? { job_url: source.job_url } : {}),
    ...(source.job_listing_ref_url ? { job_listing_ref_url: source.job_listing_ref_url } : {}),
    ...(skills[0] ? { pos_skill_1: skills[0] } : {}),
    ...(skills[1] ? { pos_skill_2: skills[1] } : {}),
    ...(skills[2] ? { pos_skill_3: skills[2] } : {}),
  };

  return {
    ...source,
    company_name: company,
    position_title: positionTitle,
    job_listing_ref_title: jobListingRefTitle,
    skills,
    fieldSuggestions,
  };
}

function buildEditorSnapshot({ template, fields, selectedStyle, customStyle1Code, customStyle2Code }) {
  return {
    template,
    fields,
    selectedStyle,
    customStyle1Code,
    customStyle2Code,
  };
}

function App() {
  // Refs let us access real DOM nodes (editor and hidden file input).
  const editorRef = useRef(null);
  const importTextRef = useRef(null);
  const importProjectRef = useRef(null);
  const startupTimerRef = useRef(null);
  const jobLookupTimerRef = useRef(null);
  const isSyncingEditorRef = useRef(false);
  const jobUrlLookupRef = useRef(0);
  const activeJobLookupUrlRef = useRef("");
  const lastJobLookupRef = useRef({ url: "", at: 0 });
  const historyRef = useRef({
    undo: [],
    redo: [],
    lastSnapshot: null,
    lastSerialized: "",
    isRestoring: false,
  });

  // Main app state: template text, fields, UI mode, and status messages.
  const [template, setTemplate] = useState(STYLE_TEMPLATE_MAP.eng);
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [activeTab, setActiveTab] = useState("editor");
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState("eng");
  const [customStyle1Code, setCustomStyle1Code] = useState("cus1");
  const [customStyle2Code, setCustomStyle2Code] = useState("cus2");
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isResolvingJobTitle, setIsResolvingJobTitle] = useState(false);
  // Tracks visible progress for the Job URL commit workflow.
  const [jobLookupStage, setJobLookupStage] = useState("");
  const [jobLookupProgress, setJobLookupProgress] = useState(0);
  // Demo startup state for the Start/Stop controls.
  const [startupPhase, setStartupPhase] = useState("idle");
  const [startupProgress, setStartupProgress] = useState(0);
  // Keeps the last 5 exported/imported sessions for quick loading.
  const [recentSessions, setRecentSessions] = useState([]);
  // Tracks how often each company is used so dropdown can prioritize common choices.
  const [companyUsage, setCompanyUsage] = useState({});
  const [isCompanyMenuOpen, setIsCompanyMenuOpen] = useState(false);
  const [companyMenuFilter, setCompanyMenuFilter] = useState("");
  const [isPositionMenuOpen, setIsPositionMenuOpen] = useState(false);
  const [positionMenuFilter, setPositionMenuFilter] = useState("");
  const [activeSkillMenuKey, setActiveSkillMenuKey] = useState("");
  const [skillMenuFilter, setSkillMenuFilter] = useState("");
  const [styleLibrary, setStyleLibrary] = useState(() => normalizeStyleLibrary(null));
  const [resumeText, setResumeText] = useState("");
  const [aiJobText, setAiJobText] = useState("");
  const [useCurrentBrowserSession, setUseCurrentBrowserSession] = useState(false);
  const [isAiExtracting, setIsAiExtracting] = useState(false);
  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [aiFieldSuggestions, setAiFieldSuggestions] = useState([]);
  const [aiExtractMeta, setAiExtractMeta] = useState(null);
  const [aiDraftResult, setAiDraftResult] = useState(null);
  const [jsonPre, setJsonPre] = useState(null);
  const [, setJsonPost] = useState(null);
  const [aiScreenshotPreviews, setAiScreenshotPreviews] = useState([]);
  const [isHistoryReady, setIsHistoryReady] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  const syncControlStatus = useCallback(async () => {
    try {
      const response = await requestControlStatus();
      const appRunning = Boolean(response?.status?.app?.running);
      setStartupPhase(appRunning ? "ready" : "stopped");
      setStartupProgress(appRunning ? 100 : 0);
      if (appRunning) {
        setError("");
      }
    } catch {
      setStartupPhase("stopped");
      setStartupProgress(0);
    }
  }, []);

  // On first render, restore autosaved data from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.template === "string") setTemplate(parsed.template);
      if (Array.isArray(parsed.fields) && parsed.fields.length > 0) {
        setFields(mergeFieldsWithDefaults(parsed.fields));
      }
      if (typeof parsed.selectedStyle === "string") setSelectedStyle(parsed.selectedStyle);
      if (typeof parsed.customStyle1Code === "string") setCustomStyle1Code(parsed.customStyle1Code);
      if (typeof parsed.customStyle2Code === "string") setCustomStyle2Code(parsed.customStyle2Code);
    } catch {
      setError("Autosave data could not be loaded.");
    }
  }, []);

  useEffect(() => {
    syncControlStatus();
  }, [syncControlStatus]);

  // On first render, restore the recent session list shown under File > Recent.
  useEffect(() => {
    try {
      const rawRecent = localStorage.getItem(RECENT_SESSIONS_KEY);
      if (!rawRecent) return;
      const parsedRecent = JSON.parse(rawRecent);
      setRecentSessions(normalizeRecentSessions(parsedRecent));
    } catch {
      setError("Recent sessions could not be loaded.");
    }
  }, []);

  // On first render, restore company frequency history.
  useEffect(() => {
    try {
      const rawCompanyUsage = localStorage.getItem(COMPANY_USAGE_KEY);
      if (!rawCompanyUsage) return;
      const parsedCompanyUsage = JSON.parse(rawCompanyUsage);
      setCompanyUsage(normalizeCompanyUsage(parsedCompanyUsage));
    } catch {
      setError("Company suggestion history could not be loaded.");
    }
  }, []);

  // On first render, restore style library slots.
  useEffect(() => {
    try {
      const rawStyles = localStorage.getItem(STYLE_LIBRARY_KEY);
      if (!rawStyles) return;
      setStyleLibrary(normalizeStyleLibrary(JSON.parse(rawStyles)));
    } catch {
      setError("Style library could not be loaded.");
    }
  }, []);

  useEffect(() => {
    try {
      const rawPref = localStorage.getItem(BROWSER_SESSION_PREF_KEY);
      setUseCurrentBrowserSession(rawPref === "1");
    } catch {
      setUseCurrentBrowserSession(false);
    }
  }, []);

  // Turn history tracking on only after the initial restore effects have had a chance to run.
  useEffect(() => {
    setIsHistoryReady(true);
  }, []);

  // Any time template or fields change, autosave the project.
  useEffect(() => {
    const payload = JSON.stringify({ template, fields, selectedStyle, customStyle1Code, customStyle2Code });
    localStorage.setItem(STORAGE_KEY, payload);
  }, [template, fields, selectedStyle, customStyle1Code, customStyle2Code]);

  // Keep recent sessions synced to browser storage.
  useEffect(() => {
    localStorage.setItem(RECENT_SESSIONS_KEY, JSON.stringify(recentSessions));
  }, [recentSessions]);

  // Persist company usage so suggestions stay available after refresh/restart.
  useEffect(() => {
    localStorage.setItem(COMPANY_USAGE_KEY, JSON.stringify(companyUsage));
  }, [companyUsage]);

  useEffect(() => {
    localStorage.setItem(STYLE_LIBRARY_KEY, JSON.stringify(styleLibrary));
  }, [styleLibrary]);

  useEffect(() => {
    localStorage.setItem(BROWSER_SESSION_PREF_KEY, useCurrentBrowserSession ? "1" : "0");
  }, [useCurrentBrowserSession]);

  useEffect(() => {
    const normalizedFields = normalizeManagedFieldValues(fields);
    if (normalizedFields === fields) return;
    setFields(normalizedFields);
  }, [fields]);

  useEffect(() => {
    if (!isHistoryReady) return;

    const snapshot = buildEditorSnapshot({
      template,
      fields,
      selectedStyle,
      customStyle1Code,
      customStyle2Code,
    });
    const serialized = JSON.stringify(snapshot);
    const history = historyRef.current;

    if (!history.lastSnapshot) {
      history.lastSnapshot = snapshot;
      history.lastSerialized = serialized;
      setUndoCount(history.undo.length);
      setRedoCount(history.redo.length);
      return;
    }

    if (serialized === history.lastSerialized) return;

    if (history.isRestoring) {
      history.lastSnapshot = snapshot;
      history.lastSerialized = serialized;
      history.isRestoring = false;
      setUndoCount(history.undo.length);
      setRedoCount(history.redo.length);
      return;
    }

    history.undo = [...history.undo, history.lastSnapshot].slice(-HISTORY_LIMIT);
    history.redo = [];
    history.lastSnapshot = snapshot;
    history.lastSerialized = serialized;
    setUndoCount(history.undo.length);
    setRedoCount(history.redo.length);
  }, [customStyle1Code, customStyle2Code, fields, isHistoryReady, selectedStyle, template]);

  // Memoized map keeps token lookups fast while typing.
  const valueByKey = useMemo(() => {
    // In simple mode (advanced hidden), field label can act as value fallback.
    const base = Object.fromEntries(
      fields.map((field) => [field.key.toLowerCase(), field.value.trim() || field.label.trim()])
    );
    return base;
  }, [fields]);

  // Recompute preview text and missing tokens whenever inputs change.
  const { rendered, unresolved } = useMemo(() => renderTemplate(template, valueByKey), [template, valueByKey]);
  const previewHtml = useMemo(() => toPreviewHtml(rendered), [rendered]);
  const labelByKey = useMemo(
    () => {
      const labels = Object.fromEntries(
        fields.map((field) => [field.key.toLowerCase(), field.label || FIELD_LABEL_SUGGESTIONS[field.key] || field.key])
      );
      return labels;
    },
    [fields]
  );

  // Small dashboard stats shown below the editor.
  const stats = useMemo(
    () => ({
      templateWords: toWordCount(template),
      finalWords: toWordCount(rendered),
      characters: rendered.length,
      unresolved: unresolved.length,
    }),
    [rendered, template, unresolved.length]
  );
  const currentFieldValueMap = useMemo(() => fieldArrayToValueMap(fields), [fields]);
  const aiDraftSuggestions = useMemo(
    () => mergeSuggestionEntries(aiDraftResult?.fieldSuggestions || {}),
    [aiDraftResult]
  );
  const jsonPreText = useMemo(() => (jsonPre ? JSON.stringify(jsonPre, null, 2) : ""), [jsonPre]);

  // Build dropdown options: top-used first, then default seed list, capped to 25.
  const companyDropdownOptions = useMemo(() => {
    const used = Object.entries(companyUsage)
      .map(([name, count]) => ({ name, count: Number(count) || 0 }))
      .filter((entry) => entry.name && entry.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((entry) => entry.name);

    const defaultsSorted = [...new Set(DEFAULT_COMPANY_SEED.map(normalizeCompanyName))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const merged = [];
    const seen = new Set();
    for (const name of [...used, ...defaultsSorted]) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(name);
      if (merged.length >= COMPANY_DROPDOWN_LIMIT) break;
    }
    return merged;
  }, [companyUsage]);

  const companyMenuOptions = useMemo(() => {
    const query = companyMenuFilter.trim().toLowerCase();
    if (!query) return companyDropdownOptions;
    return companyDropdownOptions.filter((name) => name.toLowerCase().includes(query));
  }, [companyDropdownOptions, companyMenuFilter]);

  const positionDropdownOptions = useMemo(
    () =>
      [...new Set(DEFAULT_POSITION_SEED.map(normalizeCompanyName))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    []
  );

  const positionMenuOptions = useMemo(() => {
    const query = positionMenuFilter.trim().toLowerCase();
    if (!query) return positionDropdownOptions;
    return positionDropdownOptions.filter((name) => name.toLowerCase().includes(query));
  }, [positionDropdownOptions, positionMenuFilter]);

  const positionSkillDropdownOptions = useMemo(
    () =>
      [...new Set(DEFAULT_POSITION_SKILL_SEED.map(normalizeCompanyName))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    []
  );

  const positionSkillMenuOptions = useMemo(() => {
    const query = skillMenuFilter.trim().toLowerCase();
    if (!query) return positionSkillDropdownOptions;
    return positionSkillDropdownOptions.filter((name) => name.toLowerCase().includes(query));
  }, [positionSkillDropdownOptions, skillMenuFilter]);

  const isPositionSkillKey = (fieldKey) => ["pos_skill_1", "pos_skill_2", "pos_skill_3"].includes(fieldKey);

  // Insert a token chip at the current cursor position in the editor.
  const insertTokenAtCursor = (fieldKey, explicitRange = null) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    let range = explicitRange || selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    const chip = buildChipElement(fieldKey, labelByKey);
    range.deleteContents();
    range.insertNode(chip);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    setTemplate(normalizeEditorTemplate(editor));
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || activeTab !== "editor") return;

    if (isSyncingEditorRef.current) {
      isSyncingEditorRef.current = false;
      return;
    }

    editor.textContent = "";
    editor.appendChild(renderEditorNodes(template, labelByKey));
  }, [activeTab, labelByKey, template]);

  const handleEditorInput = () => {
    const editor = editorRef.current;
    if (!editor) return;
    isSyncingEditorRef.current = true;
    setTemplate(normalizeEditorTemplate(editor));
  };

  // Start drag operation by placing field key into drag payload.
  const handleTokenDragStart = (event, fieldKey) => {
    event.dataTransfer.setData("application/x-coverai-token-key", fieldKey);
    event.dataTransfer.setData("text/plain", `{{${fieldKey}}}`);
    event.dataTransfer.effectAllowed = "copy";
  };

  // On drop inside editor, pull token text and insert it at cursor.
  const handleEditorDrop = (event) => {
    event.preventDefault();
    const editor = editorRef.current;
    if (!editor) return;

    const droppedKey =
      event.dataTransfer.getData("application/x-coverai-token-key") ||
      extractTokenKey(event.dataTransfer.getData("text/plain"));
    if (!droppedKey) return;

    const dropRange = getRangeFromPoint(event.clientX, event.clientY);
    insertTokenAtCursor(droppedKey, dropRange);
  };

  // Upload template from .txt or .pdf file.
  const importTextFromFile = async (file) => {
    if (!file) return;
    setError("");
    setNotice("");
    setIsLoadingFile(true);
    try {
      // JSON file: import a saved session/style file.
      if (file.name.toLowerCase().endsWith(".json")) {
        await importProjectFromFile(file);
        return;
      }
      // Plain text file: read directly.
      if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
        const text = await file.text();
        setTemplate(text);
        saveRecentSession(file.name, {
          template: text,
          fields,
          selectedStyle,
          customStyle1Code,
          customStyle2Code,
        });
        setNotice(`Loaded ${file.name}.`);
      // PDF file: extract text page-by-page.
      } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const text = await readPdfAsText(file);
        setTemplate(text);
        saveRecentSession(file.name, {
          template: text,
          fields,
          selectedStyle,
          customStyle1Code,
          customStyle2Code,
        });
        setNotice(`Extracted template from ${file.name}.`);
      } else {
        setError("Supported file types are .txt and .pdf.");
      }
    } catch {
      setError("Could not read this file.");
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    await importTextFromFile(file);
    event.target.value = "";
  };

  const handleOpenText = () => {
    importTextRef.current?.click();
  };

  // Update one property on one field card.
  const updateField = (id, key, value) => {
    setFields((prev) => prev.map((field) => (field.id === id ? { ...field, [key]: value } : field)));
  };

  // Increase usage count for a company so frequent choices rise in the dropdown.
  const recordCompanyUsage = (rawCompany) => {
    const company = normalizeCompanyName(rawCompany);
    if (!company) return;
    setCompanyUsage((prev) => ({
      ...prev,
      [company]: (Number(prev[company]) || 0) + 1,
    }));
  };

  const selectCompanyName = (rawCompany) => {
    const company = normalizeCompanyName(rawCompany);
    if (!company) return;
    setFieldLabelAndValueByKey("company_name", company);
    setCompanyMenuFilter(company);
    setIsCompanyMenuOpen(false);
  };

  const selectPositionTitle = (rawTitle) => {
    const title = normalizeCompanyName(rawTitle);
    if (!title) return;
    setFieldLabelAndValueByKey("position_title", title);
    setPositionMenuFilter(title);
    setIsPositionMenuOpen(false);
  };

  const selectPositionSkill = (fieldKey, rawSkill) => {
    const skill = normalizeCompanyName(rawSkill);
    if (!skill) return;
    setFieldLabelAndValueByKey(fieldKey, skill);
    setSkillMenuFilter(skill);
    setActiveSkillMenuKey("");
  };

  const setFieldLabelAndValueByKey = (fieldKey, nextValue) => {
    let normalized = normalizeFieldValue(nextValue);
    if (fieldKey === "company_name") {
      normalized = cleanCompanyName(normalized);
    }
    if (fieldKey === "position_title") {
      normalized = cleanPositionTitle(normalized, getFieldTextByKey(fields, "company_name"));
    }
    setFields((prev) =>
      prev.map((field) =>
        field.key === fieldKey ? { ...field, label: normalized, value: normalized } : field
      )
    );
    if (fieldKey === "company_name") recordCompanyUsage(normalized);
  };

  const applyFieldSuggestions = (suggestionEntries) => {
    const suggestions = Array.isArray(suggestionEntries) ? suggestionEntries : [];
    const suggestionMap = Object.fromEntries(
      suggestions.filter((entry) => entry?.key && entry?.value).map((entry) => [entry.key, entry.value])
    );
    setFields((prev) =>
      prev.map((field) => {
        if (!suggestionMap[field.key]) return field;
        let normalized = normalizeFieldValue(suggestionMap[field.key]);
        if (field.key === "company_name") {
          normalized = cleanCompanyName(normalized);
        }
        if (field.key === "position_title") {
          normalized = cleanPositionTitle(normalized, cleanCompanyName(suggestionMap.company_name || getFieldTextByKey(prev, "company_name")));
        }
        return { ...field, label: normalized, value: normalized };
      })
    );
    if (suggestionMap.company_name) recordCompanyUsage(suggestionMap.company_name);
  };

  const applySingleAiSuggestion = (entry) => {
    if (!entry?.key || !entry?.value) return;
    applyFieldSuggestions([entry]);
    setNotice(`Applied ${entry.label}.`);
    setError("");
  };

  const applyAllAiSuggestions = (suggestionEntries, contextLabel) => {
    if (!suggestionEntries?.length) return;
    applyFieldSuggestions(suggestionEntries);
    setNotice(`${contextLabel} suggestions applied.`);
    setError("");
  };

  const buildCurrentStyleSnapshot = (templateOverride = template) => ({
    template: templateOverride,
    fields: toTemplateFields(fields),
    selectedStyle,
    customStyle1Code,
    customStyle2Code,
  });

  const saveAiDraftToUserStyle = () => {
    if (!aiDraftResult?.draft) return;
    const styleName = `AI Draft ${new Date().toLocaleString()}`;
    const snapshot = normalizeSessionSnapshot({
      ...buildCurrentStyleSnapshot(aiDraftResult.draft),
      selectedStyle: "custom_1",
    });
    setStyleLibrary((prev) => ({
      ...prev,
      custom_1: {
        ...STYLE_SLOT_META.custom_1,
        name: styleName,
        updatedAt: new Date().toISOString(),
        snapshot,
      },
    }));
    setNotice("AI draft saved to User Defined style.");
    setError("");
  };

  const replaceEditorDraftWithAi = () => {
    if (!aiDraftResult?.draft) return;
    setTemplate(aiDraftResult.draft);
    setNotice("AI draft loaded into the template editor.");
    setError("");
  };

  const buildAiExtractMeta = (response) => ({
    confidence: response.confidence || "medium",
    notes: response.notes || "",
    sourceSummary: response.sourceSummary || "",
    skills: Array.isArray(response.answers?.top_skills)
      ? response.answers.top_skills
      : Array.isArray(response.skills)
        ? response.skills
        : [],
  });

  const buildAiScreenshotPreviews = (response) =>
    (Array.isArray(response?.screenshots) ? response.screenshots : [])
      .filter((item) => item?.imageDataUrl)
      .map((item, index) => ({
        id: `${item.label || "shot"}_${index}`,
        label: item.label || `Preview ${index + 1}`,
        excerpt: item.excerpt || "",
        src: item.imageDataUrl,
      }));

  const runAiExtractJob = async () => {
    const jobUrl = getFieldTextByKey(fields, "job_url");
    const pastedJobText = aiJobText.trim();
    if (!jobUrl && !pastedJobText) {
      setError("Add a Job URL or paste job text before running AI Extract Job.");
      return;
    }

    setIsAiExtracting(true);
    setError("");
    setNotice("CoverAI AI is extracting job details...");
    try {
      const response = await requestAiExtractJob({
        jobUrl,
        jobText: pastedJobText,
        fields,
        useCurrentBrowserSession,
      });
      const nextJsonPre = response;
      const suggestionEntries = mergeSuggestionEntries(response.fieldSuggestions || {});
      setAiFieldSuggestions(suggestionEntries);
      setAiExtractMeta(buildAiExtractMeta(response));
      setAiScreenshotPreviews(buildAiScreenshotPreviews(response));
      setJsonPre(nextJsonPre);
      setJsonPost(null);
      if (response?.errorCode === "ai_not_configured") {
        setNotice("Screenshots captured, but AI extraction did not run because OPENAI_API_KEY is not configured.");
      } else {
        setNotice("AI extraction complete. Review the raw jsonPre findings.");
      }
      setError("");
    } catch (error) {
      setAiFieldSuggestions([]);
      setAiExtractMeta(null);
      setAiScreenshotPreviews([]);
      setJsonPre(null);
      setJsonPost(null);
      if (jobUrl) {
        setNotice("AI extraction failed. Falling back to the existing URL parser...");
        await resolveJobReferenceFromUrl(jobUrl, { preferAi: false });
      } else {
        setError(error.message || "AI extraction failed.");
      }
    } finally {
      setIsAiExtracting(false);
    }
  };

  const extractJobViaAi = async ({ jobUrl = "", jobText = "", autoApply = false } = {}) => {
    const response = await requestAiExtractJob({
      jobUrl,
      jobText,
      fields,
      useCurrentBrowserSession,
    });
    const nextJsonPre = response;
    const suggestionEntries = mergeSuggestionEntries(response.fieldSuggestions || {});
    setAiFieldSuggestions(suggestionEntries);
    setAiExtractMeta(buildAiExtractMeta(response));
    setAiScreenshotPreviews(buildAiScreenshotPreviews(response));
    setJsonPre(nextJsonPre);
    setJsonPost(null);
    if (autoApply && suggestionEntries.length > 0) {
      applyFieldSuggestions(suggestionEntries);
    }
    return { response, suggestionEntries, jsonPre: nextJsonPre, jsonPost: null };
  };

  const runAiDraftLetter = async () => {
    const extractedJob =
      aiExtractMeta || aiJobText.trim()
        ? {
            ...(aiExtractMeta || {}),
            fieldSuggestions: Object.fromEntries(aiFieldSuggestions.map((entry) => [entry.key, entry.value])),
            pastedJobText: aiJobText.trim(),
          }
        : null;

    setIsAiDrafting(true);
    setError("");
    setNotice("CoverAI AI is drafting a tailored letter...");
    try {
      const response = await requestAiDraftLetter({
        template,
        fields,
        selectedStyle: getSelectedStyleCode(),
        resumeText,
        extractedJob,
      });
      setAiDraftResult({
        draft: response.draft || "",
        fieldSuggestions: response.fieldSuggestions || {},
        notes: response.notes || "",
        warnings: Array.isArray(response.warnings) ? response.warnings : [],
      });
      setNotice("AI draft ready. Review it before applying.");
      setError("");
    } catch (error) {
      setError(error.message || "AI draft generation failed.");
    } finally {
      setIsAiDrafting(false);
    }
  };

  const resolveJobReferenceFromUrl = async (rawUrl, options = {}) => {
    const { preferAi = true } = options;
    const url = rawUrl.trim();
    if (!isHttpUrl(url)) return;
    const now = Date.now();
    // Prevent duplicate triggers from paste + blur + enter for the same URL.
    if (activeJobLookupUrlRef.current === url) return;
    if (lastJobLookupRef.current.url === url && now - lastJobLookupRef.current.at < 1200) return;
    lastJobLookupRef.current = { url, at: now };

    const requestId = Date.now();
    jobUrlLookupRef.current = requestId;
    activeJobLookupUrlRef.current = url;
    setIsResolvingJobTitle(true);
    startJobLookupProgress();
    setFieldLabelAndValueByKey("job_url", url);
    setFieldLabelAndValueByKey("job_listing_ref_url", url);
    // Instant prefill from URL slug so the UI updates immediately.
    const instantTitleCandidate = titleFromUrlPath(url);
    const canUseInstantTitle = instantTitleCandidate && !isNumericOnlyTitle(instantTitleCandidate);
    const instantTitle = canUseInstantTitle ? instantTitleCandidate : "";
    const instantSkills = canUseInstantTitle ? inferSkillsFromTitle(instantTitle).slice(0, 3) : [];
    if (canUseInstantTitle && instantTitle) {
      setFieldLabelAndValueByKey("job_listing_ref_title", instantTitle);
    }
    if (instantSkills[0]) setFieldLabelAndValueByKey("pos_skill_1", instantSkills[0]);
    if (instantSkills[1]) setFieldLabelAndValueByKey("pos_skill_2", instantSkills[1]);
    if (instantSkills[2]) setFieldLabelAndValueByKey("pos_skill_3", instantSkills[2]);
    setNotice("Job URL committed. Refining details...");
    setError("");

    if (preferAi) {
      try {
        setJobLookupStage("LLM extracting job details...");
        await extractJobViaAi({
          jobUrl: url,
          autoApply: false,
        });
        if (jobUrlLookupRef.current !== requestId) return;
        completeJobLookupProgress("AI extraction complete.");
        setNotice("Raw AI job findings saved to jsonPre.");
        setError("");
        return;
      } catch {
        if (jobUrlLookupRef.current !== requestId) return;
        setNotice("AI extraction unavailable. Falling back to heuristic URL parsing...");
      }
    }

    try {
      setJobLookupStage("Fetching title, company, and skills...");
      const { title, refTitle, company, skills } = await fetchJobInsightsFromUrl(url);
      if (jobUrlLookupRef.current !== requestId) return;
      setJobLookupProgress(88);
      setJobLookupStage("Applying results...");
      const titleParts = (refTitle || "")
        .split(/[|/]/)
        .map((part) => part.trim())
        .filter(Boolean);
      const refFirstSegment = titleParts[0] || "";
      const refSecondSegment = titleParts[1] || "";
      const resolvedCompany = cleanCompanyName(refSecondSegment || company || "");
      const baseResolvedPositionTitle = [title, refFirstSegment, instantTitle].find(
        (candidate) => candidate && !isNumericOnlyTitle(candidate)
      );
      const linkedInAdjustedTitle = /linkedin\.com/i.test(url)
        ? truncateLinkedInJobTitle(baseResolvedPositionTitle)
        : baseResolvedPositionTitle;
      const resolvedPositionTitle = cleanPositionTitle(linkedInAdjustedTitle, resolvedCompany);
      const fallbackSkills = inferSkillsFromTitle(title);
      const mergedSkills = [...skills, ...fallbackSkills]
        .map((s) => (s || "").trim())
        .filter(Boolean)
        .filter((skill, index, arr) => arr.findIndex((x) => x.toLowerCase() === skill.toLowerCase()) === index)
        .slice(0, 3);
      const washedSkills = mergedSkills
        .map((skill) => washSkillToShortPhrase(skill))
        .filter(Boolean)
        .filter((skill, index, arr) => arr.findIndex((x) => x.toLowerCase() === skill.toLowerCase()) === index)
        .slice(0, 3);
      const resolvedRefTitle = refTitle || title || instantTitle;
      const nextJsonPre = {
        source: "heuristic_url_lookup",
        job_url: url,
        company_name: refSecondSegment || company || "",
        position_title: linkedInAdjustedTitle || "",
        job_listing_ref_title: resolvedRefTitle,
        skills: mergedSkills,
      };
      const nextJsonPost = buildWashedJobPayload({
        ...nextJsonPre,
        job_listing_ref_url: url,
      });

      if (resolvedPositionTitle) setFieldLabelAndValueByKey("position_title", resolvedPositionTitle);
      if (resolvedRefTitle) setFieldLabelAndValueByKey("job_listing_ref_title", resolvedRefTitle);
      // Always update the company field so stale values do not stick.
      setFieldLabelAndValueByKey("company_name", resolvedCompany);
      if (washedSkills[0]) setFieldLabelAndValueByKey("pos_skill_1", washedSkills[0]);
      if (washedSkills[1]) setFieldLabelAndValueByKey("pos_skill_2", washedSkills[1]);
      if (washedSkills[2]) setFieldLabelAndValueByKey("pos_skill_3", washedSkills[2]);
      setJsonPre(nextJsonPre);
      setJsonPost(nextJsonPost);
      setNotice("Job details populated from URL.");
      setError("");
      completeJobLookupProgress("URL complete.");
    } catch {
      if (jobUrlLookupRef.current !== requestId) return;
      setError("Could not fetch job title from URL.");
      completeJobLookupProgress("URL failed.");
    } finally {
      if (jobUrlLookupRef.current === requestId) {
        setIsResolvingJobTitle(false);
        activeJobLookupUrlRef.current = "";
      }
    }
  };

  // Return a field-specific suggestion to show as grey helper text.
  const getFieldSuggestion = (fieldKey) => FIELD_SUGGESTIONS[fieldKey] || "Type value used in final letter";
  const getFieldLabelSuggestion = (fieldKey) => FIELD_LABEL_SUGGESTIONS[fieldKey] || "Field Label";

  // Keep token keys safe and unique so collisions don't break replacements.
  const updateFieldKey = (id, rawKey) => {
    const nextKey = slugify(rawKey);
    setFields((prev) => {
      const keyAlreadyUsed = prev.some((field) => field.id !== id && field.key === nextKey);
      const safeKey = keyAlreadyUsed ? `${nextKey}_${Date.now().toString().slice(-4)}` : nextKey;
      return prev.map((field) => (field.id === id ? { ...field, key: safeKey } : field));
    });
  };

  // Add a new field and generate a unique token key for it.
  const addField = () => {
    const base = slugify(newFieldLabel || `field_${fields.length + 1}`);
    const existingKeys = new Set(fields.map((field) => field.key));
    let candidate = base;
    let suffix = 1;
    while (existingKeys.has(candidate)) {
      suffix += 1;
      candidate = `${base}_${suffix}`;
    }
    setFields((prev) => [
      ...prev,
      { id: `f_${Date.now()}`, key: candidate, label: newFieldLabel || "New Field", value: "" },
    ]);
    setNewFieldLabel("");
  };

  // Remove field card by id.
  const deleteField = (id) => {
    setFields((prev) => prev.filter((field) => field.id !== id));
  };

  const getSelectedStyleCode = () => {
    if (selectedStyle === "custom_1") return sanitizeStyleCode(customStyle1Code, "cus1");
    if (selectedStyle === "custom_2") return sanitizeStyleCode(customStyle2Code, "cus2");
    return selectedStyle;
  };

  const getStyleLabelByCode = (code) => {
    const known = {
      eng: "Engineering",
      cus: "Customer Service",
      fin: "Financial",
      mgr: "Management",
      custom_1: "User Defined",
    };
    return known[code] || code.toUpperCase();
  };

  // Apply a saved snapshot into the current working session.
  const applySessionSnapshot = (snapshot, nextStyleKey = selectedStyle) => {
    const normalized = normalizeSessionSnapshot(snapshot);
    if (!normalized) {
      setError("Saved style data is invalid.");
      return false;
    }
    setTemplate(normalized.template);
    setFields(normalized.fields);
    setSelectedStyle(nextStyleKey);
    setCustomStyle1Code(normalized.customStyle1Code);
    setCustomStyle2Code(normalized.customStyle2Code);
    return true;
  };

  // Load a style directly from local style slots (no file browse on each click).
  const loadStyleFromSlot = (styleKey) => {
    const styleName = STYLE_SLOT_META[styleKey]?.label || getStyleLabelByCode(styleKey);
    const overwrite = window.confirm(`Load ${styleName}? This will overwrite your current active session.`);
    if (!overwrite) return;
    const slot = styleLibrary[styleKey];
    if (!slot?.snapshot) {
      setError(`No saved ${styleName} style yet.`);
      return;
    }
    const applied = applySessionSnapshot(slot.snapshot, styleKey);
    if (!applied) return;
    setNotice(`Loaded ${slot.name || styleName}.`);
    setError("");
  };

  // Save current session to the only editable style slot and export a matching style file.
  const saveStyleToSlot = async (mode) => {
    const editableKey = "custom_1";
    const currentSlot = styleLibrary[editableKey];
    if (mode === "new" && currentSlot?.snapshot) {
      setError("User Defined style already exists. Use Replace Existing.");
      return;
    }

    const styleNamePrompt = window.prompt("Style name:", currentSlot?.name || "User Defined");
    if (styleNamePrompt === null) return;
    const styleName = styleNamePrompt.trim() || "User Defined";
    const snapshot = {
      template,
      fields: toTemplateFields(fields),
      selectedStyle: editableKey,
      customStyle1Code,
      customStyle2Code,
    };

    setStyleLibrary((prev) => ({
      ...prev,
      [editableKey]: {
        ...STYLE_SLOT_META[editableKey],
        name: styleName,
        updatedAt: new Date().toISOString(),
        snapshot: normalizeSessionSnapshot(snapshot),
      },
    }));
    setSelectedStyle(editableKey);

    const styleCode = sanitizeStyleCode(customStyle1Code, "usr");
    const suggestedName = `style_${formatDateYYMMDD()}_${styleCode}`;
    const payload = JSON.stringify(
      {
        type: "coverai_style",
        version: 1,
        styleKey: editableKey,
        styleName,
        locked: false,
        createdAt: new Date().toISOString(),
        snapshot,
      },
      null,
      2
    );
    const savedFileName = await saveJsonWithDialog(payload, suggestedName);
    if (savedFileName) {
      saveRecentSession(savedFileName, snapshot);
    }
    setNotice(mode === "new" ? `Saved new style: ${styleName}.` : `Replaced style: ${styleName}.`);
    setError("");
  };

  // Save one snapshot into the "recent sessions" list.
  const saveRecentSession = (name, snapshot) => {
    const normalized = normalizeSessionSnapshot(snapshot);
    if (!normalized) return;
    const cleanName = (name || "Session").trim();
    setRecentSessions((prev) => {
      const filtered = prev.filter((entry) => entry.name !== cleanName);
      const next = [
        {
          id: `recent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: cleanName,
          savedAt: new Date().toISOString(),
          snapshot: normalized,
        },
        ...filtered,
      ];
      return next.slice(0, RECENT_SESSIONS_LIMIT);
    });
  };

  // Load a saved recent session back into editor + fields.
  const loadRecentSession = (entry) => {
    const normalized = normalizeSessionSnapshot(entry?.snapshot);
    if (!normalized) {
      setError("This recent session entry is invalid.");
      return;
    }
    setTemplate(normalized.template);
    setFields(normalized.fields);
    setSelectedStyle(normalized.selectedStyle);
    setCustomStyle1Code(normalized.customStyle1Code);
    setCustomStyle2Code(normalized.customStyle2Code);
    setNotice(`Loaded recent session: ${entry.name}`);
    setError("");
  };

  const formatRecentSavedAt = (isoString) => {
    const parsed = Date.parse(isoString);
    if (Number.isNaN(parsed)) return "";
    const stamp = new Date(parsed);
    return stamp.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  // Restore template + fields to starter defaults.
  const resetAll = () => {
    const baseline = styleLibrary.eng?.snapshot || buildDefaultStyleSnapshot("eng");
    applySessionSnapshot(baseline, "eng");
    setResumeText("");
    setAiJobText("");
    setAiFieldSuggestions([]);
    setAiExtractMeta(null);
    setAiDraftResult(null);
    setAiScreenshotPreviews([]);
    setJsonPre(null);
    setJsonPost(null);
    setNotice("Reset to default template.");
    setError("");
  };

  // Create a reusable template file for future jobs.
  // A template keeps token layout and wording, but no field data.
  const createTemplateFile = async () => {
    const templateFields = toTemplateFields(fields);

    const payload = JSON.stringify(
      {
        type: "coverai_template",
        version: 1,
        createdAt: new Date().toISOString(),
        templateDefinition: "session_with_placeholders_no_field_data",
        styleSlots: {
          total: 5,
          lockedPresets: ["eng", "cus", "fin", "mgr"],
          editableSlot: "custom_1",
        },
        style: getSelectedStyleCode(),
        template,
        fields: templateFields,
      },
      null,
      2
    );
    const datePart = formatDateYYMMDD();
    const styleCode = getSelectedStyleCode();
    const seq = peekNextTemplateSequence(datePart, styleCode);
    const suggestedName = `cv_${datePart}_${styleCode}_${seq}`;
    const savedFileName = await saveJsonWithDialog(payload, suggestedName);
    if (savedFileName) {
      commitTemplateSequence(datePart, styleCode, seq);
      saveRecentSession(savedFileName, {
        template,
        fields: templateFields,
        selectedStyle,
        customStyle1Code,
        customStyle2Code,
      });
      setNotice("Template JSON created.");
      setError("");
    } else {
      setNotice("Template save canceled.");
    }
  };

  // Load a previously exported JSON project/template file.
  const importProjectFromFile = async (file) => {
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Style file: save into editable style slot and apply immediately.
      if (parsed?.type === "coverai_style" && parsed?.snapshot) {
        const snapshot = normalizeSessionSnapshot(parsed.snapshot);
        if (!snapshot) throw new Error("Invalid style snapshot");
        const styleName = typeof parsed.styleName === "string" && parsed.styleName.trim() ? parsed.styleName.trim() : "User Defined";
        setStyleLibrary((prev) => ({
          ...prev,
          custom_1: {
            ...STYLE_SLOT_META.custom_1,
            name: styleName,
            updatedAt: new Date().toISOString(),
            snapshot,
          },
        }));
        applySessionSnapshot(snapshot, "custom_1");
        saveRecentSession(file.name, snapshot);
        setNotice(`Style imported: ${styleName}.`);
        setError("");
        return;
      }

      if (!parsed || typeof parsed.template !== "string" || !Array.isArray(parsed.fields)) {
        throw new Error("Invalid project");
      }
      setTemplate(parsed.template);
      setFields(mergeFieldsWithDefaults(parsed.fields));
      if (typeof parsed.style === "string") {
        if (["eng", "cus", "fin", "mgr", "custom_1", "custom_2"].includes(parsed.style)) {
          setSelectedStyle(parsed.style);
        } else {
          setSelectedStyle("custom_1");
          setCustomStyle1Code(parsed.style);
        }
      }
      saveRecentSession(file.name, {
        template: parsed.template,
        fields: parsed.fields,
        selectedStyle:
          typeof parsed.style === "string" && ["eng", "cus", "fin", "mgr", "custom_1", "custom_2"].includes(parsed.style)
            ? parsed.style
            : "custom_1",
        customStyle1Code: typeof parsed.style === "string" ? parsed.style : customStyle1Code,
        customStyle2Code,
      });
      setNotice("Project imported.");
    } catch {
      setError("Invalid project file.");
    }
  };

  const importProject = async (event) => {
    const file = event.target.files?.[0];
    await importProjectFromFile(file);
    event.target.value = "";
  };

  const handleImportSession = async () => {
    importProjectRef.current?.click();
  };

  // Copy final rendered letter to clipboard.
  const copyFinal = async () => {
    try {
      await navigator.clipboard.writeText(rendered);
      setNotice("Final letter copied to clipboard.");
      setError("");
    } catch {
      setError("Clipboard copy failed.");
    }
  };

  const restoreEditorSnapshot = (snapshot) => {
    if (!snapshot) return false;
    historyRef.current.isRestoring = true;
    setTemplate(snapshot.template);
    setFields(mergeFieldsWithDefaults(snapshot.fields));
    setSelectedStyle(snapshot.selectedStyle);
    setCustomStyle1Code(snapshot.customStyle1Code);
    setCustomStyle2Code(snapshot.customStyle2Code);
    return true;
  };

  const handleUndo = useCallback(() => {
    const history = historyRef.current;
    const previous = history.undo[history.undo.length - 1];
    if (!previous || !history.lastSnapshot) return;

    history.undo = history.undo.slice(0, -1);
    history.redo = [history.lastSnapshot, ...history.redo].slice(0, HISTORY_LIMIT);
    setUndoCount(history.undo.length);
    setRedoCount(history.redo.length);
    restoreEditorSnapshot(previous);
    setNotice("Undo applied.");
    setError("");
  }, []);

  const handleRedo = useCallback(() => {
    const history = historyRef.current;
    const next = history.redo[0];
    if (!next || !history.lastSnapshot) return;

    history.redo = history.redo.slice(1);
    history.undo = [...history.undo, history.lastSnapshot].slice(-HISTORY_LIMIT);
    setUndoCount(history.undo.length);
    setRedoCount(history.redo.length);
    restoreEditorSnapshot(next);
    setNotice("Redo applied.");
    setError("");
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        downloadTextFile(rendered, "cover-letter-final.txt");
        setNotice("Final letter downloaded.");
        setError("");
        return;
      }

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }

      if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo, rendered]);

  // Stop any running startup timer to avoid multiple timers at once.
  const clearStartupTimer = () => {
    if (startupTimerRef.current) {
      clearInterval(startupTimerRef.current);
      startupTimerRef.current = null;
    }
  };

  // Stop URL lookup timer so only one progress animation runs at a time.
  const clearJobLookupTimer = () => {
    if (jobLookupTimerRef.current) {
      clearInterval(jobLookupTimerRef.current);
      jobLookupTimerRef.current = null;
    }
  };

  // Begin URL lookup progress animation.
  const startJobLookupProgress = () => {
    clearJobLookupTimer();
    setJobLookupProgress(8);
    setJobLookupStage("Reading page title...");
    jobLookupTimerRef.current = setInterval(() => {
      setJobLookupProgress((prev) => {
        if (prev >= 92) return prev;
        if (prev < 50) return prev + 9;
        if (prev < 75) return prev + 4;
        return prev + 2;
      });
    }, 180);
  };

  // Finish URL lookup progress animation and clear it shortly after.
  const completeJobLookupProgress = (stageText) => {
    clearJobLookupTimer();
    setJobLookupProgress(100);
    setJobLookupStage(stageText);
    setTimeout(() => {
      setJobLookupProgress(0);
      setJobLookupStage("");
    }, 900);
  };

  // Demo "start script": shows staged progress until app is ready.
  const startCoverAI = async () => {
    clearStartupTimer();
    setStartupPhase("running");
    setStartupProgress(12);
    setError("");
    setNotice("Restarting CoverAI services...");

    startupTimerRef.current = setInterval(() => {
      setStartupProgress((prev) => Math.min(prev + 7, 88));
    }, 220);

    try {
      const response = await requestControlRestart();
      setNotice(response?.message || "Starting CoverAI services...");
      window.setTimeout(() => {
        window.location.reload();
      }, 3200);
    } catch (requestError) {
      clearStartupTimer();
      setStartupPhase("ready");
      setStartupProgress(100);
      setError(requestError.message || "Could not restart CoverAI.");
    }
  };

  // Demo "stop script": halts startup/readiness and resets progress.
  const stopCoverAI = async () => {
    clearStartupTimer();
    setStartupPhase("running");
    setStartupProgress(12);
    setNotice("Stopping CoverAI services...");
    setError("");
    try {
      await requestControlStop();
      window.setTimeout(() => {
        setStartupPhase("stopped");
        setStartupProgress(0);
        setAiFieldSuggestions([]);
        setAiExtractMeta(null);
        setAiDraftResult(null);
        setAiScreenshotPreviews([]);
        setJsonPre(null);
        setJsonPost(null);
        setNotice("CoverAI stopped.");
      }, 1500);
    } catch (requestError) {
      setStartupPhase("ready");
      setStartupProgress(100);
      setError(requestError.message || "Could not stop CoverAI.");
    }
  };

  // Cleanup timers if user leaves page/component.
  useEffect(
    () => () => {
      clearStartupTimer();
      clearJobLookupTimer();
    },
    []
  );

  const isRunning = startupPhase === "running";
  const isReady = startupPhase === "ready";
  const startupLabel =
    startupPhase === "ready"
      ? "Ready"
      : startupPhase === "running"
      ? "Working..."
      : startupPhase === "stopped"
      ? "Stopped"
      : "Idle";
  // Show the currently selected style directly under the Style header.
  const selectedStyleMenuLabel = styleLibrary[selectedStyle]?.name || STYLE_SLOT_META[selectedStyle]?.label || "Style";

  // UI layout: header controls, editor/preview area, and field sidebar.
  return (
    <div className="app-shell">
      {/* Top banner + global actions (import/export/reset). */}
      <header className="app-header">
        <div>
          <p className="eyebrow">CoverAI</p>
          <h1>Build tailored letters in minutes</h1>
          <p className="subhead">Use smart placeholders, edit once, then export polished versions fast.</p>
        </div>
        <div className="header-actions">
          <details className="menu-dropdown">
            <summary>CoverAI</summary>
            <div className="menu-list">
              <button type="button" className="menu-item" onClick={startCoverAI} disabled={isRunning}>
                Start CoverAI
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={stopCoverAI}
                disabled={startupPhase === "idle" || startupPhase === "stopped"}
              >
                Stop CoverAI
              </button>
            </div>
          </details>

          <details className="menu-dropdown">
            <summary>File</summary>
            <div className="menu-list">
              <button type="button" className="menu-item" onClick={handleOpenText} disabled={!isReady}>
                Open
              </button>
              <div className="menu-submenu">
                <button type="button" className="menu-item submenu-trigger" disabled={!isReady}>
                  Recent (5)
                </button>
                <div className="submenu-list">
                  {recentSessions.length === 0 ? (
                    <div className="submenu-empty">No recent sessions</div>
                  ) : (
                    recentSessions.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="submenu-item"
                        onClick={() => loadRecentSession(entry)}
                        disabled={!isReady}
                        title={entry.name}
                      >
                        <span className="submenu-item-name">{entry.name}</span>
                        <span className="submenu-item-meta">{formatRecentSavedAt(entry.savedAt)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <button
                type="button"
                className="menu-item"
                onClick={handleImportSession}
                disabled={!isReady}
              >
                Import Session
              </button>
              <button type="button" className="menu-item" onClick={createTemplateFile} disabled={!isReady}>
                Export Session
              </button>
              <div className="menu-submenu">
                <button type="button" className="menu-item submenu-trigger" disabled={!isReady}>
                  Save Style
                </button>
                <div className="submenu-list">
                  <button
                    type="button"
                    className="submenu-item"
                    onClick={() => saveStyleToSlot("new")}
                    disabled={!isReady || Boolean(styleLibrary.custom_1?.snapshot)}
                  >
                    <span className="submenu-item-name">Save New</span>
                  </button>
                  <button
                    type="button"
                    className="submenu-item"
                    onClick={() => saveStyleToSlot("replace")}
                    disabled={!isReady}
                  >
                    <span className="submenu-item-name">Replace Existing</span>
                  </button>
                </div>
              </div>
            </div>
          </details>

          <details className="menu-dropdown style-menu">
            <summary>Style</summary>
            <div className="menu-current-style">{selectedStyleMenuLabel}</div>
            <div className="menu-list">
              <button
                type="button"
                className={`menu-item ${selectedStyle === "eng" ? "active" : ""}`}
                onClick={() => loadStyleFromSlot("eng")}
                disabled={!isReady}
              >
                Engineer
              </button>
              <button
                type="button"
                className={`menu-item ${selectedStyle === "cus" ? "active" : ""}`}
                onClick={() => loadStyleFromSlot("cus")}
                disabled={!isReady}
              >
                Service
              </button>
              <button
                type="button"
                className={`menu-item ${selectedStyle === "fin" ? "active" : ""}`}
                onClick={() => loadStyleFromSlot("fin")}
                disabled={!isReady}
              >
                Financial
              </button>
              <button
                type="button"
                className={`menu-item ${selectedStyle === "mgr" ? "active" : ""}`}
                onClick={() => loadStyleFromSlot("mgr")}
                disabled={!isReady}
              >
                Management
              </button>
              <button
                type="button"
                className={`menu-item ${selectedStyle === "custom_1" ? "active" : ""}`}
                onClick={() => loadStyleFromSlot("custom_1")}
                disabled={!isReady}
              >
                User Defined
              </button>
            </div>
          </details>

          <details className="menu-dropdown">
            <summary>AI</summary>
            <div className="menu-list">
              <button type="button" className="menu-item" onClick={runAiExtractJob} disabled={!isReady || isAiExtracting}>
                {isAiExtracting ? "Extracting..." : "AI Extract Job"}
              </button>
              <button type="button" className="menu-item" onClick={runAiDraftLetter} disabled={!isReady || isAiDrafting}>
                {isAiDrafting ? "Drafting..." : "AI Draft Letter"}
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => applyAllAiSuggestions(aiFieldSuggestions, "Extracted")}
                disabled={!isReady || aiFieldSuggestions.length === 0}
              >
                Apply Suggested Fields
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={replaceEditorDraftWithAi}
                disabled={!isReady || !aiDraftResult?.draft}
              >
                Replace Editor Draft
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={saveAiDraftToUserStyle}
                disabled={!isReady || !aiDraftResult?.draft}
              >
                Save Draft to User Style
              </button>
            </div>
          </details>

          <input
            ref={importTextRef}
            type="file"
            accept=".txt,.pdf,.json"
            onChange={handleFileUpload}
            disabled={!isReady}
            hidden
          />
          <input
            ref={importProjectRef}
            type="file"
            accept=".json"
            onChange={importProject}
            disabled={!isReady}
            hidden
          />
          <button type="button" className="button danger" onClick={resetAll} disabled={!isReady}>
            Reset
          </button>
        </div>
      </header>

      <div className="startup-panel" role="status" aria-live="polite">
        <div className="startup-row">
          <strong>System status: {startupLabel}</strong>
          <span>{startupProgress}%</span>
        </div>
        <div className="progress-track" aria-label="CoverAI startup progress">
          <div className="progress-fill" style={{ width: `${startupProgress}%` }} />
        </div>
        {!isReady && <p>Use Start CoverAI to restart services or Stop CoverAI to shut them down.</p>}
      </div>

      <main className={isReady ? "layout" : "layout locked"}>
        {/* Left side: template editor and final preview. */}
        <section className="panel editor-panel">
          <div className="panel-top">
            <div className="tabs">
              <button
                type="button"
                className={activeTab === "editor" ? "tab active" : "tab"}
                onClick={() => setActiveTab("editor")}
                disabled={!isReady}
              >
                Template
              </button>
              <button
                type="button"
                className={activeTab === "preview" ? "tab active" : "tab"}
                onClick={() => setActiveTab("preview")}
                disabled={!isReady}
              >
                Final Preview
              </button>
            </div>
            <div className="quick-actions">
              <button type="button" className="button" onClick={handleUndo} disabled={!isReady || undoCount === 0}>
                Undo
              </button>
              <button type="button" className="button" onClick={handleRedo} disabled={!isReady || redoCount === 0}>
                Redo
              </button>
              <button
                type="button"
                className="button"
                onClick={() => downloadTextFile(rendered, "cover-letter-final.txt")}
                disabled={!isReady}
              >
                Download Final
              </button>
              <button type="button" className="button" onClick={copyFinal} disabled={!isReady}>
                Copy Final
              </button>
            </div>
          </div>

          {activeTab === "editor" ? (
            <div
              ref={editorRef}
              className="editor"
              contentEditable={isReady}
              suppressContentEditableWarning
              onInput={handleEditorInput}
              onDrop={handleEditorDrop}
              onDragOver={(event) => event.preventDefault()}
              role="textbox"
              aria-label="Template editor"
              data-placeholder="Write your cover letter template here..."
            />
          ) : (
            <div className="preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}

          <div className="panel-footer">
            <div className="stats">
              <span>{stats.templateWords} template words</span>
              <span>{stats.finalWords} final words</span>
              <span>{stats.characters} characters</span>
              <span>{stats.unresolved} unresolved tokens</span>
              <span>{undoCount} undo steps</span>
            </div>
            <span className="shortcut">Shortcuts: Cmd/Ctrl + Z undo, Shift + Cmd/Ctrl + Z redo, Cmd/Ctrl + S download</span>
          </div>

          <div className="ai-review-grid">
            <section className="ai-review-card">
              <div className="ai-review-head">
                <div>
                  <h3>AI Job Review</h3>
                  <p>Review extracted field suggestions before they touch your working session.</p>
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() => applyAllAiSuggestions(aiFieldSuggestions, "Extracted")}
                  disabled={!isReady || aiFieldSuggestions.length === 0}
                >
                  Apply Suggested Fields
                </button>
              </div>
              {aiExtractMeta ? (
                <div className="ai-meta">
                  <span>Confidence: {aiExtractMeta.confidence}</span>
                  {aiExtractMeta.skills?.length > 0 && <span>Skills: {aiExtractMeta.skills.join(", ")}</span>}
                  {aiExtractMeta.sourceSummary && <span>{aiExtractMeta.sourceSummary}</span>}
                  {aiExtractMeta.notes && <span>{aiExtractMeta.notes}</span>}
                </div>
              ) : (
                <p className="ai-empty">Run AI Extract Job after adding a Job URL or pasted listing text.</p>
              )}
              {aiFieldSuggestions.length > 0 && (
                <div className="ai-suggestion-list">
                  {aiFieldSuggestions.map((entry) => (
                    <div className="ai-suggestion-card" key={`extract_${entry.key}`}>
                      <div>
                        <strong>{entry.label}</strong>
                        <p>Current: {currentFieldValueMap[entry.key] || "Empty"}</p>
                        <p>Suggested: {entry.value}</p>
                      </div>
                      <button
                        type="button"
                        className="button"
                        onClick={() => applySingleAiSuggestion(entry)}
                        disabled={!isReady}
                      >
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="ai-review-card">
              <div className="ai-review-head">
                <div>
                  <h3>AI Draft Review</h3>
                  <p>Generate a tailored draft, then replace the editor or save it into your user style slot.</p>
                </div>
                <div className="ai-inline-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={replaceEditorDraftWithAi}
                    disabled={!isReady || !aiDraftResult?.draft}
                  >
                    Replace Editor Draft
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={saveAiDraftToUserStyle}
                    disabled={!isReady || !aiDraftResult?.draft}
                  >
                    Save Draft to User Style
                  </button>
                </div>
              </div>
              {!aiDraftResult?.draft ? (
                <p className="ai-empty">Run AI Draft Letter after you add your fields and optional resume context.</p>
              ) : (
                <>
                  <div className="ai-meta">
                    {aiDraftResult.notes && <span>{aiDraftResult.notes}</span>}
                    {aiDraftResult.warnings?.map((warning) => (
                      <span key={warning}>Warning: {warning}</span>
                    ))}
                  </div>
                  <textarea className="ai-draft-preview" value={aiDraftResult.draft} readOnly />
                  {aiDraftSuggestions.length > 0 && (
                    <>
                      <div className="ai-inline-actions">
                        <button
                          type="button"
                          className="button"
                          onClick={() => applyAllAiSuggestions(aiDraftSuggestions, "Draft")}
                          disabled={!isReady}
                        >
                          Apply Draft Field Suggestions
                        </button>
                      </div>
                      <div className="ai-suggestion-list compact">
                        {aiDraftSuggestions.map((entry) => (
                          <div className="ai-suggestion-card" key={`draft_${entry.key}`}>
                            <div>
                              <strong>{entry.label}</strong>
                              <p>Current: {currentFieldValueMap[entry.key] || "Empty"}</p>
                              <p>Suggested: {entry.value}</p>
                            </div>
                            <button
                              type="button"
                              className="button"
                              onClick={() => applySingleAiSuggestion(entry)}
                              disabled={!isReady}
                            >
                              Apply
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </section>
          </div>
        </section>

        {/* Right side: token controls and editable field values. */}
        <aside className="panel side-panel">
          <div className="side-top">
            <div className="side-top-header">
              <h2>Fields</h2>
              {jobLookupProgress > 0 && (
                <div className="job-lookup-progress mini" aria-label="Job URL process status">
                  <div className="job-lookup-row">
                    <strong>{jobLookupStage || "Processing URL..."}</strong>
                    <span>{jobLookupProgress}%</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${jobLookupProgress}%` }} />
                  </div>
                </div>
              )}
            </div>
            <p>Click or drag a token into the template.</p>
            <button
              type="button"
              className="text-button"
              onClick={() => setShowAdvancedFields((prev) => !prev)}
              disabled={!isReady}
            >
              {showAdvancedFields ? "Hide advanced fields" : "Show advanced fields"}
            </button>
          </div>

          <section className="ai-workbench">
            <div className="ai-workbench-header">
              <h3>AI Workbench</h3>
              <p>Use the Job URL field or paste raw job text here. Resume text helps the draft stay grounded.</p>
            </div>
            <textarea
              className="field-textarea ai-textarea"
              value={aiJobText}
              onChange={(event) => setAiJobText(event.target.value)}
              disabled={!isReady}
              placeholder="Paste job description text here for AI extraction or drafting."
            />
            <textarea
              className="field-textarea ai-textarea"
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              disabled={!isReady}
              placeholder="Paste resume or profile text here to ground AI drafts."
            />
            <label className="ai-session-toggle">
              <input
                type="checkbox"
                checked={useCurrentBrowserSession}
                onChange={(event) => setUseCurrentBrowserSession(event.target.checked)}
                disabled={!isReady}
              />
              <span>Use current Chrome session for site access</span>
            </label>
            <div className="ai-inline-actions">
              <button type="button" className="button" onClick={runAiExtractJob} disabled={!isReady || isAiExtracting}>
                {isAiExtracting ? "Extracting..." : "AI Extract Job"}
              </button>
              <button type="button" className="button" onClick={runAiDraftLetter} disabled={!isReady || isAiDrafting}>
                {isAiDrafting ? "Drafting..." : "AI Draft Letter"}
              </button>
            </div>
            {aiScreenshotPreviews.length > 0 && (
              <div className="ai-screenshot-grid" aria-label="AI screenshot previews">
                {aiScreenshotPreviews.map((preview) => (
                  <figure className="ai-screenshot-card" key={preview.id}>
                    <img className="ai-screenshot-image" src={preview.src} alt={preview.label} />
                    <figcaption>
                      <strong>{preview.label}</strong>
                      {preview.excerpt && <span>{preview.excerpt}</span>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <div className="ai-json-preview" aria-label="AI extracted job JSON">
              {jsonPreText || "Job-related JSON from AI extraction will appear here."}
            </div>
          </section>

          <div className="token-grid">
            {fields.map((field) => (
              <div key={`token_${field.id}`} className="token-wrap">
                <button
                  type="button"
                  className="token"
                  draggable
                  onDragStart={(event) => handleTokenDragStart(event, field.key)}
                  onClick={() => insertTokenAtCursor(field.key)}
                  title={`Insert token {{${field.key}}}`}
                  disabled={!isReady}
                >
                  {getFieldButtonLabel(field)}
                </button>
                {!DEFAULT_FIELD_KEY_SET.has(field.key) && (
                  <button
                    type="button"
                    className="token-remove"
                    onClick={() => deleteField(field.id)}
                    title="Delete custom token"
                    aria-label="Delete custom token"
                    disabled={!isReady}
                  >
                    x
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="field-list">
            {fields.map((field) => (
              <div className="field-card" key={field.id}>
                <div className="field-header">
                  {field.key === "my_signature" ? (
                    <textarea
                      className="field-textarea field-label-input field-label-signature"
                      value={field.label}
                      onChange={(event) => {
                        updateField(field.id, "label", event.target.value);
                        updateField(field.id, "value", event.target.value);
                      }}
                      disabled={!isReady}
                      placeholder={getFieldLabelSuggestion(field.key)}
                    />
                  ) : (
                    <input
                      className={`field-input field-label-input ${
                        field.key === "company_name" ||
                        field.key === "position_title" ||
                        ["pos_skill_1", "pos_skill_2", "pos_skill_3"].includes(field.key)
                          ? "company-picker-input"
                          : ""
                      }`}
                      value={field.label}
                      onChange={(event) => {
                        if (field.key === "job_url" || field.key === "job_listing_ref_url") {
                          const next = event.target.value;
                          updateField(field.id, "label", next);
                          updateField(field.id, "value", next);
                          return;
                        }
                        if (field.key === "company_name") {
                          const next = event.target.value;
                          updateField(field.id, "label", next);
                          updateField(field.id, "value", next);
                          setCompanyMenuFilter(next);
                          setIsCompanyMenuOpen(true);
                          return;
                        }
                        if (field.key === "position_title") {
                          const next = event.target.value;
                          updateField(field.id, "label", next);
                          updateField(field.id, "value", next);
                          setPositionMenuFilter(next);
                          setIsPositionMenuOpen(true);
                          return;
                        }
                        if (isPositionSkillKey(field.key)) {
                          const next = event.target.value;
                          updateField(field.id, "label", next);
                          updateField(field.id, "value", next);
                          setSkillMenuFilter(next);
                          setActiveSkillMenuKey(field.key);
                          return;
                        }
                        updateField(field.id, "label", event.target.value);
                      }}
                      onPaste={(event) => {
                        if (field.key !== "job_url") return;
                        const pasted = event.clipboardData.getData("text/plain") || "";
                        if (!isHttpUrl(pasted)) return;
                        event.preventDefault();
                        const pastedUrl = pasted.trim();
                        setFieldLabelAndValueByKey("job_url", pastedUrl);
                        resolveJobReferenceFromUrl(pasted);
                      }}
                      onBlur={(event) => {
                        if (field.key === "job_url") {
                          const entered = event.target.value.trim();
                          if (!isHttpUrl(entered)) return;
                          resolveJobReferenceFromUrl(entered);
                          return;
                        }
                        if (field.key === "company_name") {
                          recordCompanyUsage(event.target.value);
                          window.setTimeout(() => setIsCompanyMenuOpen(false), 120);
                          return;
                        }
                        if (field.key === "position_title") {
                          window.setTimeout(() => setIsPositionMenuOpen(false), 120);
                          return;
                        }
                        if (isPositionSkillKey(field.key)) {
                          window.setTimeout(() => setActiveSkillMenuKey(""), 120);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (field.key !== "job_url") return;
                        if (event.key !== "Enter") return;
                        const entered = event.currentTarget.value.trim();
                        if (!isHttpUrl(entered)) return;
                        event.preventDefault();
                        resolveJobReferenceFromUrl(entered);
                      }}
                      onFocus={(event) => {
                        if (field.key === "company_name") {
                          setCompanyMenuFilter(event.target.value || "");
                          setIsCompanyMenuOpen(true);
                          return;
                        }
                        if (field.key === "position_title") {
                          setPositionMenuFilter(event.target.value || "");
                          setIsPositionMenuOpen(true);
                          return;
                        }
                        if (isPositionSkillKey(field.key)) {
                          setSkillMenuFilter(event.target.value || "");
                          setActiveSkillMenuKey(field.key);
                          return;
                        }
                        event.target.select();
                      }}
                      disabled={!isReady}
                      placeholder={getFieldLabelSuggestion(field.key)}
                    />
                  )}
                  {!DEFAULT_FIELD_KEY_SET.has(field.key) && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Delete custom field"
                      title="Delete custom field"
                      onClick={() => deleteField(field.id)}
                      disabled={!isReady}
                    >
                      x
                    </button>
                  )}
                </div>
                {field.key === "company_name" && isCompanyMenuOpen && isReady && (
                  <div className="company-suggestions" role="listbox" aria-label="Company suggestions">
                    {companyMenuOptions.length === 0 ? (
                      <div className="company-option-empty">No matches</div>
                    ) : (
                      companyMenuOptions.map((company) => (
                        <button
                          key={company}
                          type="button"
                          className="company-option"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selectCompanyName(company);
                          }}
                        >
                          {company}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {field.key === "position_title" && isPositionMenuOpen && isReady && (
                  <div className="company-suggestions" role="listbox" aria-label="Position title suggestions">
                    {positionMenuOptions.length === 0 ? (
                      <div className="company-option-empty">No matches</div>
                    ) : (
                      positionMenuOptions.map((title) => (
                        <button
                          key={title}
                          type="button"
                          className="company-option"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selectPositionTitle(title);
                          }}
                        >
                          {title}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {isPositionSkillKey(field.key) && activeSkillMenuKey === field.key && isReady && (
                  <div className="company-suggestions" role="listbox" aria-label="Position skill suggestions">
                    {positionSkillMenuOptions.length === 0 ? (
                      <div className="company-option-empty">No matches</div>
                    ) : (
                      positionSkillMenuOptions.map((skill) => (
                        <button
                          key={skill}
                          type="button"
                          className="company-option"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selectPositionSkill(field.key, skill);
                          }}
                        >
                          {skill}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {showAdvancedFields && (
                  <>
                    <input
                      className="field-input mono"
                      value={field.key}
                      onChange={(event) => updateFieldKey(field.id, event.target.value)}
                      disabled={!isReady}
                      placeholder="token_key"
                    />
                    <textarea
                      className="field-textarea"
                      value={field.value}
                      onChange={(event) => updateField(field.id, "value", event.target.value)}
                      onPaste={(event) => {
                        if (field.key !== "job_url") return;
                        const pasted = event.clipboardData.getData("text/plain") || "";
                        if (!isHttpUrl(pasted)) return;
                        event.preventDefault();
                        resolveJobReferenceFromUrl(pasted);
                      }}
                      onBlur={(event) => {
                        if (field.key !== "job_url") return;
                        if (!isHttpUrl(event.target.value)) return;
                        resolveJobReferenceFromUrl(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (field.key !== "job_url") return;
                        if (event.key !== "Enter") return;
                        const entered = event.currentTarget.value.trim();
                        if (!isHttpUrl(entered)) return;
                        event.preventDefault();
                        resolveJobReferenceFromUrl(entered);
                      }}
                      disabled={!isReady}
                      placeholder={getFieldSuggestion(field.key)}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="add-field">
            <input
              className="field-input"
              value={newFieldLabel}
              onChange={(event) => setNewFieldLabel(event.target.value)}
              disabled={!isReady}
              placeholder="New field label"
            />
            <button type="button" className="button" onClick={addField} disabled={!isReady}>
              Add Field
            </button>
          </div>

          
        </aside>
      </main>

      {/* Small status area for success/error/loading feedback. */}
      {(notice || error || isLoadingFile || isResolvingJobTitle) && (
        <div className="status-row" role="status" aria-live="polite">
          {isLoadingFile && <span>Loading file...</span>}
          {isResolvingJobTitle && <span>Resolving job details...</span>}
          {isAiExtracting && <span>AI extracting job details...</span>}
          {isAiDrafting && <span>AI drafting letter...</span>}
          {notice && <span className="ok">{notice}</span>}
          {error && <span className="err">{error}</span>}
        </div>
      )}
    </div>
  );
}

export default App;
