"use strict";

const billingButtons = document.querySelectorAll("[data-billing]");

billingButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const billing = button.dataset.billing;
    billingButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    document.querySelectorAll("[data-monthly]").forEach((price) => {
      price.textContent = price.dataset[billing];
    });
    document.querySelectorAll("[data-price-period]").forEach((period) => {
      period.textContent = billing === "annual" ? "/year" : "/month";
    });
    document.querySelectorAll('a[href*="membership="]').forEach((link) => {
      const url = new URL(link.href);
      url.searchParams.set("billing", billing);
      link.href = url.href;
    });
  });
});
