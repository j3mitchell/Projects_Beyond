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
