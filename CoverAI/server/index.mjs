import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVER_DIR, "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env");

function loadLocalEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

loadLocalEnvFile(ENV_FILE);

const HOST = process.env.AI_API_HOST || "127.0.0.1";
const PORT = Number(process.env.AI_API_PORT || 4000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || 45000);
const LOG_REQUESTS = /^(1|true|yes)$/i.test(process.env.AI_LOG_REQUESTS || "");
const CHROME_EXECUTABLE_PATH =
  process.env.CHROME_EXECUTABLE_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_USER_DATA_DIR =
  process.env.CHROME_USER_DATA_DIR || "/Users/jcalibre/Library/Application Support/Google/Chrome";
const CHROME_PROFILE_DIRECTORY = process.env.CHROME_PROFILE_DIRECTORY || "Default";
const START_SCRIPT = path.join(PROJECT_ROOT, "start-coverai.command");
const STOP_SCRIPT = path.join(PROJECT_ROOT, "stop-coverai.command");
const APP_PID_FILE = path.join(PROJECT_ROOT, ".coverai.pid");
const APP_PORT_FILE = path.join(PROJECT_ROOT, ".coverai.port");
const API_PID_FILE = path.join(PROJECT_ROOT, ".coverai.api.pid");
const API_PORT_FILE = path.join(PROJECT_ROOT, ".coverai.api.port");

const ALLOWED_FIELD_KEYS = new Set([
  "company_name",
  "position_title",
  "job_listing_ref_title",
  "job_listing_ref_url",
  "job_url",
  "pos_skill_1",
  "pos_skill_2",
  "pos_skill_3",
  "hiring_manager",
  "prev_company",
  "my_skill_1",
  "my_skill_2",
  "my_skill_3",
  "additional_exp_1",
  "additional_exp_2",
  "ref",
  "my_signature",
]);

function json(response, status = 200) {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(response),
  };
}

function send(res, response) {
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeMultiline(value) {
  return (value || "").replace(/\r\n/g, "\n").trim();
}

function fieldsToMap(fields) {
  if (!Array.isArray(fields)) return {};
  return Object.fromEntries(
    fields
      .filter((field) => field && typeof field.key === "string")
      .map((field) => [
        field.key,
        {
          label: normalizeText(field.label || ""),
          value: normalizeText(field.value || ""),
        },
      ])
  );
}

function sanitizeFieldSuggestions(input) {
  const result = {};
  const source = input && typeof input === "object" ? input : {};
  for (const [key, rawValue] of Object.entries(source)) {
    if (!ALLOWED_FIELD_KEYS.has(key)) continue;
    const normalized = key === "my_signature" ? normalizeMultiline(String(rawValue || "")) : normalizeText(String(rawValue || ""));
    if (!normalized) continue;
    result[key] = normalized;
  }
  return result;
}

function ensureSkillSuggestions(fieldSuggestions, skills) {
  const cleanSkills = Array.isArray(skills)
    ? [...new Set(skills.map((skill) => normalizeText(skill)).filter(Boolean))]
    : [];
  cleanSkills.slice(0, 3).forEach((skill, index) => {
    fieldSuggestions[`pos_skill_${index + 1}`] = fieldSuggestions[`pos_skill_${index + 1}`] || skill;
  });
  return cleanSkills.slice(0, 3);
}

function readFileTrimmed(filePath) {
  try {
    if (!existsSync(filePath)) return "";
    return String(readFileSync(filePath, "utf8")).trim();
  } catch {
    return "";
  }
}

function pidIsRunning(pidText) {
  const pid = Number(pidText);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getControlStatus() {
  const appPid = readFileTrimmed(APP_PID_FILE);
  const appPort = readFileTrimmed(APP_PORT_FILE);
  const apiPid = readFileTrimmed(API_PID_FILE);
  const apiPort = readFileTrimmed(API_PORT_FILE);
  const appRunning = pidIsRunning(appPid);
  const apiRunning = pidIsRunning(apiPid);
  return {
    app: {
      pid: appPid || "",
      port: appPort || "",
      running: appRunning,
    },
    api: {
      pid: apiPid || "",
      port: apiPort || String(PORT),
      running: apiRunning,
    },
    allRunning: appRunning && apiRunning,
    anyRunning: appRunning || apiRunning,
  };
}

function launchDetachedShell(command, extraEnv = {}) {
  const child = spawn("bash", ["-lc", command], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  child.unref();
}

function extractJsonObject(rawText) {
  const text = String(rawText || "").trim();
  if (!text) throw new Error("Model returned an empty response.");
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Model response did not contain JSON.");
  }
  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJobSource(jobUrl) {
  if (!jobUrl) return "";

  const attempts = [
    async () => {
      const response = await fetchWithTimeout(`https://r.jina.ai/${jobUrl}`);
      if (!response.ok) throw new Error(`Mirror fetch failed with ${response.status}`);
      return response.text();
    },
    async () => {
      const response = await fetchWithTimeout(jobUrl, {
        headers: {
          "User-Agent": "CoverAI/2.0 (+local-ai-helper)",
        },
      });
      if (!response.ok) throw new Error(`Direct fetch failed with ${response.status}`);
      return response.text();
    },
  ];

  for (const attempt of attempts) {
    try {
      const text = await attempt();
      if (normalizeText(text)) return text;
    } catch {
      // Try the next fallback.
    }
  }
  return "";
}

function buildDataUrl(buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function captureViewportPreview(page, label, excerpt = "") {
  try {
    const image = await page.screenshot({ type: "png" });
    return {
      label,
      excerptLabel: label.toLowerCase().replace(/\s+/g, "_"),
      excerpt: normalizeText(excerpt),
      imageDataUrl: buildDataUrl(image),
    };
  } catch {
    return null;
  }
}

async function scrollToLocator(page, locator) {
  try {
    const count = await locator.count();
    if (!count) return { found: false, excerpt: "" };
    const target = locator.first();
    await target.scrollIntoViewIfNeeded();
    const excerpt = await target.evaluate((node) => {
      const text = node?.textContent || "";
      return text.replace(/\s+/g, " ").trim().slice(0, 700);
    });
    return { found: true, excerpt: normalizeText(excerpt) };
  } catch {
    return { found: false, excerpt: "" };
  }
}

async function captureTitleAreaPreview(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(80);
  const headingResult = await scrollToLocator(page, page.locator("h1, [role='heading'][aria-level='1'], main h2, article h2"));
  await page.waitForTimeout(80);
  return captureViewportPreview(page, "Title area", headingResult.excerpt || "Top page screenshot.");
}

async function captureSkillsAreaPreview(page) {
  const sectionResult = await scrollToLocator(
    page,
    page.locator(
      "text=/Qualifications|Requirements|Skills|Preferred Qualifications|Minimum Qualifications|What You'll Need|What you will need|Experience Required/i"
    )
  );
  if (sectionResult.found) {
    await page.waitForTimeout(120);
    return captureViewportPreview(page, "Skills section", sectionResult.excerpt);
  }

  const mainRegion = page.locator("main, article, [role='main']").first();
  try {
    const count = await mainRegion.count();
    if (count) {
      await mainRegion.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const main = document.querySelector("main, article, [role='main']");
        if (main) {
          const rect = main.getBoundingClientRect();
          window.scrollBy({ top: rect.top + window.scrollY + Math.max(300, rect.height * 0.3) - window.scrollY, behavior: "instant" });
        }
      });
      await page.waitForTimeout(120);
      const excerpt = await mainRegion.evaluate((node) => {
        const text = node?.textContent || "";
        return text.replace(/\s+/g, " ").trim().slice(0, 900);
      });
      return captureViewportPreview(page, "Skills section", excerpt);
    }
  } catch {
    // Fall through to viewport fallback.
  }

  await page.evaluate(() => window.scrollTo({ top: Math.max(window.innerHeight * 0.8, 500), behavior: "instant" }));
  await page.waitForTimeout(120);
  return captureViewportPreview(page, "Skills section", "Mid-page screenshot.");
}

async function openCaptureSession(useCurrentBrowserSession = false) {
  const sharedOptions = {
    viewport: { width: 1440, height: 2200 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  };

  if (useCurrentBrowserSession) {
    try {
      const context = await chromium.launchPersistentContext(CHROME_USER_DATA_DIR, {
        headless: true,
        executablePath: CHROME_EXECUTABLE_PATH,
        ...sharedOptions,
        args: [`--profile-directory=${CHROME_PROFILE_DIRECTORY}`],
      });
      const page = context.pages()[0] || (await context.newPage());
      return {
        context,
        page,
        sessionMode: "current_chrome_session",
        notes: [`Using Chrome profile: ${CHROME_PROFILE_DIRECTORY}`],
      };
    } catch (error) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: CHROME_EXECUTABLE_PATH,
      });
      const page = await browser.newPage(sharedOptions);
      return {
        browser,
        page,
        sessionMode: "guest_fallback",
        notes: [
          `Current Chrome session could not be attached: ${normalizeText(error?.message || "unknown error")}`,
          "Fell back to a fresh guest browser session.",
        ],
      };
    }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_EXECUTABLE_PATH,
  });
  const page = await browser.newPage(sharedOptions);
  return {
    browser,
    page,
    sessionMode: "guest",
    notes: [],
  };
}

async function captureJobPage(jobUrl, options = {}) {
  if (!jobUrl) {
    return {
      pageTitle: "",
      visibleText: "",
      screenshots: [],
      captureNotes: ["No job URL provided."],
      sessionMode: "none",
    };
  }

  const { browser, context, page, sessionMode, notes } = await openCaptureSession(Boolean(options.useCurrentBrowserSession));
  try {
    await page.goto(jobUrl, {
      waitUntil: "commit",
      timeout: REQUEST_TIMEOUT_MS,
    });
    const titlePreview = await captureTitleAreaPreview(page);
    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(5000, REQUEST_TIMEOUT_MS) }).catch(() => {});
    await page.waitForTimeout(180);
    const pageTitle = normalizeText(await page.title());
    const visibleText = normalizeMultiline(
      await page.evaluate(() => (document.body?.innerText || "").replace(/\u00a0/g, " "))
    );
    const skillsPreview = await captureSkillsAreaPreview(page);

    return {
      pageTitle,
      visibleText,
      screenshots: [titlePreview, skillsPreview].filter(Boolean),
      captureNotes: notes,
      sessionMode,
    };
  } finally {
    if (context) {
      await context.close();
    } else if (browser) {
      await browser.close();
    }
  }
}

async function callModelJson({ system, user, temperature = 0.2 }) {
  if (!OPENAI_API_KEY) {
    const error = new Error("AI provider is not configured. Set OPENAI_API_KEY before using CoverAI AI features.");
    error.status = 503;
    error.code = "ai_not_configured";
    throw error;
  }

  const userContent = Array.isArray(user)
    ? user
    : [
        {
          type: "text",
          text: String(user || ""),
        },
      ];

  const payload = {
    model: OPENAI_MODEL,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  };

  if (LOG_REQUESTS) {
    console.log("[coverai-ai] request", JSON.stringify({ model: OPENAI_MODEL, temperature }));
  }

  const response = await fetchWithTimeout(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`Provider request failed with ${response.status}: ${details.slice(0, 400)}`);
    error.status = 502;
    error.code = "provider_error";
    throw error;
  }

  const parsed = await response.json();
  const content = parsed?.choices?.[0]?.message?.content || "";
  return extractJsonObject(content);
}

function buildExtractPrompt({ jobUrl, jobText, fieldMap, imageOnly = false }) {
  return `
You are helping CoverAI extract structured job application data.

Return JSON only with this exact top-level shape:
{
  "answers": {
    "job_title": "",
    "company_name": "",
    "contact_name": "",
    "contact_title": "",
    "top_qualifications": ["", "", ""],
    "top_skills": ["", "", ""],
    "job_duties": ["", "", "", ""],
    "qualifications_section_excerpt": "",
    "skills_section_excerpt": ""
  },
  "fieldSuggestions": {
    "company_name": "",
    "position_title": "",
    "job_listing_ref_title": "",
    "job_listing_ref_url": "",
    "job_url": "",
    "pos_skill_1": "",
    "pos_skill_2": "",
    "pos_skill_3": ""
  },
  "skills": ["", "", ""],
  "sourceSummary": "",
  "confidence": "high|medium|low",
  "notes": ""
}

Rules:
- Answer the questions the way a careful human reviewer would after reviewing the provided evidence.
- job_title should be the real role title only.
- company_name should be the employer shown on the posting, not the job board unless the board is clearly the employer.
- contact_name and contact_title should be visible recruiter or hiring-team details only when they are explicitly shown.
- top_qualifications should be the 3 most significant qualifications, each in 3 words or less when possible.
- top_skills should be concise and grounded in the source.
- job_duties should be short plain-language bullets without numbering.
- qualifications_section_excerpt and skills_section_excerpt should be short raw excerpts from the most relevant sections when available.
- Keep each suggested field concise and human-readable.
- position_title must be only the actual role title, without employer, board name, location, requisition text, or marketing copy.
- company_name must be regular title/camel case and trimmed to the core brand name. Remove suffixes or fluff such as corp, llc, inc, technologies, systems, industries, group, services, company, solutions, holdings, partners, and international.
- Use empty strings when data is unknown.
- Keep skills short, ideally 1-4 words each.
- Do not invent employer or role names not grounded in the source.
- If a URL is provided, preserve it in job_url and job_listing_ref_url when appropriate.
- sourceSummary should be 1-2 sentences max.
- notes should briefly mention ambiguity or missing details when relevant.
${imageOnly ? "- IMPORTANT: Use only the screenshot images as extraction evidence for the job data and fieldSuggestions. Do not use page text, fetched source, browser title, or URL text to decide title/company/skills unless the same information is visibly present in the screenshots." : ""}

Current app field context:
${JSON.stringify(fieldMap, null, 2)}

Job URL:
${jobUrl || "(none provided)"}

${imageOnly ? "Job text or fetched source:\n(omit from reasoning when screenshots are present)" : `Job text or fetched source:\n${jobText || "(none provided)"}`}
`.trim();
}

function buildExtractUserContent({ jobUrl, jobText, fieldMap, screenshots }) {
  const hasScreenshots = Array.isArray(screenshots) && screenshots.some((shot) => shot?.imageDataUrl);
  const content = [
    {
      type: "text",
      text: buildExtractPrompt({ jobUrl, jobText, fieldMap, imageOnly: hasScreenshots }),
    },
  ];

  (Array.isArray(screenshots) ? screenshots : [])
    .filter((shot) => shot?.imageDataUrl)
    .forEach((shot) => {
      content.push({
        type: "text",
        text: `Screenshot label: ${shot.label || "Page preview"}\nVisible excerpt: ${shot.excerpt || "(none)"}`,
      });
      content.push({
        type: "image_url",
        image_url: {
          url: shot.imageDataUrl,
        },
      });
    });

  if (!hasScreenshots) {
    content.push({
      type: "text",
      text: `Fallback text evidence:\n${jobText || "(none provided)"}`,
    });
  }

  return content;
}

function buildDraftPrompt({ template, fieldMap, selectedStyle, resumeText, extractedJob }) {
  return `
You are drafting a tailored cover letter for the CoverAI application.

Return JSON only with this exact top-level shape:
{
  "draft": "",
  "fieldSuggestions": {
    "company_name": "",
    "position_title": "",
    "job_listing_ref_title": "",
    "job_url": "",
    "pos_skill_1": "",
    "pos_skill_2": "",
    "pos_skill_3": "",
    "my_skill_1": "",
    "my_skill_2": "",
    "my_skill_3": "",
    "additional_exp_1": "",
    "additional_exp_2": ""
  },
  "notes": "",
  "warnings": []
}

Rules:
- draft must be plain text, not markdown.
- Keep the draft aligned with the user's current template style and tone.
- Use the provided field values and job context; do not fabricate biography details beyond the resume/profile text.
- fieldSuggestions should only include concise values worth reviewing; use empty strings for unknowns.
- warnings should be a short array of caution notes if important source information is missing or uncertain.
- notes should be 1-3 sentences and explain the main tailoring choices.

Selected style:
${selectedStyle || "eng"}

Current template:
${template || ""}

Current fields:
${JSON.stringify(fieldMap, null, 2)}

Extracted job context:
${JSON.stringify(extractedJob || {}, null, 2)}

Resume or profile context:
${resumeText || "(none provided)"}
`.trim();
}

async function handleExtractJob(body) {
  const fieldMap = fieldsToMap(body.fields);
  const jobUrl = normalizeText(body.jobUrl);
  const browserCapture =
    !normalizeMultiline(body.jobText) && jobUrl
      ? await captureJobPage(jobUrl, { useCurrentBrowserSession: Boolean(body.useCurrentBrowserSession) })
      : null;
  const fetchedSource = !normalizeMultiline(body.jobText) && jobUrl ? await fetchJobSource(jobUrl) : "";
  const jobText =
    normalizeMultiline(body.jobText) ||
    normalizeMultiline(browserCapture?.visibleText) ||
    normalizeMultiline(fetchedSource);
  const screenshotArtifacts = Array.isArray(browserCapture?.screenshots) ? browserCapture.screenshots : [];

  if (!OPENAI_API_KEY) {
    return {
      ok: true,
      source: "ai_not_configured_capture_only",
      job_url: jobUrl,
      answers: {
        job_title: "",
        company_name: "",
        contact_name: "",
        contact_title: "",
        top_qualifications: [],
        top_skills: [],
        job_duties: [],
        qualifications_section_excerpt: screenshotArtifacts.find((item) => item.excerptLabel === "skills_excerpt")?.excerpt || "",
        skills_section_excerpt: screenshotArtifacts.find((item) => item.excerptLabel === "skills_excerpt")?.excerpt || "",
      },
      fieldSuggestions: {},
      skills: [],
      sourceSummary: "Browser capture complete. AI extraction did not run because OPENAI_API_KEY is not configured for the backend.",
      confidence: "low",
      notes: [browserCapture?.pageTitle ? `Captured page title: ${browserCapture.pageTitle}` : "No page title captured.", ...(browserCapture?.captureNotes || [])]
        .filter(Boolean)
        .join(" "),
      screenshots: screenshotArtifacts,
      errorCode: "ai_not_configured",
      browserCapture: {
        pageTitle: browserCapture?.pageTitle || "",
        visibleTextLength: jobText.length,
        sessionMode: browserCapture?.sessionMode || "none",
        captureNotes: browserCapture?.captureNotes || [],
      },
      fetchedSourceLength: jobText.length,
    };
  }

  const modelResult = await callModelJson({
    system:
      "You extract structured recruiting data for a local cover-letter tool. Return valid JSON only and stay grounded in the supplied evidence. When screenshot images are present, map visible image content directly into fields and answers. Only fall back to text when no screenshots are available.",
    user: buildExtractUserContent({
      jobUrl,
      jobText,
      fieldMap,
      screenshots: screenshotArtifacts,
    }),
    temperature: 0.1,
  });

  const fieldSuggestions = sanitizeFieldSuggestions(modelResult.fieldSuggestions);
  const skills = ensureSkillSuggestions(fieldSuggestions, modelResult.skills);
  const answersSource = modelResult.answers && typeof modelResult.answers === "object" ? modelResult.answers : {};
  const answers = {
    job_title: normalizeText(answersSource.job_title),
    company_name: normalizeText(answersSource.company_name),
    contact_name: normalizeText(answersSource.contact_name),
    contact_title: normalizeText(answersSource.contact_title),
    top_qualifications: Array.isArray(answersSource.top_qualifications)
      ? answersSource.top_qualifications.map((item) => normalizeText(String(item))).filter(Boolean).slice(0, 3)
      : [],
    top_skills: Array.isArray(answersSource.top_skills)
      ? answersSource.top_skills.map((item) => normalizeText(String(item))).filter(Boolean).slice(0, 3)
      : [],
    job_duties: Array.isArray(answersSource.job_duties)
      ? answersSource.job_duties.map((item) => normalizeText(String(item))).filter(Boolean).slice(0, 6)
      : [],
    qualifications_section_excerpt: normalizeMultiline(answersSource.qualifications_section_excerpt).slice(0, 1000),
    skills_section_excerpt: normalizeMultiline(answersSource.skills_section_excerpt).slice(0, 1000),
  };
  if (normalizeText(body.jobUrl)) {
    fieldSuggestions.job_url = fieldSuggestions.job_url || jobUrl;
    fieldSuggestions.job_listing_ref_url = fieldSuggestions.job_listing_ref_url || jobUrl;
  }

  return {
    ok: true,
    source: "ai_extract_job",
    job_url: jobUrl,
    answers,
    fieldSuggestions,
    skills,
    sourceSummary: normalizeText(modelResult.sourceSummary),
    confidence: ["high", "medium", "low"].includes(modelResult.confidence) ? modelResult.confidence : "medium",
    notes: normalizeText(modelResult.notes),
    screenshots: screenshotArtifacts,
    extractionMode: screenshotArtifacts.length > 0 ? "image_only_fields_from_screenshots" : "text_only",
    browserCapture: {
      pageTitle: browserCapture?.pageTitle || "",
      visibleTextLength: jobText.length,
      sessionMode: browserCapture?.sessionMode || "none",
      captureNotes: browserCapture?.captureNotes || [],
    },
    fetchedSourceLength: jobText.length,
  };
}

async function handleDraftLetter(body) {
  const fieldMap = fieldsToMap(body.fields);
  const modelResult = await callModelJson({
    system:
      "You write concise, job-tailored cover letters and return valid JSON only. Stay close to the user's source material and avoid hallucinating facts.",
    user: buildDraftPrompt({
      template: normalizeMultiline(body.template),
      fieldMap,
      selectedStyle: normalizeText(body.selectedStyle),
      resumeText: normalizeMultiline(body.resumeText),
      extractedJob: body.extractedJob && typeof body.extractedJob === "object" ? body.extractedJob : {},
    }),
    temperature: 0.35,
  });

  return {
    ok: true,
    draft: normalizeMultiline(modelResult.draft),
    fieldSuggestions: sanitizeFieldSuggestions(modelResult.fieldSuggestions),
    notes: normalizeText(modelResult.notes),
    warnings: Array.isArray(modelResult.warnings)
      ? modelResult.warnings.map((warning) => normalizeText(String(warning))).filter(Boolean).slice(0, 4)
      : [],
  };
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    send(res, json({ ok: false, error: "Missing request URL." }, 400));
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "OPTIONS") {
    send(res, json({ ok: true }, 204));
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    const status = getControlStatus();
    send(
      res,
      json({
        ok: true,
        providerConfigured: Boolean(OPENAI_API_KEY),
        model: OPENAI_MODEL,
        controlStatus: status,
      })
    );
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/control/status") {
    send(
      res,
      json({
        ok: true,
        status: getControlStatus(),
      })
    );
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/control/start") {
    const status = getControlStatus();
    if (status.allRunning) {
      send(
        res,
        json({
          ok: true,
          action: "start",
          state: "already_running",
          message: "CoverAI is already running.",
          status,
        })
      );
      return;
    }

    if (status.anyRunning) {
      launchDetachedShell(`"${STOP_SCRIPT}" >/dev/null 2>&1; sleep 1; "${START_SCRIPT}" >/dev/null 2>&1`, {
        COVERAI_SKIP_OPEN: "1",
      });
      send(
        res,
        json({
          ok: true,
          action: "start",
          state: "repairing_existing_processes",
          message: "CoverAI found existing processes and is restarting cleanly.",
        })
      );
      return;
    }

    launchDetachedShell(`"${START_SCRIPT}" >/dev/null 2>&1`, {
      COVERAI_SKIP_OPEN: "1",
    });
    send(
      res,
      json({
        ok: true,
        action: "start",
        state: "starting_fresh",
        message: "CoverAI start requested.",
      })
    );
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/control/restart") {
    launchDetachedShell(`sleep 1; "${START_SCRIPT}" >/dev/null 2>&1`);
    send(
      res,
      json({
        ok: true,
        action: "restart",
        message: "CoverAI restart requested. A fresh browser tab should open.",
      })
    );
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/control/stop") {
    launchDetachedShell(`sleep 1; "${STOP_SCRIPT}" >/dev/null 2>&1`);
    send(
      res,
      json({
        ok: true,
        action: "stop",
        message: "CoverAI stop requested.",
      })
    );
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/ai/extract-job") {
    try {
      const body = await readBody(req);
      const response = await handleExtractJob(body);
      send(res, json(response));
    } catch (error) {
      send(
        res,
        json(
          {
            ok: false,
            error: error.message || "AI extraction failed.",
            code: error.code || "extract_failed",
          },
          Number(error.status || 500)
        )
      );
    }
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/ai/draft-letter") {
    try {
      const body = await readBody(req);
      const response = await handleDraftLetter(body);
      send(res, json(response));
    } catch (error) {
      send(
        res,
        json(
          {
            ok: false,
            error: error.message || "AI draft generation failed.",
            code: error.code || "draft_failed",
          },
          Number(error.status || 500)
        )
      );
    }
    return;
  }

  send(res, json({ ok: false, error: "Not found." }, 404));
});

server.listen(PORT, HOST, () => {
  console.log(`[coverai-ai] listening on http://${HOST}:${PORT}`);
});
