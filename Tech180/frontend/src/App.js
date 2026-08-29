import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Player as GumletPlayer } from "@gumlet/player.js";
import { createClient } from "@supabase/supabase-js";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8050";
const DEVELOPMENT_API_TOKEN = process.env.REACT_APP_TECH180_API_TOKEN || "";
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY || "";
const GATEWAY_URL = process.env.REACT_APP_GATEWAY_URL || "https://jisystems.net/app/gateway/?tool=tech180";
const supabaseClient = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;

function downloadBrowserFile(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

// Only the local development launcher supplies this browser-visible token.
// Production must replace it with a secure server session from the gateway.
async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (DEVELOPMENT_API_TOKEN) headers.set("X-Tech180-API-Key", DEVELOPMENT_API_TOKEN);
  if (!DEVELOPMENT_API_TOKEN && supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}
const CONTENT_SELECTOR = "h1,h2,h3,h4,h5,h6,p,a,button,span,li,figcaption,blockquote,img,iframe,video";
const CONTAINER_SELECTOR = "div,section,article,header,footer,main,nav,aside,form";
const CONTAINER_TAGS = new Set([
  "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "NAV", "ASIDE", "FORM",
]);
const VIDEO_EMBED_HOSTS = ["gumlet.io", "youtube.com", "youtu.be", "vimeo.com", "wistia.com", "wistia.net"];
const SIDEBAR_PAGE_SIZE = 250;

function Tech180Footer() {
  return (
    <footer className="tech180-footer">
      <div className="tech180-footer__inner">
        <a className="tech180-footer__brand" href="https://jisystems.net/">J.I. Systems</a>
        <nav aria-label="Tech180 footer navigation">
          <a href="https://jisystems.net/tools/">Tools</a>
          <a href="https://jisystems.net/memberships/">Memberships</a>
          <a href="https://jisystems.net/privacy.html">Privacy</a>
          <a href="https://jisystems.net/terms.html">Terms</a>
        </nav>
        <span>© 2026 J.I. Systems</span>
      </div>
    </footer>
  );
}

function editorPreviewWidth(previewPaneRef) {
  const measuredWidth = Math.round(previewPaneRef.current?.clientWidth || 1120);
  return Math.max(640, Math.min(1920, measuredWidth));
}

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
  const containerCandidates = Array.from(doc.querySelectorAll(CONTAINER_SELECTOR));
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
    elements.push({
      id,
      type,
      label: (label || `${node.tagName.toLowerCase()} ${elements.length + 1}`).slice(0, 80),
      selector: `[data-tech180-id="${id}"]`,
      value,
      tag: node.tagName.toLowerCase(),
      button_like:
        node.tagName === "BUTTON" ||
        node.getAttribute("role") === "button" ||
        /(^|[-_])(btn|button|cta)([-_]|$)/i.test(Array.from(node.classList).join(" ")) ||
        (node.tagName === "A" && node.style.backgroundColor && node.style.backgroundColor !== "rgba(0, 0, 0, 0)"),
    });
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

  // The rendered backend snapshot already places the browser-selected image in
  // `src`. Remove stale responsive candidates so they cannot override it inside
  // Tech180's differently-sized preview frame.
  doc.querySelectorAll("img[src]").forEach((image) => {
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    image.setAttribute("loading", "eager");
  });

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

    var tech180CssProperties = [
      "align-content", "align-items", "align-self", "aspect-ratio",
      "background", "background-color", "background-image", "background-position",
      "background-repeat", "background-size", "border", "border-radius", "bottom",
      "box-shadow", "box-sizing", "clear", "color", "column-gap", "cursor",
      "display", "flex", "flex-basis", "flex-direction", "flex-grow", "flex-shrink",
      "flex-wrap", "float", "font", "font-family", "font-size", "font-style",
      "font-weight", "gap", "grid", "grid-area", "grid-template", "height",
      "justify-content", "justify-items", "justify-self", "left", "letter-spacing",
      "line-height", "list-style", "margin", "max-height", "max-width", "min-height",
      "min-width", "object-fit", "opacity", "overflow", "overflow-x", "overflow-y",
      "padding", "place-content", "place-items", "position", "right", "row-gap",
      "text-align", "text-decoration", "text-transform", "top", "transform",
      "transform-origin", "vertical-align", "visibility", "white-space", "width",
      "z-index"
    ];

    function tech180ReportCss(node) {
      if (!node) return;
      var styles = window.getComputedStyle(node);
      var declarations = tech180CssProperties
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
          html: node.outerHTML,
          classes: Array.prototype.slice.call(node.classList).filter(function(className) {
            return className.indexOf("tech180-captured-") !== 0;
          }),
          classCss: Array.prototype.slice.call(node.classList).some(function(className) {
            return className.indexOf("tech180-captured-") !== 0;
          })
            ? "." + CSS.escape(Array.prototype.slice.call(node.classList).find(function(className) {
                return className.indexOf("tech180-captured-") !== 0;
              })) + " {\\n" + declarations + "\\n}"
            : ""
        },
        "*"
      );
    }

    function tech180ReportClass(activeId, className, inherited, probeOnly) {
      var active = document.querySelector('[data-tech180-id="' + CSS.escape(activeId) + '"]');
      if (!active || !className) return;
      var owner = active;
      if (inherited) {
        owner = active.parentElement;
        while (owner && !owner.classList.contains(className)) owner = owner.parentElement;
      }
      if (!owner) return;

      var allProperties = tech180CssProperties;
      // Disable Tech180's frozen snapshot while measuring so it cannot mask
      // what the original website class actually contributes. Compare the
      // selected child with the class present and temporarily removed.
      var capturedStyles = Array.prototype.slice.call(
        document.querySelectorAll('style[data-tech180-captured-styles]')
      );
      var previousDisabled = capturedStyles.map(function(style) {
        return style.sheet ? style.sheet.disabled : false;
      });
      capturedStyles.forEach(function(style) {
        if (style.sheet) style.sheet.disabled = true;
      });

      // Older projects stored the entire computed snapshot inline. Temporarily
      // remove those values along the selected-to-owner path while measuring.
      var measurementNodes = [];
      var measurementNode = active;
      while (measurementNode) {
        measurementNodes.push({
          node: measurementNode,
          hadStyle: measurementNode.hasAttribute("style"),
          style: measurementNode.getAttribute("style") || ""
        });
        if (measurementNode === owner) break;
        measurementNode = measurementNode.parentElement;
      }
      measurementNodes.forEach(function(entry) { entry.node.removeAttribute("style"); });

      var withClassStyles = window.getComputedStyle(active);
      var withClass = {};
      allProperties.forEach(function(property) {
        withClass[property] = withClassStyles.getPropertyValue(property);
      });

      owner.classList.remove(className);
      var withoutClassStyles = window.getComputedStyle(active);
      var withoutClass = {};
      allProperties.forEach(function(property) {
        withoutClass[property] = withoutClassStyles.getPropertyValue(property);
      });
      owner.classList.add(className);
      measurementNodes.forEach(function(entry) {
        if (entry.hadStyle) entry.node.setAttribute("style", entry.style);
      });
      capturedStyles.forEach(function(style, index) {
        if (style.sheet) style.sheet.disabled = previousDisabled[index];
      });

      var contributingProperties = [];
      var declarations = allProperties.map(function(property) {
        var value = withClass[property];
        if (!value || value === withoutClass[property]) return "";
        contributingProperties.push(property);
        return "  " + property + ": " + value + ";";
      }).filter(Boolean).join("\\n");
      if (!declarations) declarations = "  /* This class adds no CSS attributes to the selected element. */";
      window.parent.postMessage({
        type: probeOnly ? "tech180-class-contribution" : "tech180-class-css",
        id: activeId,
        className: className,
        contributes: contributingProperties.length > 0,
        properties: contributingProperties,
        css: "." + CSS.escape(className) + " {\\n" + declarations + "\\n}"
      }, "*");
    }

    function tech180FindClassForProperty(activeId, property, options) {
      var active = document.querySelector('[data-tech180-id="' + CSS.escape(activeId) + '"]');
      if (!active || !property) return;
      var capturedStyles = Array.prototype.slice.call(
        document.querySelectorAll('style[data-tech180-captured-styles]')
      );
      var previousDisabled = capturedStyles.map(function(style) {
        return style.sheet ? style.sheet.disabled : false;
      });
      capturedStyles.forEach(function(style) {
        if (style.sheet) style.sheet.disabled = true;
      });

      var match = null;
      (options || []).some(function(option) {
        var owner = active;
        if (option.inherited) {
          owner = active.parentElement;
          while (owner && !owner.classList.contains(option.className)) owner = owner.parentElement;
        }
        if (!owner || !owner.classList.contains(option.className)) return false;
        var measurementNodes = [];
        var measurementNode = active;
        while (measurementNode) {
          measurementNodes.push({
            node: measurementNode,
            hadStyle: measurementNode.hasAttribute("style"),
            style: measurementNode.getAttribute("style") || ""
          });
          if (measurementNode === owner) break;
          measurementNode = measurementNode.parentElement;
        }
        measurementNodes.forEach(function(entry) { entry.node.removeAttribute("style"); });
        var withClass = window.getComputedStyle(active).getPropertyValue(property);
        owner.classList.remove(option.className);
        var withoutClass = window.getComputedStyle(active).getPropertyValue(property);
        owner.classList.add(option.className);
        measurementNodes.forEach(function(entry) {
          if (entry.hadStyle) entry.node.setAttribute("style", entry.style);
        });
        if (withClass !== withoutClass) {
          match = option;
          return true;
        }
        return false;
      });

      capturedStyles.forEach(function(style, index) {
        if (style.sheet) style.sheet.disabled = previousDisabled[index];
      });
      if (match) {
        tech180ReportClass(activeId, match.className, Boolean(match.inherited));
      } else {
        window.parent.postMessage({ type: "tech180-class-not-found", property: property }, "*");
      }
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
      if (event.data && event.data.type === "tech180-class-css-update") {
        var classStyle = document.querySelector("style[data-tech180-live-class]");
        if (!classStyle) {
          classStyle = document.createElement("style");
          classStyle.setAttribute("data-tech180-live-class", "true");
          document.head.appendChild(classStyle);
        }
        var classRules = classStyle.tech180Rules || {};
        var classSelector = event.data.selector || "." + CSS.escape(event.data.className);
        classRules[classSelector] = event.data.ruleText || classSelector + " {" + (event.data.css || "") + "}";
        classStyle.tech180Rules = classRules;
        classStyle.textContent = Object.keys(classRules).map(function(name) { return classRules[name]; }).join("\\n");
      }
      if (event.data && event.data.type === "tech180-report-class") {
        tech180ReportClass(
          event.data.id,
          event.data.className,
          Boolean(event.data.inherited),
          Boolean(event.data.probeOnly)
        );
      }
      if (event.data && event.data.type === "tech180-find-class-for-property") {
        tech180FindClassForProperty(event.data.id, event.data.property, event.data.options || []);
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

// Captured computed styles are inline, so shared class edits need !important
// to visibly override them across every member of the selected class.
function importantCssDeclarations(css) {
  return cssDeclarations(css)
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => `${declaration.replace(/\s*!important\s*$/i, "")} !important;`)
    .join("\n");
}

const INHERITED_CSS_PROPERTIES = new Set([
  "color", "cursor", "font", "font-family", "font-size", "font-style",
  "font-weight", "letter-spacing", "line-height", "list-style", "text-align",
  "text-decoration", "text-transform", "visibility", "white-space",
]);

function inheritedImportantCssDeclarations(css) {
  return importantCssDeclarations(css)
    .split("\n")
    .filter((declaration) => INHERITED_CSS_PROPERTIES.has(declaration.split(":", 1)[0].trim()))
    .join("\n");
}

// Convert CSS rgb()/rgba()/hex values into the six-digit format expected by
// the browser's native color picker.
function colorToHex(value) {
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) return `#${hex.slice(0, 3).split("").map((part) => part + part).join("")}`;
    return `#${hex.slice(0, 6)}`;
  }
  const numbers = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!numbers || numbers.length < 3) return "#000000";
  return `#${numbers.map((number) => Math.max(0, Math.min(255, Math.round(number))).toString(16).padStart(2, "0")).join("")}`;
}

function cssColorOccurrences(css) {
  return css.split("\n").flatMap((line, lineIndex) => {
    const matches = [...line.matchAll(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi)];
    return matches.map((match, colorIndex) => ({
      key: `${lineIndex}-${match.index}-${match[0]}`,
      lineIndex,
      colorIndex,
      property: line.match(/^\s*([a-z-]+)\s*:/i)?.[1] || "CSS color",
      value: match[0],
      hex: colorToHex(match[0]),
    }));
  });
}

function replaceCssColorOnLine(css, lineIndex, oldValue, nextValue) {
  const lines = css.split("\n");
  if (lines[lineIndex] !== undefined) {
    lines[lineIndex] = lines[lineIndex].replace(oldValue, nextValue);
  }
  return lines.join("\n");
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
  stylesheet.href = `css/${baseName}styles.css`;
  doc.head.appendChild(stylesheet);

  const script = doc.createElement("script");
  script.src = `js/${baseName}script.js`;
  script.defer = true;
  doc.body.appendChild(script);

  return {
    [`${baseName ? baseName.slice(0, -1) : "index"}.html`]: "<!doctype html>\n" + doc.documentElement.outerHTML,
    [`css/${baseName}styles.css`]: cssParts.join("\n\n") + "\n",
    [`js/${baseName}script.js`]:
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

// FastAPI validation errors are arrays of objects. Turn them into a useful
// sentence instead of letting JavaScript display "[object Object]".
function apiErrorMessage(detail, fallback) {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (typeof item === "string" ? item : item?.msg))
      .filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  if (detail && typeof detail === "object") {
    return detail.msg || detail.message || fallback;
  }
  return fallback;
}

function App() {
  const previewPaneRef = useRef(null);
  const previewFrameRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const localObjectUrlsRef = useRef(new Map());
  const largeVideoFilesRef = useRef(new Map());
  const pageCacheRef = useRef(new Map());
  // Preserve the URL entered on the J.I. Systems tool page. The gateway carries
  // it forward as ?url=..., so it is ready in Tech180's opening input field.
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get("url") || "");
  const [page, setPage] = useState(null);
  const [html, setHtml] = useState("");
  const [iframeHtml, setIframeHtml] = useState("");
  const [elements, setElements] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [activeCss, setActiveCss] = useState("");
  const [elementCssDraft, setElementCssDraft] = useState("#element {\n\n}");
  const [activeHtml, setActiveHtml] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [classCss, setClassCss] = useState("");
  const [classContributions, setClassContributions] = useState({});
  const [htmlEditError, setHtmlEditError] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isGraduatingCss, setIsGraduatingCss] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findIndex, setFindIndex] = useState(-1);
  const [pageTabs, setPageTabs] = useState([]);
  const [exportPageUrls, setExportPageUrls] = useState(new Set());
  const [commandHistory, setCommandHistory] = useState([]);
  const [elementFilter, setElementFilter] = useState("");
  const [elementTypeFilter, setElementTypeFilter] = useState("all");
  const [elementListPage, setElementListPage] = useState(0);
  const [imageComparison, setImageComparison] = useState(null);
  const [videoComparison, setVideoComparison] = useState(null);
  const [videoOptionChoices, setVideoOptionChoices] = useState({});
  const productionAuthEnabled = !DEVELOPMENT_API_TOKEN && Boolean(supabaseClient);
  const [accessState, setAccessState] = useState(productionAuthEnabled ? "checking" : "approved");
  const [accessMessage, setAccessMessage] = useState("Checking your Tech180 membership…");

  useEffect(() => {
    if (!productionAuthEnabled) return undefined;
    let canceled = false;

    async function verifyProductionAccess() {
      try {
        const response = await apiFetch("/api/access", { headers: { Accept: "application/json" } });
        const result = await response.json().catch(() => ({}));
        if (canceled) return;
        if (response.ok && result.authorized === true) {
          setAccessState("approved");
          return;
        }
        if (response.status === 401) {
          const gateway = new URL(GATEWAY_URL);
          gateway.searchParams.set("tool", "tech180");
          const requestedUrl = new URLSearchParams(window.location.search).get("url");
          if (requestedUrl) gateway.searchParams.set("url", requestedUrl);
          window.location.replace(gateway.href);
          return;
        }
        setAccessState("denied");
        setAccessMessage(result.detail || "Your membership does not currently include Tech180 access.");
      } catch {
        if (!canceled) {
          setAccessState("unavailable");
          setAccessMessage("Tech180 could not reach its secure backend. Please try again shortly.");
        }
      }
    }

    verifyProductionAccess();
    return () => { canceled = true; };
  }, [productionAuthEnabled]);

  const activeElement = elements.find((element) => element.id === activeId);
  const visibleElements = useMemo(() => {
    const customQuery = elementFilter.trim().toLowerCase();
    const findQuery = findText.trim().toLowerCase();
    const document = html ? new DOMParser().parseFromString(html, "text/html") : null;

    return elements.filter((element) => {
      const typeMatches =
        elementTypeFilter === "all" ||
        element.type === elementTypeFilter ||
        (elementTypeFilter === "div" && element.tag === "div") ||
        (elementTypeFilter === "video" && isVideoElement(element)) ||
        (elementTypeFilter === "iframe" && element.tag === "iframe") ||
        (elementTypeFilter === "button" && (element.tag === "button" || element.button_like));

      // Search the real element so Find can match tags, IDs, classes, any
      // attribute, visible text, URLs, and descriptions such as image alt text.
      const node = document?.querySelector(element.selector);
      const attributes = node
        ? Array.from(node.attributes).map((attribute) => `${attribute.name} ${attribute.value}`).join(" ")
        : "";
      const searchableText = [
        `<${element.tag}>`,
        element.tag,
        element.type,
        element.id,
        element.label,
        element.value,
        attributes,
        node?.textContent || "",
      ].join(" ").toLowerCase();

      const customMatches = !customQuery || searchableText.includes(customQuery);
      const findMatches = !findQuery || searchableText.includes(findQuery);
      return typeMatches && customMatches && findMatches;
    });
  }, [elements, elementFilter, elementTypeFilter, findText, html]);
  const elementPageCount = Math.max(1, Math.ceil(visibleElements.length / SIDEBAR_PAGE_SIZE));
  const sidebarElements = visibleElements.slice(
    elementListPage * SIDEBAR_PAGE_SIZE,
    (elementListPage + 1) * SIDEBAR_PAGE_SIZE
  );

  useEffect(() => {
    setElementListPage(0);
  }, [elements, elementFilter, elementTypeFilter, findText]);
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
  const activeIdentity = useMemo(() => {
    const emptyIdentity = {
      id: "", classes: [], classOptions: [], inlineProperties: [], elementCss: "#element {\n\n}",
    };
    if (!html || !activeId) return emptyIdentity;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const node = doc.querySelector(`[data-tech180-id="${CSS.escape(activeId)}"]`);
    if (!node) return emptyIdentity;

    const isSourceClass = (className) => !className.startsWith("tech180-captured-");
    const ownClasses = Array.from(node.classList).filter(isSourceClass);
    const classOptions = ownClasses.map((className) => ({ className, inherited: false }));
    const seen = new Set(ownClasses);
    let ancestor = node.parentElement;
    while (ancestor && ancestor !== doc.documentElement) {
      Array.from(ancestor.classList).filter(isSourceClass).forEach((className) => {
        if (seen.has(className)) return;
        seen.add(className);
        classOptions.push({
          className,
          inherited: true,
          ancestorTag: ancestor.tagName.toLowerCase(),
        });
      });
      ancestor = ancestor.parentElement;
    }
    const inlineProperties = Array.from(node.style);
    const inlineDeclarations = inlineProperties
      .map((property) => {
        const value = node.style.getPropertyValue(property);
        const priority = node.style.getPropertyPriority(property);
        return `  ${property}: ${value}${priority ? " !important" : ""};`;
      })
      .join("\n");
    return {
      id: node.id || "",
      classes: ownClasses,
      classOptions,
      inlineProperties,
      elementCss: `#element {\n${inlineDeclarations}\n}`,
    };
  }, [html, activeId]);
  const elementClassOption = { className: "#element", element: true };
  const contributingClassOptions = [
    ...activeIdentity.classOptions.filter(
      (option) => classContributions[option.className]?.contributes
    ),
    elementClassOption,
  ];
  const classControlledProperties = new Set(
    Object.values(classContributions).flatMap((entry) => entry.properties || [])
  );
  const elementDeclarations = activeCss
    .split("\n")
    .filter((line) => {
      const property = line.match(/^\s*([a-z-]+)\s*:/i)?.[1];
      return property && (
        activeIdentity.inlineProperties.includes(property) ||
        !classControlledProperties.has(property)
      );
    })
    .join("\n");
  const elementCss = `#element {\n${elementDeclarations}\n}`;
  const selectedClassOption = contributingClassOptions.find(
    (option) => option.className === selectedClass
  );
  const selectedClassIndex = contributingClassOptions.findIndex(
    (option) => option.className === selectedClass
  );

  useEffect(() => {
    setClassContributions({});
    setSelectedClass("");
    setClassCss("");
    activeIdentity.classOptions.forEach((option) => {
      sendToPreview({
        type: "tech180-report-class",
        id: activeId,
        className: option.className,
        inherited: option.inherited,
        probeOnly: true,
      });
    });
  }, [activeIdentity, activeId, activeCss]);

  useEffect(() => {
    if (!contributingClassOptions.length) {
      setSelectedClass("");
      setClassCss("");
      return;
    }
    if (!contributingClassOptions.some((option) => option.className === selectedClass)) {
      const firstOption = contributingClassOptions[0];
      setSelectedClass(firstOption.className);
      if (firstOption.element) {
        setClassCss(elementCss);
      } else {
        sendToPreview({
          type: "tech180-report-class",
          id: activeId,
          className: firstOption.className,
          inherited: firstOption.inherited,
        });
      }
    }
  }, [contributingClassOptions, selectedClass, activeId]);

  useEffect(() => {
    if (selectedClass === "#element") setClassCss(elementCss);
  }, [selectedClass, elementCss]);

  useEffect(() => {
    setElementCssDraft(elementCss);
  }, [activeId, elementCss]);

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
        const classes = event.data.classes || [];
        setSelectedClass((current) => classes.includes(current) ? current : (classes[0] || ""));
        setClassCss(event.data.classCss || "");
        setHtmlEditError("");
      }
      if (event.data?.type === "tech180-class-css") {
        setSelectedClass(event.data.className || "");
        setClassCss(event.data.css || "");
      }
      if (event.data?.type === "tech180-class-contribution") {
        setClassContributions((current) => ({
          ...current,
          [event.data.className]: {
            contributes: Boolean(event.data.contributes),
            properties: event.data.properties || [],
            css: event.data.css || "",
          },
        }));
      }
      if (event.data?.type === "tech180-class-not-found") {
        setStatus(`No source class directly controls ${event.data.property}`);
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

    const previewWidth = editorPreviewWidth(previewPaneRef);

    setIsImporting(true);
    setImportProgress(8);
    setStatus("Importing page");
    setError("");
    setActiveId("");
    setActiveCss("");
    setActiveHtml("");
    setHtmlEditError("");

    try {
      const response = await apiFetch(`/api/import`, {
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
        throw new Error(apiErrorMessage(data.detail, "Import failed."));
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
      // Every discovered page is included unless the user opts it out.
      setExportPageUrls(new Set(tabs.map((tab) => tab.url)));
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
        const previewWidth = editorPreviewWidth(previewPaneRef);
        const response = await apiFetch(`/api/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: tab.url, include_subpages: false, viewport_width: previewWidth }),
        });
        nextPage = await response.json();
        if (!response.ok) throw new Error(apiErrorMessage(nextPage.detail, "Page import failed."));
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

      const projectFile = files.find((file) =>
        /(^|\/)dev\/tech180-project\.json$/i.test(file.webkitRelativePath || file.name)
      );
      let projectSettings = null;
      if (projectFile) {
        try {
          projectSettings = JSON.parse(await projectFile.text());
        } catch {
          throw new Error("dev/tech180-project.json is not valid JSON.");
        }
      }
      setImportProgress(35);
      setStatus(`Preparing ${htmlFiles.length} saved page${htmlFiles.length === 1 ? "" : "s"}`);
      await nextPaint();

      const restoredPages = [];
      for (let index = 0; index < htmlFiles.length; index += 1) {
        const savedHtmlFile = htmlFiles[index];
        const rawHtml = await savedHtmlFile.text();
        const doc = new DOMParser().parseFromString(rawHtml, "text/html");
        doc.querySelectorAll("script").forEach((script) => script.remove());
        doc.querySelectorAll("[data-tech180-active]").forEach((node) => node.removeAttribute("data-tech180-active"));
        if (files.length > 1) {
          await restoreFolderStyles(doc, files, savedHtmlFile);
          restoreFolderAssets(doc, files, savedHtmlFile, localObjectUrlsRef.current);
        }
        const restoredElements = buildEditableElements(doc);
        const restoredHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;
        const relativeName = savedHtmlFile.webkitRelativePath || savedHtmlFile.name;
        const rootFilename = relativeName.split("/").pop();
        const metadata = projectSettings?.pages?.find((item) => item.filename === rootFilename);
        const title = metadata?.title || doc.title || rootFilename.replace(/\.html?$/i, "");
        const sourceLabel = metadata?.sourceUrl || relativeName;
        restoredPages.push({
          title,
          source_url: sourceLabel,
          html: restoredHtml,
          elements: restoredElements,
          subpages: [],
          warnings: ["Saved project restored locally. Active scripts remain disabled for preview safety."],
          render_mode: "local",
        });
        setImportProgress(35 + Math.round(((index + 1) / htmlFiles.length) * 50));
        await nextPaint();
      }

      const primaryFilename = htmlFile.name.split("/").pop();
      const restoredPage = restoredPages.find((item) =>
        projectSettings?.pages?.find((metadata) => metadata.filename === primaryFilename)?.sourceUrl === item.source_url
      ) || restoredPages[0];
      const tabs = restoredPages.map((item) => ({ title: item.title, url: item.source_url }));

      setPage(restoredPage);
      setHtml(restoredPage.html);
      setIframeHtml(restoredPage.html);
      setElements(restoredPage.elements);
      setUrl("");
      setActiveId(restoredPage.elements[0]?.id || "");
      setCommandHistory([]);
      setStatus(`${restoredPages.length} page${restoredPages.length === 1 ? "" : "s"} restored`);
      setPageTabs(tabs);
      const selectedUrls = projectSettings?.pages
        ?.filter((item) => item.selectedForExport !== false)
        .map((item) => item.sourceUrl);
      setExportPageUrls(new Set(selectedUrls?.length ? selectedUrls : tabs.map((tab) => tab.url)));
      setVideoOptionChoices(projectSettings?.videoOptions || {});
      pageCacheRef.current = new Map(restoredPages.map((item) => [item.source_url, item]));
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

  function updateElementCss(nextCss) {
    if (!activeElement) return;
    setElementCssDraft(nextCss);
    const declarations = importantCssDeclarations(nextCss);
    sendToPreview({
      type: "tech180-css-update",
      id: activeElement.id,
      css: declarations,
    });
    setHtml((currentHtml) => replaceElementCss(currentHtml, activeElement.id, declarations));
  }

  function selectClassOption(option) {
    if (!option) return;
    setSelectedClass(option.className);
    if (option.element) {
      setClassCss(elementCss);
      return;
    }
    sendToPreview({
      type: "tech180-report-class",
      id: activeId,
      className: option.className,
      inherited: option.inherited,
    });
  }

  function navigateClassSelection(destination) {
    const options = contributingClassOptions;
    if (!options.length) return;
    const currentIndex = Math.max(0, options.findIndex((option) => option.className === selectedClass));
    let nextIndex = currentIndex;
    if (destination === "top") nextIndex = 0;
    if (destination === "up") nextIndex = Math.max(0, currentIndex - 1);
    if (destination === "down") nextIndex = Math.min(options.length - 1, currentIndex + 1);
    if (destination === "bottom") nextIndex = options.length - 1;
    selectClassOption(options[nextIndex]);
  }

  function updateElementCssColor(lineIndex, oldValue, nextHex) {
    updateElementCss(replaceCssColorOnLine(elementCssDraft, lineIndex, oldValue, nextHex));
  }

  function updateClassCssColor(lineIndex, oldValue, nextHex) {
    setClassCss((current) => replaceCssColorOnLine(current, lineIndex, oldValue, nextHex));
  }

  function syncCssPickerScroll(event) {
    event.currentTarget.parentElement?.style.setProperty(
      "--css-scroll-top",
      `${event.currentTarget.scrollTop}px`
    );
  }

  function applyClassCss() {
    if (!selectedClass || !activeElement) return;
    const nextCss = classCss;
    setCommandHistory((current) => [...current, { type: "html", html, activeId }].slice(-30));
    if (selectedClass === "#element") {
      const declarations = importantCssDeclarations(nextCss);
      const nextHtml = replaceElementCss(html, activeElement.id, declarations);
      setHtml(nextHtml);
      setIframeHtml(nextHtml);
      setStatus("Applied CSS to #element and refreshed the preview");
      return;
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    let style = doc.querySelector("style[data-tech180-class-overrides]");
    if (!style) {
      style = doc.createElement("style");
      style.setAttribute("data-tech180-class-overrides", "true");
      doc.head.appendChild(style);
    }
    const selector = `.${CSS.escape(selectedClass)}`;
    const declarations = importantCssDeclarations(nextCss);

    // When a value graduates to a class, remove identical inline copies from
    // every matching member. Inherited properties are also cleaned from child
    // elements; differing values remain as intentional exceptions.
    const draftStyle = doc.createElement("div").style;
    draftStyle.cssText = cssDeclarations(nextCss);
    const declarationValues = new Map(
      Array.from(draftStyle).map((property) => [property, draftStyle.getPropertyValue(property).trim()])
    );
    const inheritedValues = new Map(
      Array.from(declarationValues).filter(([property]) => INHERITED_CSS_PROPERTIES.has(property))
    );
    const removeMatchingInlineValue = (node, property, value) => {
      if (node.style.getPropertyValue(property).trim() === value) node.style.removeProperty(property);
      if (!node.getAttribute("style")?.trim()) node.removeAttribute("style");
    };

    // Imported values usually live in shared internal capture classes instead
    // of style="". Split those classes when only some members graduate, so
    // other elements using the original capture class remain untouched.
    const capturedStyle = doc.querySelector("style[data-tech180-captured-styles]");
    const capturedRules = new Map();
    const capturedRulePattern = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g;
    let capturedMatch;
    while ((capturedMatch = capturedRulePattern.exec(capturedStyle?.textContent || ""))) {
      const ruleStyle = doc.createElement("div").style;
      ruleStyle.cssText = capturedMatch[2];
      capturedRules.set(capturedMatch[1], new Map(
        Array.from(ruleStyle).map((property) => [property, {
          value: ruleStyle.getPropertyValue(property).trim(),
          priority: ruleStyle.getPropertyPriority(property),
        }])
      ));
    }
    const captureVariants = new Map();
    const newCapturedRules = [];
    let captureVariantIndex = 1;
    const cleanCapturedValues = (node, values) => {
      Array.from(node.classList)
        .filter((className) => className.startsWith("tech180-captured-"))
        .forEach((className) => {
          const capturedDeclarations = capturedRules.get(className);
          if (!capturedDeclarations) return;
          const removable = Array.from(values).filter(([property, value]) =>
            capturedDeclarations.get(property)?.value === value
          ).map(([property]) => property);
          if (!removable.length) return;
          const variantKey = `${className}|${removable.sort().join("|")}`;
          if (!captureVariants.has(variantKey)) {
            const remaining = new Map(capturedDeclarations);
            removable.forEach((property) => remaining.delete(property));
            let variantClass = "";
            if (remaining.size) {
              do {
                variantClass = `tech180-captured-edit-${captureVariantIndex++}`;
              } while (doc.querySelector(`.${CSS.escape(variantClass)}`));
              const variantDeclarations = Array.from(remaining)
                .map(([property, entry]) => `  ${property}: ${entry.value}${entry.priority ? " !important" : ""};`)
                .join("\n");
              newCapturedRules.push(`.${variantClass} {\n${variantDeclarations}\n}`);
            }
            captureVariants.set(variantKey, variantClass);
          }
          node.classList.remove(className);
          const variantClass = captureVariants.get(variantKey);
          if (variantClass) node.classList.add(variantClass);
        });
    };
    doc.querySelectorAll(selector).forEach((owner) => {
      declarationValues.forEach((value, property) => {
        removeMatchingInlineValue(owner, property, value);
      });
      cleanCapturedValues(owner, declarationValues);
      owner.querySelectorAll("*").forEach((child) => {
        inheritedValues.forEach((value, property) => {
          removeMatchingInlineValue(child, property, value);
        });
        cleanCapturedValues(child, inheritedValues);
      });
    });
    if (capturedStyle && newCapturedRules.length) {
      capturedStyle.textContent = `${capturedStyle.textContent || ""}\n${newCapturedRules.join("\n")}`;
    }

    const rule = `${selector} {\n${declarations}\n}`;
    const inheritedDeclarations = selectedClassOption?.inherited
      ? inheritedImportantCssDeclarations(nextCss)
      : "";
    const descendantRule = inheritedDeclarations
      ? `\n${selector} ${activeElement.tag} {\n${inheritedDeclarations}\n}`
      : "";
    const ruleKey = `${selectedClass}:${selectedClassOption?.inherited ? activeElement.tag : "self"}`;
    const startMarker = `/* tech180-class:${ruleKey}:start */`;
    const endMarker = `/* tech180-class:${ruleKey}:end */`;
    const markedRule = `${startMarker}\n${rule}${descendantRule}\n${endMarker}`;
    const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rulePattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, "g");
    style.textContent = rulePattern.test(style.textContent || "")
      ? style.textContent.replace(rulePattern, markedRule)
      : `${style.textContent || ""}\n${markedRule}`.trim();
    const nextHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;
    setHtml(nextHtml);
    setIframeHtml(nextHtml);
    setStatus(`Applied .${selectedClass}, cleaned matching child CSS, and refreshed the preview`);
  }

  async function graduatePageCss() {
    if (!html || isGraduatingCss) return;
    setIsGraduatingCss(true);
    setError("");
    setStatus("Scanning the page for matching CSS property/value pairs");
    setCommandHistory((current) => [...current, { type: "html", html, activeId }].slice(-30));
    try {
      const response = await apiFetch(`/api/graduate-css`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html,
          viewport_width: editorPreviewWidth(previewPaneRef),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(data.detail, "Could not graduate page CSS"));

      setHtml(data.html);
      setIframeHtml(data.html);
      setElements(data.elements || []);
      if (page) {
        const nextPage = { ...page, html: data.html, elements: data.elements || [] };
        setPage(nextPage);
        if (page.source_url) pageCacheRef.current.set(page.source_url, nextPage);
      }
      setActiveId("");
      setSelectedClass("");
      setClassCss("");
      setClassContributions({});
      setStatus(`Graduated matching CSS into ${data.promoted_classes} shared class${data.promoted_classes === 1 ? "" : "es"}`);
    } catch (err) {
      setError(err.message);
      setStatus("");
    } finally {
      setIsGraduatingCss(false);
    }
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
      const availablePages = pageTabs.length ? pageTabs : [{ title: page?.title, url: page?.source_url }];
      const pages = availablePages.filter((item) => exportPageUrls.has(item.url));
      if (!pages.length) throw new Error("Select at least one page to export.");
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
              const response = await apiFetch(`/api/import`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: item.url, include_subpages: false }),
              });
              const data = await response.json();
              if (!response.ok) throw new Error(apiErrorMessage(data.detail, `Could not import ${item.url}`));
              return buildSeparatedExport(data.html, baseName);
            })();
        Object.assign(files, pageFiles);
        urlToFilename.set(item.url.replace(/\/$/, ""), `${baseName ? baseName.slice(0, -1) : "index"}.html`);
      }
      rewriteExportLinks(files, urlToFilename);
      // Keep editor-only project information separate from the public site.
      // This file lets Open Folder restore page tabs and export selections.
      files["dev/tech180-project.json"] = JSON.stringify({
        format: "tech180-project",
        version: 1,
        exportedAt: new Date().toISOString(),
        pages: uniquePages.map((item, index) => ({
          title: item.title || item.url,
          sourceUrl: item.url,
          filename: urlToFilename.get(item.url.replace(/\/$/, "")),
          selectedForExport: exportPageUrls.has(item.url),
        })),
        videoOptions: videoOptionChoices,
      }, null, 2);
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

      // Hosted users need the files on their own computer, not on Cloud Run's
      // temporary container disk. Build a ZIP in the browser for production.
      if (process.env.NODE_ENV === "production") {
        const archive = new JSZip();
        Object.entries(files).forEach(([name, contents]) => archive.file(name, contents));
        exportAssets.forEach(({ file, safeName }) => archive.file(`assets/${safeName}`, file));
        const blob = await archive.generateAsync(
          { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
          ({ percent }) => setImportProgress(35 + Math.round(percent * 0.65))
        );
        const folderName = `tech180-export-${new Date().toISOString().slice(0, 10)}`;
        downloadBrowserFile(blob, `${folderName}.zip`);
        setImportProgress(100);
        setStatus(`${folderName}.zip downloaded`);
        return;
      }

      // Local development can write the folder directly to the Mac. Stream
      // data so large captured pages do not exhaust the Python server.
      const form = new FormData();
      form.append(
        "files_json",
        new Blob([JSON.stringify(files)], { type: "application/json" }),
        "tech180-files.json"
      );
      exportAssets.forEach(({ file, safeName }) => form.append("assets", file, safeName));
      const response = await apiFetch(`/api/export-assets`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(apiErrorMessage(data.detail, "Folder export failed."));
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

  if (accessState !== "approved") {
    return (
      <div className="tech180-page">
        <main className="access-screen">
          <section className="access-screen__card" aria-live="polite">
            <div className="mark">180</div>
            <p className="access-screen__eyebrow">J.I. Systems secure workspace</p>
            <h1>{accessState === "checking" ? "Opening Tech180…" : "Tech180 access required"}</h1>
            <p>{accessMessage}</p>
            {accessState !== "checking" && (
              <a className="access-screen__button" href={GATEWAY_URL}>Return to secure access</a>
            )}
          </section>
        </main>
        <Tech180Footer />
      </div>
    );
  }

  return (
    <div className="tech180-page">
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

        {isImporting && (
          <div className="import-progress" aria-label="Import or export progress">
            <span style={{ width: `${importProgress}%` }} />
            <strong>{importProgress}%</strong>
          </div>
        )}

        <div className="saved-import">
          <span>Continue a saved project</span>
          <div className="saved-import-actions">
            <button type="button" onClick={() => folderInputRef.current?.click()} disabled={isImporting}>
              Open project
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
              Open ZIP / HTML
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

        <div className="status-line">
          {status && <span>{status}</span>}
          {error && <strong>{error}</strong>}
        </div>

        <details className="twirl-panel">
          <summary>Page Elements &amp; Export</summary>
          <div className="twirl-content">
            <button
              className="export-folder-button"
              type="button"
              onClick={exportProject}
              disabled={!html || isImporting || !exportPageUrls.size}
            >Export folder</button>
            <button
              className="graduate-css-button"
              type="button"
              onClick={graduatePageCss}
              disabled={!html || isGraduatingCss || isImporting}
            >{isGraduatingCss ? "Scanning page CSS…" : "Graduate common CSS"}</button>
            {pageTabs.length > 0 && (
              <section className="export-page-picker" aria-label="Pages to export">
                <div className="export-page-heading">
                  <strong>Pages to export</strong>
                  <div>
                    <button type="button" onClick={() => setExportPageUrls(new Set(pageTabs.map((tab) => tab.url)))}>Select all</button>
                    <button type="button" onClick={() => setExportPageUrls(new Set())}>Deselect all</button>
                  </div>
                </div>
                <div className="export-page-list">
                  {pageTabs.map((tab) => (
                    <label key={tab.url}>
                      <input
                        type="checkbox"
                        checked={exportPageUrls.has(tab.url)}
                        onChange={(event) => setExportPageUrls((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(tab.url);
                          else next.delete(tab.url);
                          return next;
                        })}
                      />
                      <span title={tab.title || tab.url}>{tab.title || tab.url}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}
          </div>
        </details>

        <details className="twirl-panel">
          <summary>Element Selection</summary>
          <div className="twirl-content">
        <section className="find-replace" aria-label="Find and replace">
          <label htmlFor="find-text">Find + Replace</label>
          <div className="find-input-wrap">
            <input
              id="find-text"
              value={findText}
              onChange={(event) => { setFindText(event.target.value); setFindIndex(-1); }}
              placeholder="Find text"
              disabled={!html}
            />
            {findText && (
              <button
                type="button"
                className="clear-find-button"
                aria-label="Clear Find text"
                title="Clear"
                onClick={() => { setFindText(""); setFindIndex(-1); }}
              >×</button>
            )}
          </div>
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
              <option value="button">Buttons</option>
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
            {sidebarElements.map((element) => (
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
          {visibleElements.length > SIDEBAR_PAGE_SIZE && (
            <div className="element-pagination">
              <button
                type="button"
                disabled={elementListPage === 0}
                onClick={() => setElementListPage((pageNumber) => Math.max(0, pageNumber - 1))}
              >Previous 250</button>
              <span>{elementListPage + 1} / {elementPageCount}</span>
              <button
                type="button"
                disabled={elementListPage >= elementPageCount - 1}
                onClick={() => setElementListPage((pageNumber) => Math.min(elementPageCount - 1, pageNumber + 1))}
              >Next 250</button>
            </div>
          )}
        </section>
          </div>
        </details>
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
                  <div className="element-identity">
                    <span>ID: <code>{activeIdentity.id || activeId}</code></span>
                    <span>Classes: <code>{activeIdentity.classes.length ? activeIdentity.classes.join(" ") : "none"}</code></span>
                    <span>Inherited: <code>{activeIdentity.classOptions.filter((option) => option.inherited).map((option) => option.className).join(" ") || "none"}</code></span>
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
                {contributingClassOptions.length > 0 && (
                  <div className="class-css-inspector">
                    <div className="code-editor-heading">
                      <label htmlFor="class-css">Class CSS</label>
                      <button type="button" onClick={applyClassCss}>
                        Apply CSS
                      </button>
                    </div>
                    <div className="class-option-list" aria-label="Element and inherited classes">
                      {contributingClassOptions.map((option) => (
                        <button
                          key={option.className}
                          type="button"
                          className={selectedClass === option.className ? "active" : ""}
                          onClick={() => selectClassOption(option)}
                        >
                          <strong>{option.element ? "#element" : `.${option.className}`}</strong>
                          <span>{option.element ? "inline attributes" : (option.inherited ? `parent <${option.ancestorTag}>` : "selected element")}</span>
                        </button>
                      ))}
                    </div>
                    <div className="class-navigation" aria-label="Navigate CSS classes">
                      <button type="button" aria-label="First class" title="First class" onClick={() => navigateClassSelection("top")} disabled={selectedClassIndex <= 0}>
                        ⇤ Top
                      </button>
                      <button type="button" aria-label="Previous class" title="Previous class" onClick={() => navigateClassSelection("up")} disabled={selectedClassIndex <= 0}>
                        ↑ Up
                      </button>
                      <button type="button" aria-label="Next class" title="Next class" onClick={() => navigateClassSelection("down")} disabled={selectedClassIndex >= contributingClassOptions.length - 1}>
                        ↓ Down
                      </button>
                      <button type="button" aria-label="Last class" title="Last class" onClick={() => navigateClassSelection("bottom")} disabled={selectedClassIndex >= contributingClassOptions.length - 1}>
                        Bottom ⇥
                      </button>
                    </div>
                    <div className="css-code-wrap">
                      <textarea
                        id="class-css"
                        className="css-code"
                        value={classCss || (selectedClass ? `.${selectedClass} {\n  \n}` : "")}
                        onChange={(event) => setClassCss(event.target.value)}
                        onScroll={syncCssPickerScroll}
                        spellCheck="false"
                        aria-label="CSS applied to every element sharing the selected class"
                      />
                      <div className="css-line-color-tools" aria-label="Class CSS color pickers">
                        {cssColorOccurrences(classCss).map((color) => (
                          <label
                            key={color.key}
                            style={{
                              top: `calc(11px + ${color.lineIndex * 16.5}px - var(--css-scroll-top, 0px))`,
                              right: `${8 + color.colorIndex * 24}px`,
                            }}
                            title={`${color.property}: ${color.value}`}
                          >
                            <span style={{ backgroundColor: color.value }} />
                            <input
                              type="color"
                              value={color.hex}
                              onChange={(event) => updateClassCssColor(color.lineIndex, color.value, event.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className="css-inspector">
                  <div className="code-editor-heading">
                    <label htmlFor="active-css">Element CSS</label>
                    <span>Direct only</span>
                  </div>
                  <div className="css-code-wrap">
                    <textarea
                      id="active-css"
                      className="css-code"
                      value={elementCssDraft}
                      onChange={(event) => updateElementCss(event.target.value)}
                      onScroll={syncCssPickerScroll}
                      spellCheck="false"
                      aria-label="Editable CSS stored directly on the selected element"
                      title="Only properties stored directly on this element"
                    />
                    <div className="css-line-color-tools" aria-label="Element CSS color pickers">
                      {cssColorOccurrences(elementCssDraft).map((color) => (
                        <label
                          key={color.key}
                          style={{
                            top: `calc(11px + ${color.lineIndex * 16.5}px - var(--css-scroll-top, 0px))`,
                            right: `${8 + color.colorIndex * 24}px`,
                          }}
                          title={`${color.property}: ${color.value}`}
                        >
                          <span style={{ backgroundColor: color.value }} />
                          <input
                            type="color"
                            value={color.hex}
                            onChange={(event) => updateElementCssColor(color.lineIndex, color.value, event.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
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
      <Tech180Footer />
    </div>
  );
}

export default App;
