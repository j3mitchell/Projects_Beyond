const DEFAULT_AI_API_BASE = process.env.REACT_APP_AI_API_BASE || "http://127.0.0.1:4000";

function normalizeBase(base) {
  return String(base || DEFAULT_AI_API_BASE).replace(/\/+$/, "");
}

async function postJson(path, payload) {
  const response = await fetch(`${normalizeBase()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || `Request failed with ${response.status}`);
    error.code = data?.code || "request_failed";
    error.status = response.status;
    throw error;
  }

  return data;
}

async function getJson(path) {
  const response = await fetch(`${normalizeBase()}${path}`);

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || `Request failed with ${response.status}`);
    error.code = data?.code || "request_failed";
    error.status = response.status;
    throw error;
  }

  return data;
}

export async function requestAiExtractJob(payload) {
  return postJson("/api/ai/extract-job", payload);
}

export async function requestAiDraftLetter(payload) {
  return postJson("/api/ai/draft-letter", payload);
}

export async function requestControlStatus() {
  return getJson("/api/control/status");
}

export async function requestControlRestart() {
  return postJson("/api/control/restart", {});
}

export async function requestControlStop() {
  return postJson("/api/control/stop", {});
}

export function normalizeAiFieldSuggestions(input) {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, String(value || "").trim()])
      .filter(([, value]) => Boolean(value))
  );
}

export function fieldArrayToValueMap(fields) {
  return Object.fromEntries(
    (Array.isArray(fields) ? fields : [])
      .filter((field) => field && typeof field.key === "string")
      .map((field) => [field.key, (field.value || field.label || "").trim()])
  );
}
