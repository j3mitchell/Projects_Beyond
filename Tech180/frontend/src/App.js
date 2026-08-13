import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Player as GumletPlayer } from "@gumlet/player.js";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8050";
const CONTENT_SELECTOR = "h1,h2,h3,h4,h5,h6,p,a,button,span,li,figcaption,blockquote,img,iframe,video";
const CONTAINER_SELECTOR = "div,section,article,header,footer,main,nav,aside,form";
const CONTAINER_TAGS = new Set([
  "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "NAV", "ASIDE", "FORM",
]);
const VIDEO_EMBED_HOSTS = ["gumlet.io", "youtube.com", "youtu.be", "vimeo.com", "wistia.com", "wistia.net"];

function isVideoElement(element) {
  if (element.tag === "video") return true;
  if (element.tag !== "iframe") return false;
  try {
    const host = new URL(element.value, window.location.href).hostname.toLowerCase();
    return VIDEO_EMBED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

// Hosted players keep playback settings in their URL instead of HTML attributes.
function readVideoOptions(node) {
  const options = {
    loop: node.hasAttribute("loop"),
    autoplay: node.hasAttribute("autoplay"),
    muted: node.hasAttribute("muted"),
  };
  if (node.tagName !== "IFRAME") return options;
  try {
    const url = new URL(node.getAttribute("src") || "", window.location.href);
    const enabled = (name) => ["1", "true", "yes"].includes((url.searchParams.get(name) || "").toLowerCase());
    options.loop = enabled("loop");
    options.autoplay = enabled("autoplay");
    options.muted = enabled("mute") || enabled("muted");
  } catch {
    // A relative or incomplete URL can still be edited; its options default to false.
  }
  return options;
}

function writeIframeVideoOptions(node, choices) {
  try {
    const rawSource = node.getAttribute("src") || "";
    const url = new URL(rawSource, window.location.href);
    url.searchParams.set("loop", choices.loop ? "true" : "false");
    url.searchParams.set("autoplay", choices.autoplay ? "true" : "false");
    // Gumlet accepts `muted`; YouTube and several other players accept `mute`.
    url.searchParams.set("mute", choices.muted ? "1" : "0");
    url.searchParams.set("muted", choices.muted ? "true" : "false");
    node.setAttribute("src", url.toString());
    if (choices.autoplay) node.setAttribute("allow", `${node.getAttribute("allow") || ""}; autoplay`.replace(/^;\s*/, ""));
    return url.toString();
  } catch {
    return node.getAttribute("src") || "";
  }
}

function buildEditableElements(doc) {
  const elements = [];
  let nextId = 1;

  const contentCandidates = Array.from(doc.querySelectorAll(CONTENT_SELECTOR));
  const mediaCandidates = Array.from(doc.querySelectorAll("iframe,video,img"));
  const containerCandidates = Array.from(doc.querySelectorAll(CONTAINER_SELECTOR));
  const listedCandidates = new Set([
    ...mediaCandidates,
    ...contentCandidates.slice(0, 175),
    ...containerCandidates.slice(0, 75),
  ]);
  const candidates = [...contentCandidates, ...containerCandidates];
  candidates.forEach((node) => {
    if (node.closest('[data-tech180-visible="false"]')) return;
    let id = node.getAttribute("data-tech180-id");
    if (!id) {
      while (doc.querySelector(`[data-tech180-id="t180-${nextId}"]`)) nextId += 1;
      id = `t180-${nextId}`;
      nextId += 1;
      node.setAttribute("data-tech180-id", id);
    }

    let type = "text";
    let value = (node.textContent || "").trim();
    if (CONTAINER_TAGS.has(node.tagName)) {
      type = "container";
      value = node.outerHTML;
    } else if (node.tagName === "IMG") {
      type = "image";
      value = node.getAttribute("src") || "";
    } else if (node.tagName === "IFRAME" || node.tagName === "VIDEO") {
      type = "embed";
      value = node.getAttribute("src") || "";
    } else if (node.tagName === "A" && node.hasAttribute("href")) {
      type = "link";
      value = node.getAttribute("href") || "";
    }
    if (!value && type === "text") return;

    const label =
      node.tagName === "IMG"
        ? node.getAttribute("alt") || value
        : node.tagName === "IFRAME" || node.tagName === "VIDEO"
          ? node.getAttribute("title") || value
        : (node.textContent || "").trim();
    if (listedCandidates.has(node) && elements.length < 250) {
      elements.push({
        id,
        type,
        label: (label || `${node.tagName.toLowerCase()} ${elements.length + 1}`).slice(0, 80),
        selector: `[data-tech180-id="${id}"]`,
        value,
        tag: node.tagName.toLowerCase(),
      });
    }
  });

  return elements;
}

function normalizeLocalPath(path) {
  const parts = [];
  path.replaceAll("\\", "/").split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return parts.join("/");
}

function localAssetPath(value, htmlPath) {
  if (!value || /^(?:[a-z]+:|\/\/|#)/i.test(value)) return "";
  const cleanValue = decodeURIComponent(value.split(/[?#]/)[0]);
  const htmlDirectory = htmlPath.includes("/") ? htmlPath.slice(0, htmlPath.lastIndexOf("/") + 1) : "";
  return normalizeLocalPath(`${htmlDirectory}${cleanValue}`);
}

function nextPaint() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function restoreFolderAssets(doc, files, htmlFile, objectUrls) {
  const fileMap = new Map(
    files.map((file) => [normalizeLocalPath(file.webkitRelativePath || file.name), file])
  );
  const htmlPath = normalizeLocalPath(htmlFile.webkitRelativePath || htmlFile.name);

  function objectUrlFor(value) {
    const path = localAssetPath(value, htmlPath);
    const file = fileMap.get(path);
    if (!file) return value;
    if (!objectUrls.has(path)) objectUrls.set(path, URL.createObjectURL(file));
    return objectUrls.get(path);
  }

  const attributes = [
    ["img", "src"],
    ["link", "href"],
    ["script", "src"],
    ["source", "src"],
    ["video", "src"],
    ["video", "poster"],
    ["audio", "src"],
    ["iframe", "src"],
  ];
  attributes.forEach(([selector, attribute]) => {
    doc.querySelectorAll(`${selector}[${attribute}]`).forEach((node) => {
      node.setAttribute(attribute, objectUrlFor(node.getAttribute(attribute)));
    });
  });
  doc.querySelectorAll("[srcset]").forEach((node) => {
    const rewritten = node
      .getAttribute("srcset")
      .split(",")
      .map((candidate) => {
        const [path, ...descriptor] = candidate.trim().split(/\s+/);
        return [objectUrlFor(path), ...descriptor].join(" ");
      })
      .join(", ");
    node.setAttribute("srcset", rewritten);
  });
}

async function restoreFolderStyles(doc, files, htmlFile) {
  const fileMap = new Map(
    files.map((file) => [normalizeLocalPath(file.webkitRelativePath || file.name), file])
  );
  const htmlPath = normalizeLocalPath(htmlFile.webkitRelativePath || htmlFile.name);
  const restoredPaths = new Set();

  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const path = localAssetPath(link.getAttribute("href"), htmlPath);
    const file = fileMap.get(path);
    if (!file) continue;
    if (restoredPaths.has(path)) {
      link.remove();
      continue;
    }

    const style = doc.createElement("style");
    style.setAttribute("data-tech180-local-stylesheet", path);
    style.textContent = await file.text();
    link.replaceWith(style);
    restoredPaths.add(path);
  }
}

function injectBridge(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");

  doc.querySelectorAll("[data-tech180-active]").forEach((node) => {
    node.removeAttribute("data-tech180-active");
  });

  const bridge = doc.createElement("script");
  bridge.textContent = `
    function tech180TrimTopWhitespace() {
      document.body.style.transform = "";
      document.body.style.transformOrigin = "";
      document.body.style.minHeight = "";
      window.scrollTo(0, 0);

      var meaningfulTags = [
        "A", "BUTTON", "H1", "H2", "H3", "H4", "H5", "H6", "IMG", "LI",
        "NAV", "P", "PICTURE", "SECTION", "SVG", "VIDEO"
      ];
      var candidates = Array.prototype.slice.call(document.body.querySelectorAll("*"));
      var tops = candidates
        .filter(function(element) {
          if (["SCRIPT", "STYLE", "META", "LINK", "BASE"].indexOf(element.tagName) >= 0) return false;
          var rect = element.getBoundingClientRect();
          var styles = window.getComputedStyle(element);
          var text = (element.innerText || element.alt || element.getAttribute("aria-label") || "").trim();
          var hasBackgroundImage = styles.backgroundImage && styles.backgroundImage !== "none";
          var isMeaningfulTag = meaningfulTags.indexOf(element.tagName) >= 0;
          var hasMeaning = text.length > 1 || element.tagName === "IMG" || element.tagName === "SVG" ||
            element.tagName === "VIDEO" || hasBackgroundImage || isMeaningfulTag;
          return rect.width > 20 &&
            rect.height > 8 &&
            hasMeaning &&
            styles.display !== "none" &&
            styles.visibility !== "hidden" &&
            Number(styles.opacity) !== 0;
        })
        .map(function(element) {
          return element.getBoundingClientRect().top;
        })
        .filter(function(top) {
          return top > 0;
        });

      if (!tops.length) return;
      var firstTop = Math.min.apply(Math, tops);
      if (firstTop <= 18) return;
      var trim = Math.min(firstTop - 8, Math.max(120, window.innerHeight * 0.45));
      document.body.style.transform = "translateY(-" + trim + "px)";
      document.body.style.transformOrigin = "0 0";
      document.body.style.minHeight = "calc(100% + " + trim + "px)";
      window.scrollTo(0, Math.max(0, trim - 4));
    }

    function tech180ExpandSectionFor(node) {
      if (!node || node.tagName === "IMG") return;

      var styles = window.getComputedStyle(node);
      var canGrow = ["block", "flex", "grid", "list-item"].indexOf(styles.display) >= 0;
      if (canGrow) {
        node.style.setProperty("height", "auto", "important");
        node.style.setProperty("max-height", "none", "important");
        node.style.setProperty("overflow", "visible", "important");
      }

      var child = node;
      var parent = node.parentElement;
      var levels = 0;
      while (parent && parent !== document.body && levels < 8) {
        var parentRect = parent.getBoundingClientRect();
        var childRect = child.getBoundingClientRect();
        var parentStyles = window.getComputedStyle(parent);
        var paddingBottom = parseFloat(parentStyles.paddingBottom) || 0;
        var requiredHeight = Math.ceil(childRect.bottom - parentRect.top + paddingBottom);
        var currentHeight = parentRect.height;

        if (
          requiredHeight > currentHeight + 2 &&
          parentStyles.position !== "fixed" &&
          parentStyles.position !== "sticky"
        ) {
          var borderHeight =
            (parseFloat(parentStyles.borderTopWidth) || 0) +
            (parseFloat(parentStyles.borderBottomWidth) || 0);
          parent.style.setProperty(
            "height",
            Math.ceil(requiredHeight + borderHeight) + "px",
            "important"
          );
          parent.style.setProperty("max-height", "none", "important");
          parent.style.setProperty("overflow", "visible", "important");
        }

        child = parent;
        parent = parent.parentElement;
        levels += 1;
      }
    }

    function tech180ReflowEditableContent() {
      document.querySelectorAll("[data-tech180-id]").forEach(function(node) {
        if (node.tagName === "IMG") return;
        var styles = window.getComputedStyle(node);
        var isClipped =
          node.scrollHeight > node.clientHeight + 2 ||
          styles.overflow === "hidden" ||
          styles.textOverflow === "ellipsis";
        if (isClipped) tech180ExpandSectionFor(node);
      });
    }

    window.addEventListener("load", function() {
      window.requestAnimationFrame(function() {
        tech180ReflowEditableContent();
        tech180TrimTopWhitespace();
      });
    });
    window.setTimeout(function() {
      tech180ReflowEditableContent();
      tech180TrimTopWhitespace();
    }, 150);

    function tech180ReportCss(node) {
      if (!node) return;
      var properties = [
        "display", "position", "top", "right", "bottom", "left", "z-index",
        "box-sizing", "width", "min-width", "max-width", "height", "min-height",
        "max-height", "margin", "padding", "overflow", "color", "background",
        "border", "border-radius", "box-shadow", "opacity", "font-family",
        "font-size", "font-style", "font-weight", "letter-spacing", "line-height",
        "text-align", "text-decoration", "text-transform", "white-space",
        "align-items", "align-content", "align-self", "justify-content",
        "gap", "flex", "flex-direction", "flex-wrap", "grid", "object-fit",
        "transform", "visibility"
      ];
      var styles = window.getComputedStyle(node);
      var declarations = properties
        .map(function(property) {
          var value = styles.getPropertyValue(property);
          return value ? "  " + property + ": " + value + ";" : "";
        })
        .filter(Boolean)
        .join("\\n");
      var selector = '[data-tech180-id="' + node.dataset.tech180Id + '"]';
      window.parent.postMessage(
        {
          type: "tech180-css",
          id: node.dataset.tech180Id,
          css: selector + " {\\n" + declarations + "\\n}",
          html: node.outerHTML
        },
        "*"
      );
    }

    function tech180Activate(id, shouldScroll) {
      document.querySelectorAll("[data-tech180-active]").forEach(function(node) {
        node.removeAttribute("data-tech180-active");
      });
      if (!id) return;
      var active = document.querySelector('[data-tech180-id="' + CSS.escape(id) + '"]');
      if (!active) return;
      active.setAttribute("data-tech180-active", "true");
      if (shouldScroll) {
        active.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      }
      tech180ReportCss(active);
    }

    // Gumlet embeds are separate web pages inside an iframe. Changing attributes
    // on that iframe does not change the sound of a player that is already open,
    // so Player.js sends the mute/unmute command directly to the hosted player.
    function tech180ControlEmbeddedVideo(node, choices) {
      if (!node) return;
      // A replacement/local video is a normal HTML video, so its properties can
      // be changed directly without reloading it or losing its current position.
      if (node.tagName === "VIDEO") {
        node.loop = Boolean(choices.loop);
        node.autoplay = Boolean(choices.autoplay);
        node.muted = Boolean(choices.muted);
        node.defaultMuted = Boolean(choices.muted);
        if (choices.autoplay) node.play().catch(function() {});
        return;
      }
      if (node.tagName !== "IFRAME") return;
      function controlPlayer() {
        if (!window.playerjs || !window.playerjs.Player) return;
        var player = new window.playerjs.Player(node);
        player.on("ready", function() {
          if (choices.muted) player.mute();
          else player.unmute();
          if (player.supports("method", "setLoop")) player.setLoop(Boolean(choices.loop));
          if (choices.autoplay) player.play();
        });
      }
      if (window.playerjs && window.playerjs.Player) {
        controlPlayer();
        return;
      }
      var loader = document.querySelector("script[data-tech180-playerjs]");
      if (!loader) {
        loader = document.createElement("script");
        loader.src = "https://cdn.jsdelivr.net/npm/@gumlet/player.js@3/dist/main.global.js";
        loader.setAttribute("data-tech180-playerjs", "true");
        document.head.appendChild(loader);
      }
      loader.addEventListener("load", controlPlayer, { once: true });
    }

    window.addEventListener("message", function(event) {
      if (event.data && event.data.type === "tech180-activate") {
        tech180Activate(event.data.id, Boolean(event.data.scroll));
      }
      if (event.data && event.data.type === "tech180-video-options") {
        var videoNode = document.querySelector(
          '[data-tech180-id="' + CSS.escape(event.data.id) + '"]'
        );
        tech180ControlEmbeddedVideo(videoNode, event.data.choices || {});
      }
      if (event.data && event.data.type === "tech180-update") {
        var node = document.querySelector(
          '[data-tech180-id="' + CSS.escape(event.data.id) + '"]'
        );
        if (!node) return;
        if (event.data.elementType === "image" || event.data.elementType === "embed") node.setAttribute("src", event.data.value);
        else if (event.data.elementType === "link") node.setAttribute("href", event.data.value);
        else node.textContent = event.data.value;
        window.requestAnimationFrame(function() {
          tech180ExpandSectionFor(node);
          tech180ReportCss(node);
        });
      }
      if (event.data && event.data.type === "tech180-css-update") {
        var cssNode = document.querySelector(
          '[data-tech180-id="' + CSS.escape(event.data.id) + '"]'
        );
        if (!cssNode) return;
        var cssText = event.data.css || "";
        var openBrace = cssText.indexOf("{");
        var closeBrace = cssText.lastIndexOf("}");
        var declarations =
          openBrace >= 0 && closeBrace > openBrace
            ? cssText.slice(openBrace + 1, closeBrace)
            : cssText;
        cssNode.style.cssText = declarations;
      }
      if (event.data && event.data.type === "tech180-html-update") {
        var htmlNode = document.querySelector(
          '[data-tech180-id="' + CSS.escape(event.data.id) + '"]'
        );
        if (!htmlNode) return;
        var template = document.createElement("template");
        template.innerHTML = (event.data.html || "").trim();
        var replacement = template.content.firstElementChild;
        if (!replacement) return;
        replacement.setAttribute("data-tech180-id", event.data.id);
        htmlNode.replaceWith(replacement);
        tech180Activate(event.data.id, false);
        tech180ExpandSectionFor(replacement);
      }
      if (event.data && event.data.type === "tech180-visibility") {
        var visibilityNode = document.querySelector(
          '[data-tech180-id="' + CSS.escape(event.data.id) + '"]'
        );
        if (!visibilityNode) return;
        if (event.data.show) visibilityNode.style.removeProperty("display");
        else visibilityNode.style.setProperty("display", "none", "important");
      }
    });

    document.addEventListener("click", function(event) {
      var target = event.target.closest("[data-tech180-id]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      tech180Activate(target.dataset.tech180Id, false);
      window.parent.postMessage({ type: "tech180-select", id: target.dataset.tech180Id }, "*");
    }, true);
  `;
  doc.body.appendChild(bridge);
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

function replaceElementValue(html, element, nextValue) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const node = doc.querySelector(`[data-tech180-id="${CSS.escape(element.id)}"]`);
  if (!node) return html;

  if (element.type === "image" || element.type === "embed") {
    node.setAttribute("src", nextValue);
  } else if (element.type === "link") {
    node.setAttribute("href", nextValue);
  } else {
    node.textContent = nextValue;
  }

  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

function cssDeclarations(css) {
  const openBrace = css.indexOf("{");
  const closeBrace = css.lastIndexOf("}");
  return openBrace >= 0 && closeBrace > openBrace
    ? css.slice(openBrace + 1, closeBrace)
    : css;
}

function replaceElementCss(html, elementId, css) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const node = doc.querySelector(`[data-tech180-id="${CSS.escape(elementId)}"]`);
  if (!node) return html;
  node.style.cssText = cssDeclarations(css);
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

function replaceElementHtml(html, elementId, replacementHtml) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const node = doc.querySelector(`[data-tech180-id="${CSS.escape(elementId)}"]`);
  if (!node) return html;
  const template = doc.createElement("template");
  template.innerHTML = replacementHtml.trim();
  const replacement = template.content.firstElementChild;
  if (!replacement) throw new Error("HTML must contain one complete root element.");
  replacement.setAttribute("data-tech180-id", elementId);
  node.replaceWith(replacement);
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

function buildSeparatedExport(html, baseName = "") {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const cssParts = [];
  const jsParts = [];

  doc.querySelectorAll("[data-tech180-active]").forEach((node) => {
    node.removeAttribute("data-tech180-active");
  });
  doc.querySelectorAll("base").forEach((node) => node.remove());

  doc.querySelectorAll("style").forEach((style) => {
    const css = style.textContent || "";
    const isEditorStyle =
      css.includes("[data-tech180-id]") &&
      css.includes("outline-color") &&
      css.includes("data-tech180-active");
    if (!isEditorStyle && css.trim()) cssParts.push(css.trim());
    style.remove();
  });

  let styleIndex = 0;
  doc.querySelectorAll("[style]").forEach((node) => {
    const declarations = [];
    Array.from(node.style).forEach((property) => {
      const value = node.style.getPropertyValue(property);
      if (value) declarations.push(`  ${property}: ${value} !important;`);
    });
    node.removeAttribute("style");
    if (!declarations.length) return;
    styleIndex += 1;
    const exportId = `t180-style-${styleIndex}`;
    node.setAttribute("data-tech180-style", exportId);
    cssParts.push(`[data-tech180-style="${exportId}"] {\n${declarations.join("\n")}\n}`);
  });

  doc.querySelectorAll("script").forEach((script) => {
    if (script.src) {
      jsParts.push(`// Original external script: ${script.src}`);
    } else if (script.textContent?.trim()) {
      jsParts.push(script.textContent.trim());
    }
    script.remove();
  });

  const stylesheet = doc.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = `${baseName}styles.css`;
  doc.head.appendChild(stylesheet);

  const script = doc.createElement("script");
  script.src = `${baseName}script.js`;
  script.defer = true;
  doc.body.appendChild(script);

  return {
    [`${baseName ? baseName.slice(0, -1) : "index"}.html`]: "<!doctype html>\n" + doc.documentElement.outerHTML,
    [`${baseName}styles.css`]: cssParts.join("\n\n") + "\n",
    [`${baseName}script.js`]:
      (jsParts.length
        ? jsParts.join("\n\n")
        : "// Tech180 export: no active JavaScript was present in the safe recreation.") + "\n",
  };
}

function pageFileBase(url, index) {
  if (index === 0) return "";
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    const name = path.split("/").filter(Boolean).pop() || `page-${index + 1}`;
    return `${name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-`;
  } catch {
    return `page-${index + 1}-`;
  }
}

function rewriteExportLinks(files, urlToFilename) {
  Object.keys(files).filter((name) => name.endsWith(".html")).forEach((name) => {
    const doc = new DOMParser().parseFromString(files[name], "text/html");
    doc.querySelectorAll("a[href]").forEach((anchor) => {
      const target = anchor.href.split("#")[0].replace(/\/$/, "");
      const localFile = urlToFilename.get(target);
      if (localFile) anchor.setAttribute("href", localFile);
    });
    files[name] = "<!doctype html>\n" + doc.documentElement.outerHTML;
  });
}

function App() {
  const previewPaneRef = useRef(null);
  const previewFrameRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const localObjectUrlsRef = useRef(new Map());
  const largeVideoFilesRef = useRef(new Map());
  const pageCacheRef = useRef(new Map());
  const [url, setUrl] = useState("");
  const [page, setPage] = useState(null);
  const [html, setHtml] = useState("");
  const [iframeHtml, setIframeHtml] = useState("");
  const [elements, setElements] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [activeCss, setActiveCss] = useState("");
  const [activeHtml, setActiveHtml] = useState("");
  const [htmlEditError, setHtmlEditError] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findIndex, setFindIndex] = useState(-1);
  const [pageTabs, setPageTabs] = useState([]);
  const [commandHistory, setCommandHistory] = useState([]);
  const [elementFilter, setElementFilter] = useState("");
  const [elementTypeFilter, setElementTypeFilter] = useState("all");
  const [imageComparison, setImageComparison] = useState(null);
  const [videoComparison, setVideoComparison] = useState(null);
  const [videoOptionChoices, setVideoOptionChoices] = useState({});

  const activeElement = elements.find((element) => element.id === activeId);
  const visibleElements = useMemo(() => {
    const query = elementFilter.trim().toLowerCase();
    return elements.filter((element) => {
      const typeMatches =
        elementTypeFilter === "all" ||
        element.type === elementTypeFilter ||
        (elementTypeFilter === "div" && element.tag === "div") ||
        (elementTypeFilter === "video" && isVideoElement(element)) ||
        (elementTypeFilter === "iframe" && element.tag === "iframe");
      const textMatches = !query ||
        `${element.tag} ${element.type} ${element.label}`.toLowerCase().includes(query);
      return typeMatches && textMatches;
    });
  }, [elements, elementFilter, elementTypeFilter]);
  const previewHtml = useMemo(() => injectBridge(iframeHtml), [iframeHtml]);
  const activeElementHidden = useMemo(() => {
    if (!html || !activeId) return false;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const node = doc.querySelector(`[data-tech180-id="${CSS.escape(activeId)}"]`);
    return node?.getAttribute("data-tech180-hidden") === "true";
  }, [html, activeId]);
  const activeVideoOptions = useMemo(() => {
    if (!html || !activeId || !activeElement || !isVideoElement(activeElement)) return null;
    if (videoOptionChoices[activeId]) return videoOptionChoices[activeId];
    const doc = new DOMParser().parseFromString(html, "text/html");
    const node = doc.querySelector(`[data-tech180-id="${CSS.escape(activeId)}"]`);
    return node ? readVideoOptions(node) : null;
  }, [html, activeId, activeElement, videoOptionChoices]);

  function sendToPreview(message) {
    previewFrameRef.current?.contentWindow?.postMessage(message, "*");
  }

  function selectElement(id, shouldScroll = false, remember = true) {
    if (remember && activeId && activeId !== id) {
      setCommandHistory((current) => [...current, { type: "selection", activeId }].slice(-30));
    }
    setActiveId(id);
    sendToPreview({ type: "tech180-activate", id, scroll: shouldScroll });
  }

  function selectParentDiv() {
    if (!activeId) return;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const node = doc.querySelector(`[data-tech180-id="${CSS.escape(activeId)}"]`);
    const parent = node?.parentElement;
    if (!parent || parent === doc.body || parent === doc.documentElement) {
      setStatus("This element has no higher selectable parent");
      return;
    }
    const parentId = parent.dataset.tech180Id || `t180-parent-${Date.now()}`;
    parent.setAttribute("data-tech180-id", parentId);
    const nextHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;
    if (!elements.some((element) => element.id === parentId)) {
      const label = (parent.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
      setElements((current) => [...current, {
        id: parentId,
        type: "container",
        label: label || `${parent.tagName.toLowerCase()} container`,
        selector: `[data-tech180-id="${parentId}"]`,
        value: parent.outerHTML,
        tag: parent.tagName.toLowerCase(),
      }]);
    }
    setHtml(nextHtml);
    setIframeHtml(nextHtml);
    selectElement(parentId, true);
    setStatus(`Parent ${parent.tagName.toLowerCase()} selected`);
  }

  function undoLastCommand() {
    const command = commandHistory[commandHistory.length - 1];
    if (!command) {
      setStatus("Nothing to undo");
      return;
    }
    setCommandHistory((current) => current.slice(0, -1));
    if (command.type === "selection") {
      selectElement(command.activeId, true, false);
      setStatus("Returned to the previous element");
    } else if (command.type === "html") {
      setHtml(command.html);
      setIframeHtml(command.html);
      setActiveId(command.activeId);
      setStatus("Restored the hidden element");
    }
  }

  function hideActiveElement() {
    if (!activeId) return;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const node = doc.querySelector(`[data-tech180-id="${CSS.escape(activeId)}"]`);
    if (!node) return;

    setCommandHistory((current) => [...current, { type: "html", html, activeId }].slice(-30));
    node.setAttribute("data-tech180-hidden", "true");
    node.style.setProperty("display", "none", "important");

    const nextHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;
    sendToPreview({ type: "tech180-visibility", id: activeId, show: false });
    setHtml(nextHtml);
    setIframeHtml(nextHtml);
    setStatus(`${activeElement?.tag || "Element"} and all its children hidden`);
  }

  function unhideActiveElement() {
    if (!activeId || !activeElementHidden) return;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const node = doc.querySelector(`[data-tech180-id="${CSS.escape(activeId)}"]`);
    if (!node) return;

    setCommandHistory((current) => [...current, { type: "html", html, activeId }].slice(-30));
    node.removeAttribute("data-tech180-hidden");
    node.style.removeProperty("display");
    const nextHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;
    sendToPreview({ type: "tech180-visibility", id: activeId, show: true });
    setHtml(nextHtml);
    setIframeHtml(nextHtml);
    setStatus(`${activeElement?.tag || "Element"} restored`);
  }

  useEffect(() => {
    function handleMessage(event) {
      if (event.data?.type === "tech180-select") {
        setActiveId(event.data.id);
      }
      if (event.data?.type === "tech180-css") {
        setActiveCss(event.data.css || "");
        setActiveHtml(event.data.html || "");
        setHtmlEditError("");
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(
    () => () => {
      localObjectUrlsRef.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    },
    []
  );

  useEffect(() => {
    if (!isImporting) return undefined;

    setImportProgress(12);
    const interval = window.setInterval(() => {
      setImportProgress((current) => Math.min(current + 8, 92));
    }, 350);

    return () => window.clearInterval(interval);
  }, [isImporting]);

  async function importUrl(nextUrl = url) {
    const trimmedUrl = nextUrl.trim();
    if (!trimmedUrl) {
      setError("Enter a web URL to import.");
      return;
    }

    const previewWidth = Math.round(previewPaneRef.current?.clientWidth || 1120);

    setIsImporting(true);
    setImportProgress(8);
    setStatus("Importing page");
    setError("");
    setActiveId("");
    setActiveCss("");
    setActiveHtml("");
    setHtmlEditError("");

    try {
      const response = await fetch(`${API_BASE}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          include_subpages: true,
          viewport_width: previewWidth,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Import failed.");
      }

      setPage(data);
      setHtml(data.html);
      setIframeHtml(data.html);
      setElements(data.elements);
      setUrl(data.source_url);
      setActiveId(data.elements[0]?.id || "");
      setCommandHistory([]);
      setStatus(`${data.elements.length} editable elements found`);
      const tabs = data.subpages?.length ? data.subpages : [{ title: data.title, url: data.source_url }];
      setPageTabs(tabs);
      pageCacheRef.current = new Map([[data.source_url, data]]);
      setImportProgress(100);
    } catch (err) {
      setError(err.message);
      setStatus("");
      setImportProgress(0);
    } finally {
      window.setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
      }, 450);
    }
  }

  async function switchPageTab(tab) {
    if (tab.url === page?.source_url || isImporting) return;

    if (page?.source_url) {
      pageCacheRef.current.set(page.source_url, { ...page, html, elements });
    }

    setIsImporting(true);
    setImportProgress(15);
    setStatus(`Opening ${tab.title}`);
    setError("");
    try {
      let nextPage = pageCacheRef.current.get(tab.url);
      if (!nextPage) {
        const previewWidth = Math.round(previewPaneRef.current?.clientWidth || 1120);
        const response = await fetch(`${API_BASE}/api/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: tab.url, include_subpages: false, viewport_width: previewWidth }),
        });
        nextPage = await response.json();
        if (!response.ok) throw new Error(nextPage.detail || "Page import failed.");
        pageCacheRef.current.set(tab.url, nextPage);
      }

      setPage(nextPage);
      setHtml(nextPage.html);
      setIframeHtml(nextPage.html);
      setElements(nextPage.elements);
      setUrl(nextPage.source_url);
      setActiveId(nextPage.elements[0]?.id || "");
      setCommandHistory([]);
      setActiveCss("");
      setActiveHtml("");
      setFindIndex(-1);
      setImportProgress(100);
      setStatus(`${nextPage.elements.length} editable elements found`);
    } catch (err) {
      setError(err.message);
      setStatus("");
    } finally {
      window.setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
      }, 350);
    }
  }

  async function importLocalFiles(fileList) {
    let files = Array.from(fileList || []);
    if (!files.length) return;

    if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
      setIsImporting(true);
      setImportProgress(8);
      setStatus("Opening project ZIP");
      setError("");
      try {
        const archive = await JSZip.loadAsync(files[0]);
        const entries = Object.values(archive.files).filter((entry) => !entry.dir);
        files = await Promise.all(
          entries.map(async (entry) => {
            const blob = await entry.async("blob");
            return new File([blob], entry.name, { type: blob.type });
          })
        );
        setImportProgress(24);
      } catch (err) {
        setError(`Could not open the project ZIP: ${err.message}`);
        setStatus("");
        setIsImporting(false);
        setImportProgress(0);
        return;
      }
    }

    const htmlFiles = files.filter((file) => /\.html?$/i.test(file.name));
    const htmlFile =
      htmlFiles.find((file) => /^tech180-recreation\.html?$/i.test(file.name.split("/").pop())) ||
      htmlFiles.find((file) => /^index\.html?$/i.test(file.name.split("/").pop())) ||
      htmlFiles.find((file) => /^home\.html?$/i.test(file.name.split("/").pop())) ||
      htmlFiles[0];
    if (!htmlFile) {
      setError("No HTML file was found. Select a Tech180 ZIP, HTML export, or project folder.");
      setIsImporting(false);
      setImportProgress(0);
      return;
    }

    setIsImporting(true);
    setImportProgress(8);
    setStatus("Reading saved project");
    setError("");
    setActiveId("");
    setActiveCss("");
    setActiveHtml("");
    setHtmlEditError("");

    try {
      await nextPaint();
      localObjectUrlsRef.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
      localObjectUrlsRef.current.clear();

      const rawHtml = await htmlFile.text();
      setImportProgress(35);
      setStatus("Preparing saved HTML");
      await nextPaint();

      const doc = new DOMParser().parseFromString(rawHtml, "text/html");
      doc.querySelectorAll("script").forEach((script) => script.remove());
      doc.querySelectorAll("[data-tech180-active]").forEach((node) => {
        node.removeAttribute("data-tech180-active");
      });
      if (files.length > 1) {
        setImportProgress(58);
        setStatus(`Reconnecting assets from ${files.length} files`);
        await nextPaint();
        await restoreFolderStyles(doc, files, htmlFile);
        restoreFolderAssets(doc, files, htmlFile, localObjectUrlsRef.current);
      }

      setImportProgress(78);
      setStatus("Restoring editable elements");
      await nextPaint();
      const restoredElements = buildEditableElements(doc);
      const restoredHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;
      const title = doc.title || htmlFile.name.replace(/\.html?$/i, "");
      const sourceLabel = htmlFile.webkitRelativePath || htmlFile.name;
      const restoredPage = {
        title,
        source_url: sourceLabel,
        subpages: [],
        warnings: ["Saved project restored locally. Active scripts remain disabled for preview safety."],
        render_mode: "local",
      };

      setPage(restoredPage);
      setHtml(restoredHtml);
      setIframeHtml(restoredHtml);
      setElements(restoredElements);
      setUrl("");
      setActiveId(restoredElements[0]?.id || "");
      setCommandHistory([]);
      setStatus(`${restoredElements.length} editable elements restored`);
      setPageTabs([{ title, url: sourceLabel }]);
      pageCacheRef.current = new Map([[sourceLabel, { ...restoredPage, html: restoredHtml, elements: restoredElements }]]);
      setImportProgress(100);
      await nextPaint();
    } catch (err) {
      setError(`Could not open the saved project: ${err.message}`);
      setStatus("");
      setImportProgress(0);
    } finally {
      window.setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
      }, 450);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }

  function updateActiveValue(nextValue) {
    if (!activeElement) return;
    sendToPreview({
      type: "tech180-update",
      id: activeElement.id,
      elementType: activeElement.type,
      value: nextValue,
    });
    setHtml((currentHtml) => replaceElementValue(currentHtml, activeElement, nextValue));
    setElements((current) =>
      current.map((element) =>
        element.id === activeElement.id
          ? { ...element, value: nextValue, label: nextValue.slice(0, 80) || element.label }
          : element
      )
    );
  }

  function chooseLocalImage(event) {
    const file = event.target.files?.[0];
    if (!file || !activeElement || activeElement.type !== "image") return;
    const reader = new FileReader();
    reader.onload = () => {
      const nextSource = String(reader.result || "");
      setImageComparison({ id: activeElement.id, oldSource: activeElement.value, newSource: nextSource });
      updateActiveValue(nextSource);
      setStatus(`Image replaced with ${file.name}`);
    };
    reader.onerror = () => setError(`Could not read ${file.name}`);
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function chooseLocalVideo(event) {
    const file = event.target.files?.[0];
    if (!file || !activeElement || !isVideoElement(activeElement)) return;
    if (file.size > 50 * 1024 * 1024) {
      const objectUrl = URL.createObjectURL(file);
      largeVideoFilesRef.current.set(objectUrl, file);
      applySelectedVideo(file, objectUrl);
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const nextSource = String(reader.result || "");
      applySelectedVideo(file, nextSource);
    };
    reader.onerror = () => setError(`Could not read ${file.name}`);
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function applySelectedVideo(file, nextSource) {
      const probe = document.createElement("video");
      probe.preload = "metadata";
      probe.onloadedmetadata = () => {
        // Read the replacement dimensions before using the orientation value.
        const newIsPortrait = probe.videoHeight > probe.videoWidth;
        setVideoComparison({ id: activeElement.id, oldSource: activeElement.value, newSource: nextSource, newIsPortrait });
        const doc = new DOMParser().parseFromString(html, "text/html");
        const original = doc.querySelector(activeElement.selector);
        if (!original) return;
        const originalWidth = parseFloat(original.style.width) || Number(original.getAttribute("width")) || 0;
        const originalHeight = parseFloat(original.style.height) || Number(original.getAttribute("height")) || 0;
        const originalIsPortrait = originalHeight > originalWidth && originalWidth > 0;
        const video = original.tagName === "VIDEO" ? original : doc.createElement("video");
        if (video !== original) {
          video.setAttribute("data-tech180-id", activeElement.id);
          video.style.cssText = original.style.cssText;
          original.replaceWith(video);
        }
        video.setAttribute("src", nextSource);
        video.setAttribute("controls", "");
        const choices = videoOptionChoices[activeElement.id] || activeVideoOptions || {};
        ["loop", "autoplay", "muted"].forEach((attribute) => {
          if (choices[attribute]) video.setAttribute(attribute, "");
          else video.removeAttribute(attribute);
        });
        video.style.setProperty("object-fit", "contain", "important");
        video.style.setProperty("object-position", "center center", "important");
        video.style.setProperty("display", "block", "important");
        video.style.setProperty("margin", "auto", "important");

        // Imported player iframes are often absolutely positioned. Once a
        // portrait video becomes narrower, `left: 0` pins it to one side.
        // Anchor its center to the container's center instead.
        if (video.style.position === "absolute" || video.style.position === "fixed") {
          video.style.setProperty("top", "50%", "important");
          video.style.setProperty("left", "50%", "important");
          video.style.setProperty("right", "auto", "important");
          video.style.setProperty("bottom", "auto", "important");
          video.style.setProperty("transform", "translate(-50%, -50%)", "important");
        }
        if (originalIsPortrait) {
          video.style.setProperty("width", "100%", "important");
          video.style.setProperty("height", "auto", "important");
        } else if (newIsPortrait) {
          video.style.setProperty("height", "100%", "important");
          video.style.setProperty("width", "auto", "important");
        }

        const nextHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;
        setHtml(nextHtml);
        setIframeHtml(nextHtml);
        setElements((current) => current.map((element) =>
          element.id === activeElement.id
            ? { ...element, tag: "video", type: "embed", value: nextSource, label: file.name }
            : element
        ));
        setStatus(`Video replaced with ${file.name}`);
      };
      probe.onerror = () => setError(`Could not read video dimensions for ${file.name}`);
      probe.src = nextSource;
  }

  function updateVideoOption(attribute, enabled) {
    if (!activeId || !activeElement || !isVideoElement(activeElement)) return;
    const nextChoices = {
      loop: activeVideoOptions?.loop || false,
      autoplay: activeVideoOptions?.autoplay || false,
      muted: activeVideoOptions?.muted || false,
      [attribute]: enabled,
    };
    if (attribute === "autoplay" && enabled) nextChoices.muted = true;
    setVideoOptionChoices((current) => ({ ...current, [activeId]: nextChoices }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const node = doc.querySelector(`[data-tech180-id="${CSS.escape(activeId)}"]`);
    if (!node) return;
    let nextSource = activeElement.value;
    if (node.tagName === "IFRAME") {
      nextSource = writeIframeVideoOptions(node, nextChoices);
      node.setAttribute("data-tech180-loop", String(nextChoices.loop));
      node.setAttribute("data-tech180-autoplay", String(nextChoices.autoplay));
      node.setAttribute("data-tech180-muted", String(nextChoices.muted));
    } else {
      ["loop", "autoplay", "muted"].forEach((option) => {
        if (nextChoices[option]) node.setAttribute(option, "");
        else node.removeAttribute(option);
      });
    }
    const nextHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;
    setHtml(nextHtml);
    // Do not replace iframeHtml here. Rebuilding the preview destroys the live
    // hosted player before its mute/unmute command can take effect.
    setElements((current) => current.map((element) =>
      element.id === activeId ? { ...element, value: nextSource } : element
    ));
    // Control the selected player in the large preview from Tech180 itself.
    // This avoids imported-site security rules that can block injected scripts.
    const liveNode = previewFrameRef.current?.contentDocument?.querySelector(
      `[data-tech180-id="${CSS.escape(activeId)}"]`
    );
    if (liveNode?.tagName === "IFRAME") {
      const player = new GumletPlayer(liveNode);
      const applyChoices = () => {
        if (nextChoices.muted) player.mute();
        else player.unmute();
        if (player.supports("method", "setLoop")) player.setLoop(Boolean(nextChoices.loop));
        if (nextChoices.autoplay) player.play();
      };
      player.on("ready", applyChoices);
      // Player.js queues commands until ready; this also handles an existing player.
      applyChoices();
    } else {
      sendToPreview({ type: "tech180-video-options", id: activeId, choices: nextChoices });
    }
    setStatus(`${attribute === "autoplay" ? "Autoplay" : attribute === "muted" ? "Mute" : "Loop"} ${enabled ? "enabled" : "disabled"}`);
  }

  function matchingTextElements() {
    const needle = findText.trim().toLowerCase();
    if (!needle) return [];
    return elements.filter(
      (element) => element.type === "text" && element.value.toLowerCase().includes(needle)
    );
  }

  function findNext() {
    const matches = matchingTextElements();
    if (!matches.length) {
      setStatus(findText.trim() ? `No matches for “${findText.trim()}”` : "Enter text to find");
      setFindIndex(-1);
      return;
    }
    const nextIndex = (findIndex + 1) % matches.length;
    setFindIndex(nextIndex);
    selectElement(matches[nextIndex].id, true);
    setStatus(`Match ${nextIndex + 1} of ${matches.length}`);
  }

  function replaceNext() {
    const matches = matchingTextElements();
    if (!matches.length) {
      findNext();
      return;
    }
    const match = matches[Math.max(findIndex, 0) % matches.length];
    const expression = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const nextValue = match.value.replace(expression, replaceText);
    selectElement(match.id, true);
    sendToPreview({ type: "tech180-update", id: match.id, elementType: match.type, value: nextValue });
    setHtml((currentHtml) => replaceElementValue(currentHtml, match, nextValue));
    setElements((current) => current.map((element) =>
      element.id === match.id ? { ...element, value: nextValue, label: nextValue.slice(0, 80) } : element
    ));
    setStatus("Replaced next match");
  }

  function replaceAll() {
    const needle = findText.trim();
    const matches = matchingTextElements();
    if (!matches.length) {
      findNext();
      return;
    }
    const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const doc = new DOMParser().parseFromString(html, "text/html");
    let count = 0;
    matches.forEach((match) => {
      const node = doc.querySelector(match.selector);
      if (!node) return;
      const nextValue = match.value.replace(expression, () => {
        count += 1;
        return replaceText;
      });
      node.textContent = nextValue;
    });
    const nextHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;
    const nextElements = buildEditableElements(doc);
    setHtml(nextHtml);
    setIframeHtml(nextHtml);
    setElements(nextElements);
    setActiveId("");
    setFindIndex(-1);
    setStatus(`Replaced ${count} instance${count === 1 ? "" : "s"}`);
  }

  function updateActiveCss(nextCss) {
    if (!activeElement) return;
    setActiveCss(nextCss);
    sendToPreview({
      type: "tech180-css-update",
      id: activeElement.id,
      css: nextCss,
    });
    setHtml((currentHtml) => replaceElementCss(currentHtml, activeElement.id, nextCss));
  }

  function applyActiveHtml() {
    if (!activeElement || !activeHtml.trim()) return;
    try {
      const nextDocument = replaceElementHtml(html, activeElement.id, activeHtml);
      setHtml(nextDocument);
      setHtmlEditError("");
      sendToPreview({
        type: "tech180-html-update",
        id: activeElement.id,
        html: activeHtml,
      });
      setStatus(`HTML updated for ${activeElement.tag}`);
    } catch (err) {
      setHtmlEditError(err.message);
    }
  }

  async function exportProject() {
    if (!html) return;
    setIsImporting(true);
    setImportProgress(12);
    setStatus("Separating HTML, CSS, and JavaScript");
    setError("");

    try {
      await nextPaint();
      if (page?.source_url) pageCacheRef.current.set(page.source_url, { ...page, html, elements });
      const pages = pageTabs.length ? pageTabs : [{ title: page?.title, url: page?.source_url }];
      const uniquePages = pages.filter((item, index, all) =>
        item.url && all.findIndex((other) => other.url.replace(/\/$/, "") === item.url.replace(/\/$/, "")) === index
      );
      const files = {};
      const urlToFilename = new Map();

      for (let index = 0; index < uniquePages.length; index += 1) {
        const item = uniquePages[index];
        const baseName = pageFileBase(item.url, index);
        const cachedPage = pageCacheRef.current.get(item.url);
        const pageFiles = cachedPage
          ? buildSeparatedExport(cachedPage.html, baseName)
          : await (async () => {
              setStatus(`Importing export page ${index + 1} of ${uniquePages.length}`);
              setImportProgress(12 + Math.round((index / uniquePages.length) * 65));
              const response = await fetch(`${API_BASE}/api/import`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: item.url, include_subpages: false }),
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.detail || `Could not import ${item.url}`);
              return buildSeparatedExport(data.html, baseName);
            })();
        Object.assign(files, pageFiles);
        urlToFilename.set(item.url.replace(/\/$/, ""), `${baseName ? baseName.slice(0, -1) : "index"}.html`);
      }
      rewriteExportLinks(files, urlToFilename);
      const exportAssets = [];
      const usedNames = new Set();
      largeVideoFilesRef.current.forEach((file, objectUrl) => {
        let safeName = file.name.replace(/[^a-z0-9._-]+/gi, "-");
        let suffix = 2;
        while (usedNames.has(safeName)) {
          const dot = safeName.lastIndexOf(".");
          const stem = dot >= 0 ? safeName.slice(0, dot) : safeName;
          const extension = dot >= 0 ? safeName.slice(dot) : "";
          safeName = `${stem}-${suffix}${extension}`;
          suffix += 1;
        }
        usedNames.add(safeName);
        Object.keys(files).filter((name) => name.endsWith(".html")).forEach((name) => {
          files[name] = files[name].replaceAll(objectUrl, `assets/${safeName}`);
        });
        exportAssets.push({ file, safeName });
      });
      setImportProgress(35);
      setStatus("Saving project folder");
      await nextPaint();

      let response;
      if (exportAssets.length) {
        const form = new FormData();
        form.append("files_json", JSON.stringify(files));
        exportAssets.forEach(({ file, safeName }) => form.append("assets", file, safeName));
        response = await fetch(`${API_BASE}/api/export-assets`, { method: "POST", body: form });
      } else {
        response = await fetch(`${API_BASE}/api/export`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files }),
        });
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Folder export failed.");
      }
      setImportProgress(100);
      setStatus(`${data.folder_name} saved to ${data.path}`);
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("Export canceled");
      } else {
        setError(`Could not export the project: ${err.message}`);
        setStatus("");
      }
    } finally {
      window.setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
      }, 650);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="mark">180</div>
          <div>
            <h1>Tech180</h1>
            <p>Website recreation editor</p>
          </div>
        </div>

        <form
          className="import-form"
          onSubmit={(event) => {
            event.preventDefault();
            importUrl();
          }}
        >
          <label htmlFor="url">Web URL</label>
          <div className="url-row">
            <input
              id="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.oracle.com/consulting/"
            />
            <button type="submit" disabled={isImporting}>
              {isImporting ? "Importing" : "Import"}
            </button>
          </div>
        </form>

        <div className="saved-import">
          <span>Continue a saved project</span>
          <div className="saved-import-actions">
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
              Open project
            </button>
            <button type="button" onClick={() => folderInputRef.current?.click()} disabled={isImporting}>
              Open folder
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".zip,.html,.htm,application/zip,text/html"
            onChange={(event) => importLocalFiles(event.target.files)}
          />
          <input
            ref={folderInputRef}
            className="visually-hidden"
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            onChange={(event) => importLocalFiles(event.target.files)}
          />
        </div>

        {isImporting && (
          <div className="import-progress" aria-label="Import in progress">
            <span style={{ width: `${importProgress}%` }} />
            <strong>{importProgress}%</strong>
          </div>
        )}

        <div className="status-line">
          {status && <span>{status}</span>}
          {error && <strong>{error}</strong>}
        </div>

        <section className="find-replace" aria-label="Find and replace">
          <label htmlFor="find-text">Find + Replace</label>
          <input
            id="find-text"
            value={findText}
            onChange={(event) => { setFindText(event.target.value); setFindIndex(-1); }}
            placeholder="Find text"
            disabled={!html}
          />
          <input
            value={replaceText}
            onChange={(event) => setReplaceText(event.target.value)}
            placeholder="Replace with"
            aria-label="Replacement text"
            disabled={!html}
          />
          <div className="find-actions">
            <button type="button" onClick={findNext} disabled={!html || !findText.trim()}>Find next</button>
            <button type="button" onClick={replaceNext} disabled={!html || !findText.trim()}>Replace next</button>
            <button type="button" onClick={replaceAll} disabled={!html || !findText.trim()}>Replace all</button>
          </div>
        </section>

        <section className="editor-panel">
          <div className="panel-heading">
            <h2>Page elements</h2>
            <button type="button" onClick={exportProject} disabled={!html || isImporting}>
              Export folder
            </button>
          </div>

          <p className="element-help">Click an item to select it. Use the Selection controls on the right to climb through its containers.</p>
          <div className="element-filters">
            <select
              value={elementTypeFilter}
              onChange={(event) => setElementTypeFilter(event.target.value)}
              aria-label="Filter by element type"
            >
              <option value="all">All elements</option>
              <option value="text">Text</option>
              <option value="image">Images</option>
              <option value="link">Links</option>
              <option value="embed">Embeds</option>
              <option value="video">Videos</option>
              <option value="iframe">Iframes</option>
              <option value="div">DIVs</option>
              <option value="container">All containers</option>
            </select>
            <input
              className="element-filter"
              value={elementFilter}
              onChange={(event) => setElementFilter(event.target.value)}
              placeholder="Custom text…"
              aria-label="Filter page elements by custom text"
            />
          </div>

          <div className="element-list">
            {visibleElements.map((element) => (
              <button
                key={element.id}
                type="button"
                className={element.id === activeId ? "element-row active" : "element-row"}
                onClick={() => selectElement(element.id, true)}
              >
                <span>{element.type}</span>
                <strong>{element.label || element.tag}</strong>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="workspace">
        {pageTabs.length > 0 && (
          <nav className="page-tabs" aria-label="Editable pages">
            {pageTabs.map((tab) => (
              <button
                key={tab.url}
                type="button"
                className={tab.url === page?.source_url ? "active" : ""}
                onClick={() => switchPageTab(tab)}
                disabled={isImporting}
                title={tab.url}
              >
                {tab.title}
              </button>
            ))}
          </nav>
        )}
        <header className="topbar">
          <div>
            <h2>{page?.title || "Import a page to begin"}</h2>
            <p>
              {page?.source_url
                ? "Preview is ready. Select an element to replace text, images, or links."
                : "Tech180 will turn the page into an editable recreation."}
            </p>
          </div>
        </header>

        <div className="work-area">
          <div className="preview-pane" ref={previewPaneRef}>
            {html ? (
              <>
                <div className="preview-label">
                  <span>Preview</span>
                  <strong>{page?.source_url}</strong>
                </div>
                <iframe
                  ref={previewFrameRef}
                  title="Tech180 recreated page"
                  srcDoc={previewHtml}
                  sandbox="allow-scripts allow-same-origin"
                  onLoad={() => {
                    if (activeId) {
                      sendToPreview({ type: "tech180-activate", id: activeId, scroll: false });
                    }
                  }}
                />
              </>
            ) : (
              <div className="empty-preview">Tech180 preview</div>
            )}
          </div>

          <aside className="properties">
            <h2>Selected element</h2>
            {activeElement ? (
              <>
                <div className="property-meta">
                  <span>{activeElement.tag}</span>
                  <strong>{activeElement.type}</strong>
                </div>
                <section className="selection-block">
                  <strong>Selection</strong>
                  <p>Select an element, then move upward until the correct parent is outlined. The HTML below follows your selection.</p>
                  <div className="selection-actions">
                  <button type="button" onClick={selectParentDiv} title="Select one higher HTML level">↑ Parent</button>
                  <button type="button" className="hide-element" onClick={hideActiveElement}>Hide</button>
                  <button type="button" className="show-element" onClick={unhideActiveElement} disabled={!activeElementHidden}>Unhide</button>
                  <button type="button" onClick={undoLastCommand} disabled={!commandHistory.length}>Undo last</button>
                  </div>
                </section>
                {activeElement.type !== "container" && (
                  <>
                    <label htmlFor="value">
                      {activeElement.type === "link"
                        ? "Link URL"
                        : activeElement.type === "embed"
                          ? "Video / embed source URL"
                          : activeElement.type === "image"
                            ? "Image source"
                            : "Value"}
                    </label>
                    {activeElement.type === "text" ? (
                      <textarea
                        id="value"
                        value={activeElement.value}
                        onChange={(event) => updateActiveValue(event.target.value)}
                      />
                    ) : (
                      <input
                        id="value"
                        value={activeElement.value}
                        onChange={(event) => updateActiveValue(event.target.value)}
                      />
                    )}
                    {activeElement.type === "image" && (
                      <section className="image-replacer">
                        <label className="image-picker">
                          Choose local image
                          <input type="file" accept="image/*" onChange={chooseLocalImage} />
                        </label>
                        <div className="image-comparison">
                          <figure>
                            <figcaption>Old</figcaption>
                            <img
                              src={imageComparison?.id === activeElement.id ? imageComparison.oldSource : activeElement.value}
                              alt="Current element before replacement"
                            />
                          </figure>
                          <figure>
                            <figcaption>New</figcaption>
                            {imageComparison?.id === activeElement.id ? (
                              <img src={imageComparison.newSource} alt="New local replacement" />
                            ) : (
                              <span>No replacement selected</span>
                            )}
                          </figure>
                        </div>
                      </section>
                    )}
                    {isVideoElement(activeElement) && (
                      <section className="image-replacer video-replacer">
                        {activeVideoOptions && (
                          <div className="video-options">
                            <label>
                              <input
                                type="checkbox"
                                checked={activeVideoOptions.loop}
                                onChange={(event) => updateVideoOption("loop", event.target.checked)}
                              />
                              Loop
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={activeVideoOptions.autoplay}
                                onChange={(event) => updateVideoOption("autoplay", event.target.checked)}
                              />
                              Autoplay
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={activeVideoOptions.muted}
                                onChange={(event) => updateVideoOption("muted", event.target.checked)}
                              />
                              Mute
                            </label>
                          </div>
                        )}
                        <label className="image-picker">
                          Choose local video
                          <input type="file" accept="video/*" onChange={chooseLocalVideo} />
                        </label>
                        <div className="image-comparison video-comparison">
                          <figure>
                            <figcaption>Old</figcaption>
                            {activeElement.tag === "iframe" ? (
                              <iframe
                                className="video-thumbnail"
                                src={videoComparison?.id === activeElement.id ? videoComparison.oldSource : activeElement.value}
                                title="Current video preview"
                              />
                            ) : (
                              <video
                                className="video-thumbnail"
                                src={videoComparison?.id === activeElement.id ? videoComparison.oldSource : activeElement.value}
                                muted
                              />
                            )}
                          </figure>
                          <figure>
                            <figcaption>New</figcaption>
                            {videoComparison?.id === activeElement.id ? (
                              <video
                                className={videoComparison.newIsPortrait ? "portrait-video-thumbnail" : ""}
                                src={videoComparison.newSource}
                                controls
                                muted
                              />
                            ) : (
                              <span>No replacement selected</span>
                            )}
                          </figure>
                        </div>
                      </section>
                    )}
                  </>
                )}
                <div className="html-inspector">
                  <div className="code-editor-heading">
                    <label htmlFor="active-html">Element HTML</label>
                    <button type="button" onClick={applyActiveHtml}>
                      Apply HTML
                    </button>
                  </div>
                  <textarea
                    id="active-html"
                    className="html-code"
                    value={activeHtml}
                    onChange={(event) => setActiveHtml(event.target.value)}
                    spellCheck="false"
                    aria-label="Editable HTML for selected element"
                  />
                  {htmlEditError && <strong className="code-error">{htmlEditError}</strong>}
                </div>
                <div className="css-inspector">
                  <div className="code-editor-heading">
                    <label htmlFor="active-css">Active CSS</label>
                    <span>Live editor</span>
                  </div>
                  <textarea
                    id="active-css"
                    className="css-code"
                    value={activeCss}
                    onChange={(event) => updateActiveCss(event.target.value)}
                    spellCheck="false"
                    aria-label="Editable active CSS for selected element"
                  />
                </div>
              </>
            ) : (
              <p className="muted">Select a detected element from the list or click one in the preview.</p>
            )}

            {page?.warnings?.length > 0 && (
              <div className="warnings">
                {page.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

export default App;
