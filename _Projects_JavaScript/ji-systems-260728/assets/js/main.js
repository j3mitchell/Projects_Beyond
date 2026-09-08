"use strict";

document.documentElement.classList.remove("no-js");

const menu = document.querySelector("#mobile-menu");
const openButton = document.querySelector("#mobile-menu-btn");
const closeButton = document.querySelector("#mobile-menu-close");
const backdrop = document.querySelector("#mobile-menu-backdrop");

function setMenuOpen(isOpen) {
  if (!menu || !openButton) return;

  menu.setAttribute("aria-hidden", String(!isOpen));
  openButton.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("menu-open", isOpen);

  if (isOpen) {
    closeButton?.focus();
  } else {
    openButton.focus();
  }
}

openButton?.addEventListener("click", () => setMenuOpen(true));
closeButton?.addEventListener("click", () => setMenuOpen(false));
backdrop?.addEventListener("click", () => setMenuOpen(false));

menu?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setMenuOpen(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu?.getAttribute("aria-hidden") === "false") {
    setMenuOpen(false);
  }
});

// Shared contact links can use https://jisystems.net/?contact=1..5. The page
// remains the canonical home route while the selected footer destination is
// focused and opened.
function handleContactDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const contactKey = params.get("contact");
  const selectors = {
    "1": '.footer-contact__link[data-contact-destination="1"]',
    "2": '.footer-contact__link[data-contact-destination="2"]',
    "3": '.footer-contact__link[data-contact-destination="3"]',
    "4": '.footer-contact__link[data-contact-destination="4"]',
    "5": '.footer-contact__link[data-contact-destination="5"]',
  };
  const selector = selectors[contactKey];
  if (!selector) return;

  const contactSection = document.querySelector("#contact");
  const contactLink = document.querySelector(selector);
  if (!contactLink) return;

  contactSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  contactLink.focus({ preventScroll: true });
  window.setTimeout(() => contactLink.click(), 250);
}

handleContactDeepLink();
