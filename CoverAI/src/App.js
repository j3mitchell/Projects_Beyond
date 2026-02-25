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
  { id: "f1", key: "hiring_manager", label: "Hiring Manager", value: "" },
  { id: "f2", key: "company_name", label: "Company Name", value: "" },
  { id: "f3", key: "job_title", label: "Job Title", value: "" },
  { id: "f4", key: "city", label: "City", value: "" },
  { id: "f5", key: "top_skill", label: "Top Skill", value: "" },
  { id: "f6", key: "impact_metric", label: "Impact Metric", value: "" },
  { id: "f7", key: "portfolio_link", label: "Portfolio Link", value: "" },
];

// Starter letter template that includes tokens wrapped in {{ }}.
const DEFAULT_TEMPLATE = `Dear {{hiring_manager}},

I am excited to apply for the {{job_title}} role at {{company_name}} in {{city}}.

I bring strong experience in {{top_skill}}, and recently delivered {{impact_metric}}.

I would welcome the opportunity to discuss how I can contribute to your team.

Sincerely,
[Your Name]`;

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

  // Main app state: template text, fields, UI mode, and status messages.
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [activeTab, setActiveTab] = useState("editor");
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
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
  const valueByKey = useMemo(
    () => Object.fromEntries(fields.map((field) => [field.key.toLowerCase(), field.value.trim()])),
    [fields]
  );

  // Recompute preview text and missing tokens whenever inputs change.
  const { rendered, unresolved } = useMemo(() => renderTemplate(template, valueByKey), [template, valueByKey]);
  const tokensInTemplate = useMemo(() => extractTokens(template), [template]);

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

  // Insert a token at the current cursor position in the textarea.
  const insertTokenAtCursor = (token) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const start = editor.selectionStart ?? template.length;
    const end = editor.selectionEnd ?? template.length;
    const updated = `${template.slice(0, start)}${token}${template.slice(end)}`;
    setTemplate(updated);
    const nextPosition = start + token.length;
    requestAnimationFrame(() => {
      editor.selectionStart = nextPosition;
      editor.selectionEnd = nextPosition;
    });
  };

  // Start drag operation by placing token text into drag payload.
  const handleTokenDragStart = (event, fieldKey) => {
    const token = `{{${fieldKey}}}`;
    event.dataTransfer.setData("text/plain", token);
    event.dataTransfer.effectAllowed = "copy";
  };

  // On drop inside editor, pull token text and insert it at cursor.
  const handleEditorDrop = (event) => {
    event.preventDefault();
    const token = event.dataTransfer.getData("text/plain");
    if (!token) return;
    insertTokenAtCursor(token);
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
            <textarea
              ref={editorRef}
              className="editor"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              onDrop={handleEditorDrop}
              onDragOver={(event) => event.preventDefault()}
              disabled={!isReady}
              placeholder="Write your cover letter template here..."
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
          </div>

          <div className="token-grid">
            {fields.map((field) => (
              <button
                type="button"
                key={`token_${field.id}`}
                className="token"
                draggable
                onDragStart={(event) => handleTokenDragStart(event, field.key)}
                onClick={() => insertTokenAtCursor(`{{${field.key}}}`)}
                title={`Insert {{${field.key}}}`}
                disabled={!isReady}
              >
                {`{{${field.key}}}`}
              </button>
            ))}
          </div>

          <div className="field-list">
            {fields.map((field) => (
              <div className="field-card" key={field.id}>
                <input
                  className="field-input"
                  value={field.label}
                  onChange={(event) => updateField(field.id, "label", event.target.value)}
                  disabled={!isReady}
                  placeholder="Label"
                />
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
                  disabled={!isReady}
                  placeholder="Value used in final letter"
                />
                <button type="button" className="text-button" onClick={() => deleteField(field.id)} disabled={!isReady}>
                  Remove
                </button>
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
      {(notice || error || isLoadingFile) && (
        <div className="status-row" role="status" aria-live="polite">
          {isLoadingFile && <span>Loading file...</span>}
          {notice && <span className="ok">{notice}</span>}
          {error && <span className="err">{error}</span>}
        </div>
      )}
    </div>
  );
}

export default App;
