"use strict";

// Product and platform pages use the same header structure as the homepage.
// Build links from this script's location so they work on the live site and from Finder.
const platformScriptUrl = document.currentScript?.src || document.baseURI;
const platformSiteRoot = new URL("../../", platformScriptUrl);
const platformUrl = (path) => new URL(path, platformSiteRoot).href;

document.querySelectorAll("[data-platform-header]").forEach((mount) => {
  const activePage = mount.dataset.active || "";
  const current = (page) => (activePage === page ? ' aria-current="page"' : "");
  const arrow = `
    <span class="mobile-nav__icon">
      <svg aria-hidden="true" class="icon icon--sm" viewBox="0 0 24 24">
        <path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>
      </svg>
    </span>`;

  mount.innerHTML = `
    <header class="site-header">
      <div class="container site-header__inner">
        <a aria-label="J.I. Systems home" class="brand" href="${platformUrl("index.html")}">
          <img alt="" aria-hidden="true" class="brand__mark" src="${platformUrl("assets/ji-logo.png")}">
          <span class="brand__name">J.I. Systems</span>
        </a>

        <nav aria-label="Site" class="site-nav">
          <a class="site-nav__link" href="${platformUrl("index.html#services")}">Solutions</a>
          <a class="site-nav__link" href="${platformUrl("index.html#audit")}">Audit</a>
          <a class="site-nav__link" href="${platformUrl("index.html#method")}">Process</a>
          <a class="site-nav__link" href="${platformUrl("tools/index.html")}"${current("tools")}>Tools</a>
          <a class="site-nav__link" href="${platformUrl("memberships/index.html")}"${current("memberships")}>Membership</a>
          <a class="site-nav__link" href="${platformUrl("index.html#about")}">About</a>
          <a class="site-nav__link" href="${platformUrl("index.html#contact")}">Contact</a>
        </nav>

        <div class="site-header__actions">
          <a class="button button--primary site-header__cta" href="${platformUrl("checkout.html")}">
            Book a Systems Diagnostic
            <svg aria-hidden="true" class="icon icon--sm" viewBox="0 0 24 24">
              <path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>
            </svg>
          </a>
          <button aria-controls="mobile-menu" aria-expanded="false" aria-label="Open menu"
            class="icon-button menu-toggle" id="mobile-menu-btn" type="button">
            <svg aria-hidden="true" class="icon" viewBox="0 0 24 24">
              <path d="M4 5h16"></path><path d="M4 12h16"></path><path d="M4 19h16"></path>
            </svg>
          </button>
        </div>
      </div>
    </header>

    <div aria-hidden="true" class="mobile-menu" id="mobile-menu">
      <button aria-label="Close menu" class="mobile-menu__backdrop" id="mobile-menu-backdrop" type="button"></button>
      <aside class="mobile-menu__panel">
        <div class="mobile-menu__header">
          <a aria-label="J.I. Systems home" class="brand brand--mobile" href="${platformUrl("index.html")}">
            <img alt="" aria-hidden="true" class="brand__mark" src="${platformUrl("assets/ji-logo.png")}">
            <span class="brand__name">J.I. Systems</span>
          </a>
          <button aria-label="Close menu" class="icon-button" id="mobile-menu-close" type="button">
            <svg aria-hidden="true" class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>
        <nav aria-label="Mobile navigation" class="mobile-nav">
          <a class="mobile-nav__link" href="${platformUrl("index.html#services")}">Services ${arrow}</a>
          <a class="mobile-nav__link" href="${platformUrl("index.html#audit")}">Audit ${arrow}</a>
          <a class="mobile-nav__link" href="${platformUrl("index.html#method")}">Method ${arrow}</a>
          <a class="mobile-nav__link" href="${platformUrl("tools/index.html")}"${current("tools")}>Tools ${arrow}</a>
          <a class="mobile-nav__link" href="${platformUrl("memberships/index.html")}"${current("memberships")}>Membership ${arrow}</a>
          <a class="mobile-nav__link" href="${platformUrl("index.html#about")}">About ${arrow}</a>
          <a class="mobile-nav__link" href="${platformUrl("index.html#contact")}">Contact ${arrow}</a>
        </nav>
        <div class="mobile-menu__footer">
          <a class="button button--primary" href="${platformUrl("checkout.html")}">Book a Systems Diagnostic</a>
        </div>
      </aside>
    </div>`;
});
