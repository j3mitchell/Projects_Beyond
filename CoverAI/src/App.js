import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

// This key is the "name tag" used when saving data in the browser.
const STORAGE_KEY = "coverLetterStudio.v1";
// This pattern finds tokens like {{company_name}} inside the template text.
const TOKEN_REGEX = /{{\s*([a-z0-9_]+)\s*}}/gi;

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
];

// Starter letter template that includes tokens wrapped in {{ }}.
const DEFAULT_TEMPLATE = `Dear {{hiring_manager}},

I am excited to apply for the {{position_title}} role at {{company_name}}.

I reviewed the role requirements, including {{pos_skill_1}}, {{pos_skill_2}}, and {{pos_skill_3}}.
Relevant examples from my background include work at {{prev_company}}, plus strengths in {{my_skill_1}}, {{my_skill_2}}, and {{my_skill_3}}.
Additional experience: {{additional_exp_1}} and {{additional_exp_2}}.

Job posting: {{job_url}}
Reference: {{ref}}

Sincerely,
{{my_signature}}`;

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
  prev_company: "Prev Company",
  my_skill_1: "My Skill 1",
  my_skill_2: "My Skill 2",
  my_skill_3: "My Skill 3",
  additional_exp_1: "Additional Exp 1",
  additional_exp_2: "Additional Exp 2",
  my_signature: "My Signature",
};

function buildChipElement(fieldKey, labelByKey) {
  const chip = document.createElement("span");
  chip.className = "editor-chip";
  chip.setAttribute("contenteditable", "false");
  chip.dataset.tokenKey = fieldKey;
  chip.textContent = labelByKey[fieldKey] || fieldKey;
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
  return normalizeTitleCandidate(match?.[1] || "");
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

function isLikelyJobTitle(value) {
  const text = normalizeTitleCandidate(value);
  if (!text) return false;
  if (text.length < 4 || text.length > 120) return false;
  if (/https?:\/\//i.test(text)) return false;
  if (/\b(reposted|clicked apply|responses managed|on-site|full-time|part-time)\b/i.test(text)) return false;
  if (/\b[A-Za-z ]+,\s*[A-Z]{2}\b/.test(text)) return false; // likely location like "Silver Spring, MD"
  return true;
}

function titleCandidateScore(rawValue) {
  const text = normalizeTitleCandidate(rawValue);
  if (!isLikelyJobTitle(text)) return -1000;
  const nouns =
    /\b(engineer|developer|administrator|manager|analyst|specialist|officer|nurse|planner|technician|representative|consultant|architect)\b/i;
  const words = text.split(/\s+/).filter(Boolean);
  let score = 0;
  score += Math.min(words.length, 8);
  if (nouns.test(text)) score += 20;
  if (/-/.test(text)) score += 2;
  if (/\bii|iii|iv|jr|sr|lead|senior|principal\b/i.test(text)) score += 4;
  return score;
}

function bestTitleCandidate(candidates) {
  const unique = [];
  const seen = new Set();
  for (const raw of candidates) {
    const normalized = normalizeTitleCandidate(raw || "");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }
  if (unique.length === 0) return "";
  unique.sort((a, b) => titleCandidateScore(b) - titleCandidateScore(a));
  return unique[0];
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

function extractTitleWithModel(content, siteModel) {
  if (!content) return "";
  const tagTitle = extractTitleTag(content);
  if (isLikelyJobTitle(tagTitle)) return tagTitle;

  if (siteModel?.name === "LinkedIn") {
    // Fast path first: common LinkedIn title containers.
    const linkedInCandidates = [
      content.match(/<h1[^>]*>\s*([^<]+)\s*<\/h1>/i)?.[1],
      content.match(/href="https:\/\/www\.linkedin\.com\/jobs\/view\/[^"]+"[^>]*>([^<]+)</i)?.[1],
      content.match(/class="[^"]*job-details-jobs-unified-top-card__job-title[^"]*"[\s\S]*?<h1[^>]*>\s*([^<]+)\s*<\/h1>/i)?.[1],
      content.match(/^Title:\s*(.+)$/im)?.[1],
    ].filter(Boolean);
    const topLinkedInTitle = bestTitleCandidate(linkedInCandidates);
    if (topLinkedInTitle) return topLinkedInTitle;

    // JSON-LD fallback only if fast HTML patterns missed.
    const linkedInJson = extractLinkedInJsonData(content);
    if (linkedInJson.title) return linkedInJson.title;
  }
  if (!siteModel) {
    const generic = content.match(/^Title:\s*(.+)$/im);
    return bestTitleCandidate([generic?.[1] || ""]);
  }

  const collected = [];
  for (const pattern of siteModel.titlePatterns) {
    const match = content.match(pattern);
    const candidate = normalizeTitleCandidate(match?.[1] || "");
    if (candidate) collected.push(candidate);
  }
  return bestTitleCandidate(collected);
}

async function fetchJobTitleFromUrl(rawUrl) {
  const siteModel = getJobSiteModel(rawUrl);

  const fromDirect = async () =>
    withTimeout(5000, async () => {
      const direct = await fetch(rawUrl, { mode: "cors" });
      if (!direct.ok) throw new Error("direct not ok");
      const html = await direct.text();
      const modelTitle = extractTitleWithModel(html, siteModel);
      if (modelTitle) return modelTitle;
      const doc = new DOMParser().parseFromString(html, "text/html");
      const title = doc.querySelector("meta[property='og:title']")?.getAttribute("content") || doc.title;
      if (!title?.trim()) throw new Error("no direct title");
      return title.trim();
    });

  const fromMirror = async () =>
    withTimeout(7000, async () => {
      const mirror = await fetch(`https://r.jina.ai/${rawUrl}`);
      if (!mirror.ok) throw new Error("mirror not ok");
      const content = await mirror.text();
      const siteSpecificTitle = extractTitleWithModel(content, siteModel);
      if (!siteSpecificTitle) throw new Error("no mirror title");
      return siteSpecificTitle;
    });

  try {
    // Run both sources in parallel and take whichever resolves first.
    return await Promise.any([fromDirect(), fromMirror()]);
  } catch {
    // Ignore and use URL-derived fallback.
  }

  return titleFromUrlPath(rawUrl);
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
  const suffixPattern =
    /\s*,?\s*(incorporated|inc|corporation|corp|company|co|llc|l\.l\.c|ltd|limited|plc|gmbh|s\.a\.|s\.a|ag)\.?$/i;
  let normalized = deSpacedWithWordBoundaries;
  while (suffixPattern.test(normalized)) {
    normalized = normalized.replace(suffixPattern, "").trim();
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return normalized;
  return words.slice(0, 3).join(" ");
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

function cleanJobTitleText(rawTitle) {
  return (rawTitle || "")
    .replace(/\s+/g, " ")
    .replace(/[|].*$/, "")
    .replace(/[-–]\s*(careers?|jobs?)$/i, "")
    .trim();
}

function washJobTitle(rawTitle) {
  const title = cleanJobTitleText(rawTitle);
  if (!title) return "";

  const nounSet = new Set([
    "engineer",
    "assistant",
    "officer",
    "administrator",
    "developer",
    "representative",
    "manager",
    "accountant",
    "planner",
    "analyst",
    "specialist",
    "coordinator",
    "architect",
    "technician",
    "consultant",
    "director",
    "lead",
  ]);

  const adjectiveSet = new Set([
    "database",
    "software",
    "web",
    "mechanical",
    "civil",
    "administrative",
    "executive",
    "peoplesoft",
    "oracle",
    "full-stack",
    "office",
    "county",
    "lead",
    "jr",
    "senior",
    "sr",
    "field",
    "systems",
    "system",
    "information",
    "security",
    "clinical",
  ]);
  const levelPrefixSet = new Set(["jr", "sr", "senior", "lead", "principal", "staff"]);
  const levelSuffixSet = new Set(["i", "ii", "iii", "iv", "v", "1", "2", "3", "4", "5"]);

  const normalized = title
    .replace(/[()]/g, " ")
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 2) return toTitleCasePhrase(words.join(" "));
  if (words.length <= 3) return toTitleCasePhrase(words.join(" "));

  // Find first noun anchor and collect compact adjective + noun (+ optional level).
  let nounIndex = words.findIndex((word) => nounSet.has(word.toLowerCase()));
  if (nounIndex < 0) nounIndex = words.length - 1;

  const picked = [];
  const before = words.slice(0, nounIndex);

  // Prefer one level prefix (Lead/Jr/Sr/etc.) when present.
  const levelPrefix = before.find((w) => levelPrefixSet.has(w.toLowerCase()));
  if (levelPrefix) picked.push(levelPrefix);

  // Prefer one strong adjective closest to noun.
  let adjectiveCandidate = "";
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const w = before[i].toLowerCase();
    if (adjectiveSet.has(w) || w.length > 3) {
      adjectiveCandidate = before[i];
      break;
    }
  }
  if (adjectiveCandidate && !picked.some((w) => w.toLowerCase() === adjectiveCandidate.toLowerCase())) {
    picked.push(adjectiveCandidate);
  }

  // Core noun (Engineer, Developer, Nurse, etc.).
  picked.push(words[nounIndex]);

  // Optional level suffix right after noun: II/III/2/etc.
  const nextWord = words[nounIndex + 1];
  if (nextWord && levelSuffixSet.has(nextWord.toLowerCase())) {
    picked.push(nextWord.toUpperCase());
  }

  // Final title: keep concise output at 3 words max.
  const compact = picked.filter(Boolean);
  const maxWords = 3;
  return toTitleCasePhrase(compact.slice(0, maxWords).join(" "));
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
  // Run title lookup and mirror lookup at the same time so we do not stack delays.
  // Use allSettled so any rejection is consumed and never bubbles as an uncaught promise.
  const [titleResult, mirrorResult] = await Promise.allSettled([
    fetchJobTitleFromUrl(rawUrl),
    withTimeout(5000, async () => {
      const mirror = await fetch(`https://r.jina.ai/${rawUrl}`);
      if (!mirror.ok) throw new Error("mirror not ok");
      return mirror.text();
    }),
  ]);

  const title = titleResult.status === "fulfilled" ? titleResult.value : titleFromUrlPath(rawUrl);
  let company = "";
  let skills = [];

  try {
    if (mirrorResult.status !== "fulfilled") throw new Error("mirror unavailable");
    const content = mirrorResult.value;
    skills = extractTopSkillsFromText(content);
    company = extractCompanyFromContent(content, rawUrl, title);
  } catch {
    // Mirror can be slow or blocked; keep best-effort behavior.
  }

  if (!company) {
    company = companyFromUrl(rawUrl);
  }

  return { title, company, skills };
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

// Basic word counter used for quick stats in the UI.
function toWordCount(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

// Read all unique token keys used in the template.
function extractTokens(template) {
  const keys = new Set();
  let match = TOKEN_REGEX.exec(template);
  while (match) {
    keys.add(match[1].toLowerCase());
    match = TOKEN_REGEX.exec(template);
  }
  TOKEN_REGEX.lastIndex = 0;
  return [...keys];
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

function App() {
  // Refs let us access real DOM nodes (editor and hidden file input).
  const editorRef = useRef(null);
  const importProjectRef = useRef(null);
  const startupTimerRef = useRef(null);
  const isSyncingEditorRef = useRef(false);
  const jobUrlLookupRef = useRef(0);

  // Main app state: template text, fields, UI mode, and status messages.
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [activeTab, setActiveTab] = useState("editor");
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isResolvingJobTitle, setIsResolvingJobTitle] = useState(false);
  // Demo startup state for the Start/Stop controls.
  const [startupPhase, setStartupPhase] = useState("idle");
  const [startupProgress, setStartupProgress] = useState(0);

  // On first render, restore autosaved data from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.template === "string") setTemplate(parsed.template);
      if (Array.isArray(parsed.fields) && parsed.fields.length > 0) {
        setFields(parsed.fields);
      }
    } catch {
      setError("Autosave data could not be loaded.");
    }
  }, []);

  // Any time template or fields change, autosave the project.
  useEffect(() => {
    const payload = JSON.stringify({ template, fields });
    localStorage.setItem(STORAGE_KEY, payload);
  }, [template, fields]);

  // Keyboard shortcut: Ctrl/Cmd + S downloads the final rendered letter.
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        // Build a quick key->value map from current fields.
        const { rendered } = renderTemplate(template, Object.fromEntries(fields.map((f) => [f.key, f.value.trim()])));
        downloadTextFile(rendered, "cover-letter-final.txt");
        setNotice("Final letter downloaded.");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fields, template]);

  // Memoized map keeps token lookups fast while typing.
  const valueByKey = useMemo(() => {
    // In simple mode (advanced hidden), field label can act as value fallback.
    const base = Object.fromEntries(
      fields.map((field) => [field.key.toLowerCase(), field.value.trim() || field.label.trim()])
    );
    const rawJobUrl = base.job_url;
    const refTitle = base.job_listing_ref_title;
    const fallbackTitle = rawJobUrl && isHttpUrl(rawJobUrl) ? titleFromUrlPath(rawJobUrl) : "";
    if (refTitle) base.ref = refTitle;
    else if (fallbackTitle) base.ref = fallbackTitle;
    return base;
  }, [fields]);

  // Recompute preview text and missing tokens whenever inputs change.
  const { rendered, unresolved } = useMemo(() => renderTemplate(template, valueByKey), [template, valueByKey]);
  const tokensInTemplate = useMemo(() => extractTokens(template), [template]);
  const labelByKey = useMemo(
    () =>
      Object.fromEntries(
        fields.map((field) => [field.key.toLowerCase(), field.label || FIELD_LABEL_SUGGESTIONS[field.key] || field.key])
      ),
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
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setNotice("");
    setIsLoadingFile(true);
    try {
      // Plain text file: read directly.
      if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
        const text = await file.text();
        setTemplate(text);
        setNotice(`Loaded ${file.name}.`);
      // PDF file: extract text page-by-page.
      } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const text = await readPdfAsText(file);
        setTemplate(text);
        setNotice(`Extracted template from ${file.name}.`);
      } else {
        setError("Supported file types are .txt and .pdf.");
      }
    } catch {
      setError("Could not read this file.");
    } finally {
      setIsLoadingFile(false);
      event.target.value = "";
    }
  };

  // Update one property on one field card.
  const updateField = (id, key, value) => {
    setFields((prev) => prev.map((field) => (field.id === id ? { ...field, [key]: value } : field)));
  };

  const setFieldLabelByKey = (fieldKey, label) => {
    setFields((prev) =>
      prev.map((field) => (field.key === fieldKey ? { ...field, label } : field))
    );
  };

  const setFieldLabelAndValueByKey = (fieldKey, nextValue) => {
    const normalized = normalizeFieldValue(nextValue);
    setFields((prev) =>
      prev.map((field) =>
        field.key === fieldKey ? { ...field, label: normalized, value: normalized } : field
      )
    );
  };

  const resolveJobReferenceFromUrl = async (rawUrl) => {
    const url = rawUrl.trim();
    if (!isHttpUrl(url)) return;

    const requestId = Date.now();
    jobUrlLookupRef.current = requestId;
    setIsResolvingJobTitle(true);
    setFieldLabelAndValueByKey("job_url", url);
    // Instant prefill from URL slug so the UI updates immediately.
    const instantTitleCandidate = titleFromUrlPath(url);
    const canUseInstantTitle = instantTitleCandidate && !isNumericOnlyTitle(instantTitleCandidate);
    const instantTitle = canUseInstantTitle ? (washJobTitle(instantTitleCandidate) || instantTitleCandidate) : "";
    const instantSkills = canUseInstantTitle ? inferSkillsFromTitle(instantTitle).slice(0, 3) : [];
    if (canUseInstantTitle && instantTitle) {
      setFieldLabelAndValueByKey("job_listing_ref_title", instantTitle);
      setFieldLabelAndValueByKey("position_title", instantTitle);
    }
    if (instantSkills[0]) setFieldLabelAndValueByKey("pos_skill_1", instantSkills[0]);
    if (instantSkills[1]) setFieldLabelAndValueByKey("pos_skill_2", instantSkills[1]);
    if (instantSkills[2]) setFieldLabelAndValueByKey("pos_skill_3", instantSkills[2]);
    setNotice("Job URL committed. Refining details...");
    setError("");

    try {
      const { title, company, skills } = await fetchJobInsightsFromUrl(url);
      if (jobUrlLookupRef.current !== requestId) return;
      const rawResolvedTitle = cleanJobTitleText(title) || title;
      const washedTitle = washJobTitle(rawResolvedTitle) || rawResolvedTitle;
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

      // Apply raw title first, then wash as a quick second pass.
      setFieldLabelAndValueByKey("job_listing_ref_title", rawResolvedTitle);
      setFieldLabelAndValueByKey("position_title", rawResolvedTitle);
      if (washedTitle && washedTitle !== rawResolvedTitle) {
        setTimeout(() => {
          if (jobUrlLookupRef.current !== requestId) return;
          setFieldLabelAndValueByKey("job_listing_ref_title", washedTitle);
          setFieldLabelAndValueByKey("position_title", washedTitle);
        }, 120);
      }
      if (company) setFieldLabelAndValueByKey("company_name", company);
      if (washedSkills[0]) setFieldLabelAndValueByKey("pos_skill_1", washedSkills[0]);
      if (washedSkills[1]) setFieldLabelAndValueByKey("pos_skill_2", washedSkills[1]);
      if (washedSkills[2]) setFieldLabelAndValueByKey("pos_skill_3", washedSkills[2]);
      setNotice("Job details populated from URL.");
      setError("");
    } catch {
      if (jobUrlLookupRef.current !== requestId) return;
      setError("Could not fetch job title from URL.");
    } finally {
      if (jobUrlLookupRef.current === requestId) {
        setIsResolvingJobTitle(false);
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

  // Restore template + fields to starter defaults.
  const resetAll = () => {
    setTemplate(DEFAULT_TEMPLATE);
    setFields(DEFAULT_FIELDS);
    setNotice("Reset to default template.");
    setError("");
  };

  // Save whole project (template + fields) as JSON.
  const exportProject = () => {
    const payload = JSON.stringify({ template, fields }, null, 2);
    downloadTextFile(payload, "cover-letter-project.json");
    setNotice("Project exported.");
  };

  // Load a previously exported JSON project file.
  const importProject = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed.template !== "string" || !Array.isArray(parsed.fields)) {
        throw new Error("Invalid project");
      }
      setTemplate(parsed.template);
      setFields(parsed.fields);
      setNotice("Project imported.");
    } catch {
      setError("Invalid project file.");
    } finally {
      event.target.value = "";
    }
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

  // Stop any running startup timer to avoid multiple timers at once.
  const clearStartupTimer = () => {
    if (startupTimerRef.current) {
      clearInterval(startupTimerRef.current);
      startupTimerRef.current = null;
    }
  };

  // Demo "start script": shows staged progress until app is ready.
  const startCoverAI = () => {
    clearStartupTimer();
    setStartupPhase("running");
    setStartupProgress(0);
    setError("");
    setNotice("Starting CoverAI services...");

    startupTimerRef.current = setInterval(() => {
      setStartupProgress((prev) => {
        const next = Math.min(prev + Math.floor(Math.random() * 12) + 8, 100);
        if (next >= 100) {
          clearStartupTimer();
          setStartupPhase("ready");
          setNotice("CoverAI is fully started.");
        }
        return next;
      });
    }, 280);
  };

  // Demo "stop script": halts startup/readiness and resets progress.
  const stopCoverAI = () => {
    clearStartupTimer();
    setStartupPhase("stopped");
    setStartupProgress(0);
    setNotice("CoverAI stopped.");
    setError("");
  };

  // Cleanup timer if user leaves page/component.
  useEffect(() => () => clearStartupTimer(), []);

  const isRunning = startupPhase === "running";
  const isReady = startupPhase === "ready";
  const startupLabel =
    startupPhase === "ready"
      ? "Ready"
      : startupPhase === "running"
      ? "Starting..."
      : startupPhase === "stopped"
      ? "Stopped"
      : "Idle";

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
          <button type="button" className="button" onClick={startCoverAI} disabled={isRunning}>
            Start CoverAI
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={stopCoverAI}
            disabled={startupPhase === "idle" || startupPhase === "stopped"}
          >
            Stop CoverAI
          </button>
          <label className="button secondary">
            Import .txt/.pdf
            <input type="file" accept=".txt,.pdf" onChange={handleFileUpload} hidden disabled={!isReady} />
          </label>
          <button type="button" className="button secondary" onClick={exportProject} disabled={!isReady}>
            Export Project
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => importProjectRef.current?.click()}
            disabled={!isReady}
          >
            Import Project
          </button>
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
        {!isReady && <p>Press Start CoverAI to initialize the demo workflow.</p>}
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
              <button
                type="button"
                className="button"
                onClick={() => downloadTextFile(template, "cover-letter-template.txt")}
                disabled={!isReady}
              >
                Download Template
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
            <pre className="preview">{rendered}</pre>
          )}

          <div className="panel-footer">
            <div className="stats">
              <span>{stats.templateWords} template words</span>
              <span>{stats.finalWords} final words</span>
              <span>{stats.characters} characters</span>
              <span>{stats.unresolved} unresolved tokens</span>
            </div>
            <span className="shortcut">Shortcut: Ctrl/Cmd + S downloads final text</span>
          </div>
        </section>

        {/* Right side: token controls and editable field values. */}
        <aside className="panel side-panel">
          <div className="side-top">
            <h2>Fields</h2>
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

          <div className="token-grid">
            {fields.map((field) => (
              <button
                type="button"
                key={`token_${field.id}`}
                className="token"
                draggable
                onDragStart={(event) => handleTokenDragStart(event, field.key)}
                onClick={() => insertTokenAtCursor(field.key)}
                title={`Insert token {{${field.key}}}`}
                disabled={!isReady}
              >
                {field.label || getFieldLabelSuggestion(field.key)}
              </button>
            ))}
          </div>

          <div className="field-list">
            {fields.map((field) => (
              <div className="field-card" key={field.id}>
                <div className="field-header">
                  <input
                    className="field-input field-label-input"
                    value={field.label}
                    onChange={(event) => updateField(field.id, "label", event.target.value)}
                    onPaste={(event) => {
                      if (field.key !== "job_url") return;
                      const pasted = event.clipboardData.getData("text/plain") || "";
                      if (!isHttpUrl(pasted)) return;
                      event.preventDefault();
                      const pastedUrl = pasted.trim();
                      setFieldLabelByKey("job_url", pastedUrl);
                      resolveJobReferenceFromUrl(pasted);
                    }}
                    onBlur={(event) => {
                      if (field.key !== "job_url") return;
                      const entered = event.target.value.trim();
                      if (!isHttpUrl(entered)) return;
                      resolveJobReferenceFromUrl(entered);
                    }}
                    onKeyDown={(event) => {
                      if (field.key !== "job_url") return;
                      if (event.key !== "Enter") return;
                      const entered = event.currentTarget.value.trim();
                      if (!isHttpUrl(entered)) return;
                      event.preventDefault();
                      resolveJobReferenceFromUrl(entered);
                    }}
                    onFocus={(event) => event.target.select()}
                    disabled={!isReady}
                    placeholder={getFieldLabelSuggestion(field.key)}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Delete field"
                    title="Delete field"
                    onClick={() => deleteField(field.id)}
                    disabled={!isReady}
                  >
                    x
                  </button>
                </div>
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

          <div className="insights">
            <h3>Token insights</h3>
            {tokensInTemplate.length === 0 ? (
              <p>No tokens in template yet.</p>
            ) : (
              <ul>
                {tokensInTemplate.map((token) => (
                  <li key={token} className={valueByKey[token] ? "filled" : "missing"}>
                    {token}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </main>

      {/* Small status area for success/error/loading feedback. */}
      {(notice || error || isLoadingFile || isResolvingJobTitle) && (
        <div className="status-row" role="status" aria-live="polite">
          {isLoadingFile && <span>Loading file...</span>}
          {isResolvingJobTitle && <span>Resolving job title...</span>}
          {notice && <span className="ok">{notice}</span>}
          {error && <span className="err">{error}</span>}
        </div>
      )}
    </div>
  );
}

export default App;
