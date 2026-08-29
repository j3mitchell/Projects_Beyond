"use strict";

const betaWorkspace = document.querySelector("[data-beta-workspace]");

if (betaWorkspace) {
  const productName = betaWorkspace.dataset.productName || "This tool";
  document.querySelectorAll("[data-product-name]").forEach((node) => {
    node.textContent = productName;
  });
}
