"use strict";

// Resolve the site folder from this script, whether the page uses https:// or file://.
const footerScriptUrl = document.currentScript?.src || document.baseURI;
const footerSiteRoot = new URL("../../", footerScriptUrl);
const footerUrl = (path) => new URL(path, footerSiteRoot).href;

// Nested pages use the homepage footer markup and CSS classes.
document.querySelectorAll("[data-site-footer]").forEach((mount) => {
  mount.innerHTML = `
    <footer class="site-footer">
      <div class="container">
        <div class="site-footer__main">
          <div class="site-footer__about">
            <a aria-label="J.I. Systems home" class="brand brand--footer" href="${footerUrl("index.html")}">
              <img alt="" aria-hidden="true" class="brand__mark" src="${footerUrl("assets/ji-logo.png")}">
              <span class="brand__name">J.I. Systems</span>
            </a>
            <p class="site-footer__description">
              Systems diagnostics, integration, automation, data infrastructure, and custom business software.
            </p>
          </div>

          <div class="site-footer__links">
            <nav aria-label="Footer navigation" class="footer-nav">
              <ul class="footer-nav__list">
                <li class="footer-nav__item"><a class="footer-nav__link" href="${footerUrl("index.html#services")}">Capabilities</a></li>
                <li class="footer-nav__item footer-nav__item--separated"><a class="footer-nav__link" href="${footerUrl("index.html#audit")}">Diagnostic</a></li>
                <li class="footer-nav__item footer-nav__item--separated"><a class="footer-nav__link" href="${footerUrl("index.html#method")}">Process</a></li>
                <li class="footer-nav__item footer-nav__item--separated"><a class="footer-nav__link" href="${footerUrl("index.html#about")}">About</a></li>
                <li class="footer-nav__item"><a class="footer-nav__link" href="${footerUrl("checkout.html")}">Book</a></li>
                <li class="footer-nav__item footer-nav__item--separated"><a class="footer-nav__link" href="${footerUrl("tools/index.html")}">Tools</a></li>
                <li class="footer-nav__item footer-nav__item--separated"><a class="footer-nav__link" href="${footerUrl("memberships/index.html")}">Membership</a></li>
                <li class="footer-nav__item footer-nav__item--legal footer-nav__item--separated"><a class="footer-nav__link" href="${footerUrl("privacy.html")}">Privacy</a></li>
                <li class="footer-nav__item footer-nav__item--legal footer-nav__item--separated"><a class="footer-nav__link" href="${footerUrl("terms.html")}">Terms</a></li>
                <li class="footer-nav__item footer-nav__item--legal"><a class="footer-nav__link" href="${footerUrl("refund-policy.html")}">Refunds</a></li>
              </ul>
            </nav>
            <div class="footer-contact">
              <a class="footer-contact__link" href="mailto:info@jisystems.net">info@jisystems.net</a>
            </div>
          </div>
        </div>
        <div class="site-footer__legal">
          <p class="site-footer__copyright">© 2026 J.I. Systems. All rights reserved.</p>
        </div>
      </div>
    </footer>`;
});

// Older pages may contain a text-only brand. Give those links the shared logo treatment.
document.querySelectorAll(".brand").forEach((brand) => {
  if (brand.querySelector(".brand__mark")) return;

  const label = brand.textContent.trim();
  brand.replaceChildren();

  const logo = document.createElement("img");
  logo.src = footerUrl("assets/ji-logo.png");
  logo.alt = "";
  logo.className = "brand__mark";
  logo.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "brand__name";
  name.textContent = label;
  brand.append(logo, name);
});
