"use strict";

// Search and category controls filter the tool directory without reloading it.
const toolSearch = document.querySelector("#tool-search");
const toolCards = [...document.querySelectorAll("[data-tool-card]")];
const categoryButtons = [...document.querySelectorAll("[data-tool-filter]")];
const resultCount = document.querySelector("[data-tool-count]");
const emptyState = document.querySelector("[data-tool-empty]");
let activeCategory = "all";

function filterTools() {
  const searchTerm = toolSearch?.value.trim().toLowerCase() || "";
  let visibleCount = 0;

  toolCards.forEach((card) => {
    const matchesText = card.textContent.toLowerCase().includes(searchTerm);
    const categories = (card.dataset.categories || "").split(" ");
    const matchesCategory = activeCategory === "all" || categories.includes(activeCategory);
    const isVisible = matchesText && matchesCategory;

    card.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  if (resultCount) resultCount.textContent = String(visibleCount);
  if (emptyState) emptyState.hidden = visibleCount !== 0;
}

toolSearch?.addEventListener("input", filterTools);

categoryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeCategory = button.dataset.toolFilter || "all";
    categoryButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    filterTools();
  });
});

// Carry a submitted website URL from the public Tech180 page into the app shell.
const urlPreview = document.querySelector("[data-query-url]");
if (urlPreview) {
  const submittedUrl = new URLSearchParams(window.location.search).get("url");
  if (submittedUrl) urlPreview.value = submittedUrl;
}

// Close the desktop tools menu after choosing an item or clicking elsewhere.
document.querySelectorAll(".tools-menu__panel a").forEach((link) => {
  link.addEventListener("click", () => link.closest("details")?.removeAttribute("open"));
});

document.addEventListener("click", (event) => {
  document.querySelectorAll(".tools-menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute("open");
  });
});
