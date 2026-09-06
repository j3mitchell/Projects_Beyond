"use strict";

// Single source of truth for platform tools. Add or edit a tool here once.
window.JISystemsPlatform = {
  navigation: Object.freeze({
    header: Object.freeze({ solutions: "Solutions", audit: "Diagnostic", process: "Process", tools: "Tools", memberships: "Membership", about: "About", contact: "Contact", cta: "Book a Systems Diagnostic" }),
    footer: Object.freeze({ capabilities: "Capabilities", diagnostic: "Diagnostic", process: "Process", about: "About", book: "Book", tools: "Tools", memberships: "Membership", policies: "Policies" }),
    policies: Object.freeze({ privacy: "Privacy", terms: "Terms", refunds: "Refunds" }),
    headerItems: Object.freeze([
      { id: "solutions", path: "index.html#services", kind: "link" },
      { id: "audit", path: "index.html#audit", kind: "link" },
      { id: "process", path: "index.html#method", kind: "link" },
      { id: "tools", path: "tools/index.html", kind: "tools" },
      { id: "memberships", path: "memberships/index.html", kind: "memberships" },
      { id: "about", path: "index.html#about", kind: "link" },
      { id: "contact", path: "index.html#contact", kind: "link" },
    ]),
    footerItems: Object.freeze([
      { id: "capabilities", path: "index.html#services", kind: "link" },
      { id: "diagnostic", path: "index.html#audit", kind: "link" },
      { id: "process", path: "index.html#method", kind: "link" },
      { id: "about", path: "index.html#about", kind: "link" },
      { id: "book", path: "checkout.html", kind: "link" },
      { id: "tools", path: "tools/index.html", kind: "tools" },
      { id: "memberships", path: "memberships/index.html", kind: "link" },
      { id: "policies", kind: "policies" },
    ]),
    policyItems: Object.freeze([
      { id: "privacy", path: "privacy.html" },
      { id: "terms", path: "terms.html" },
      { id: "refunds", path: "refund-policy.html" },
    ]),
  }),
  disclaimers: Object.freeze({
    "data-server-content": {
      title: "Server content and script review",
      text: "J.I. Systems is not responsible for original server content. You assume the risks of executing generated or modified scripts and should review and test all SQL scripts before use.",
      acknowledgementRequired: true,
    },
  }),
  tools: [
    { id: "tech180", name: "Tech180", tagline: "Website capture and editing", description: "Capture, inspect, edit, and export website projects in a protected workspace.", category: "Websites", route: "tools/index.html#tech180", launchUrl: "app/gateway/index.html?tool=tech180", price: { amount: null, currency: "USD", interval: null, stripePriceId: null }, memberships: [], disclaimerIds: [], status: "active", visible: true, sortOrder: 10 },
    { id: "resumeats", name: "ResumeATS", tagline: "Resume alignment and review", description: "Review resume alignment and improve presentation for a selected opportunity.", category: "Career & Publishing", route: "tools/index.html#resumeats", launchUrl: "app/gateway/index.html?tool=resumeats", price: { amount: null, currency: "USD", interval: null, stripePriceId: null }, memberships: [], disclaimerIds: [], status: "active", visible: true, sortOrder: 20 },
    { id: "coverai", name: "CoverAI", tagline: "Focused cover-letter creation", description: "Create focused cover letters using role and applicant context.", category: "Career & Publishing", route: "tools/index.html#coverai", launchUrl: "app/gateway/index.html?tool=coverai", price: { amount: null, currency: "USD", interval: null, stripePriceId: null }, memberships: [], disclaimerIds: [], status: "planned", visible: true, sortOrder: 30 },
    { id: "bookcraft", name: "BookCraft", tagline: "Digital publication workspace", description: "Prepare and manage structured digital-publication projects.", category: "Career & Publishing", route: "tools/index.html#bookcraft", launchUrl: "app/gateway/index.html?tool=bookcraft", price: { amount: null, currency: "USD", interval: null, stripePriceId: null }, memberships: [], disclaimerIds: [], status: "planned", visible: true, sortOrder: 40 },
    { id: "operations", name: "Operations Tools", tagline: "Workflow and reporting utilities", description: "Practical utilities for recurring business workflows, records, and reporting.", category: "Business Operations", route: "tools/index.html#operations", launchUrl: "app/gateway/index.html?tool=operations", price: { amount: null, currency: "USD", interval: null, stripePriceId: null }, memberships: [], disclaimerIds: [], status: "planned", visible: true, sortOrder: 50 },
    { id: "data-tools", name: "Data Tools", tagline: "Practical data utilities", description: "Inspect, transform, and prepare data and database scripts with explicit user review.", category: "Business Operations", route: "tools/index.html#data-tools", launchUrl: "app/gateway/index.html?tool=data-tools", price: { amount: null, currency: "USD", interval: null, stripePriceId: null }, memberships: [], disclaimerIds: ["data-server-content"], status: "planned", visible: true, sortOrder: 60 },
  ],
  memberships: Object.freeze([
    { id: "origin", name: "Origin", eyebrow: "Default membership", tagline: "Free platform entry", description: "Free tools plus a five-day Tech180 trial, limited to three imports.", features: ["Free platform tools", "One import at a time", "5 pages per import", "50 MB captured assets"], route: "memberships/index.html#origin", monthly: 0, annual: 0, currency: "USD", featured: false, checkoutLabel: "Start with Origin", checkoutRoute: "tools/index.html", paymentLinks: { monthly: null, annual: null }, stripePriceIds: { monthly: null, annual: null } },
    { id: "spark", name: "Spark", eyebrow: "Focused toolkit", tagline: "Two premium apps and monthly credits", description: "Choose two premium apps and receive a protected monthly credit allowance.", features: ["Two premium apps", "Standard usage limits", "Shared AI credits", "Email support"], route: "memberships/index.html#spark", monthly: 39, annual: 390, currency: "USD", featured: false, checkoutLabel: "Choose Spark", checkoutRoute: "checkout.html?membership=spark", paymentLinks: { monthly: null, annual: null }, stripePriceIds: { monthly: null, annual: null } },
    { id: "surge", name: "Surge", eyebrow: "Complete platform", tagline: "Complete platform access", description: "Use every app with higher limits and one shared pool of platform credits.", features: ["All platform apps", "Higher usage limits", "Larger AI credit pool", "Priority support"], route: "memberships/index.html#surge", monthly: 79, annual: 790, currency: "USD", featured: true, checkoutLabel: "Choose Surge", checkoutRoute: "checkout.html?membership=surge", paymentLinks: { monthly: null, annual: null }, stripePriceIds: { monthly: null, annual: null } },
    { id: "apex", name: "Apex", eyebrow: "Business capacity", tagline: "Business capacity and higher limits", description: "Maximum standard usage with advanced and business-focused features.", features: ["Maximum platform limits", "Largest AI credit pool", "Advanced business features", "Priority onboarding"], route: "memberships/index.html#apex", monthly: 149, annual: 1490, currency: "USD", featured: false, checkoutLabel: "Choose Apex", checkoutRoute: "checkout.html?membership=apex", paymentLinks: { monthly: null, annual: null }, stripePriceIds: { monthly: null, annual: null } },
  ]),
  toolMenu(urlFor, options = {}) {
    const groups = new Map();
    this.tools.filter((tool) => tool.visible).sort((a, b) => a.sortOrder - b.sortOrder).forEach((tool) => {
      if (!groups.has(tool.category)) groups.set(tool.category, []);
      groups.get(tool.category).push(tool);
    });
    const columns = [...groups].map(([category, tools]) => `<section><p class="site-nav-tools__heading">${category}</p>${tools.slice(0, 4).map((tool) => `<a href="${urlFor(tool.launchUrl || tool.route)}">${tool.name}${options.descriptions === false ? "" : `<span>${tool.tagline}</span>`}</a>`).join("")}</section>`).join("");
    return `<div class="site-nav-tools__columns">${columns}</div><a class="site-nav-tools__all" href="${urlFor("tools/index.html")}">View all tools</a>`;
  },
  membershipMenu(urlFor) {
    const links = this.memberships.map((membership) => `<a href="${urlFor(membership.route)}">${membership.name}<span>${membership.tagline}</span></a>`).join("");
    return `<p class="site-nav-tools__heading">Memberships</p>${links}<a class="site-nav-tools__all" href="${urlFor("memberships/index.html")}">Compare memberships</a>`;
  },
  headerNavigation(urlFor, activePage = "") {
    const labels = this.navigation.header;
    return this.navigation.headerItems.map((item) => {
      const current = activePage === item.id ? ' aria-current="page"' : "";
      if (item.kind === "tools") return `<div class="site-nav-tools"><a class="site-nav__link site-nav-tools__trigger" href="${urlFor(item.path)}"${current}>${labels[item.id]} <span aria-hidden="true">⌄</span></a><div class="site-nav-tools__menu" aria-label="${labels[item.id]}">${this.toolMenu(urlFor)}</div></div>`;
      if (item.kind === "memberships") return `<div class="site-nav-tools"><a class="site-nav__link site-nav-tools__trigger" href="${urlFor(item.path)}"${current}>${labels[item.id]} <span aria-hidden="true">⌄</span></a><div class="site-nav-tools__menu site-nav-memberships__menu" aria-label="${labels[item.id]}">${this.membershipMenu(urlFor)}</div></div>`;
      return `<a class="site-nav__link" href="${urlFor(item.path)}"${current}>${labels[item.id]}</a>`;
    }).join("");
  },
  mobileNavigation(urlFor, activePage = "", arrow = "") {
    const labels = this.navigation.header;
    return this.navigation.headerItems.map((item) => `<a class="mobile-nav__link" href="${urlFor(item.path)}"${activePage === item.id ? ' aria-current="page"' : ""}>${labels[item.id]} ${arrow}</a>`).join("");
  },
  footerNavigation(urlFor) {
    const labels = this.navigation.footer;
    const policyLabels = this.navigation.policies;
    return this.navigation.footerItems.map((item, index) => {
      const separated = index ? " footer-nav__item--separated" : "";
      if (item.kind === "tools") return `<li class="footer-nav__item${separated} footer-nav__item--tools"><div class="footer-dropdown"><a class="footer-nav__link" href="${urlFor(item.path)}">${labels[item.id]}</a><div class="footer-dropdown__menu footer-dropdown__menu--tools">${this.toolMenu(urlFor)}</div></div></li>`;
      if (item.kind === "policies") { const links = this.navigation.policyItems.map((policy) => `<a href="${urlFor(policy.path)}">${policyLabels[policy.id]}</a>`).join(""); return `<li class="footer-nav__item${separated} footer-nav__item--policies"><div class="footer-dropdown"><span class="footer-dropdown__trigger" tabindex="0">${labels[item.id]}</span><div class="footer-dropdown__menu"><p class="site-nav-tools__heading">${labels[item.id]}</p>${links}</div></div></li>`; }
      return `<li class="footer-nav__item${separated}"><a class="footer-nav__link" href="${urlFor(item.path)}">${labels[item.id]}</a></li>`;
    }).join("");
  },
  categorySlug(category) {
    return category.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  },
  applyNavigationLabels(root = document) {
    const set = (selector, label) => root.querySelectorAll(selector).forEach((element) => {
      const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.textContent = ` ${label} `;
      else element.prepend(document.createTextNode(label));
    });
    const header = this.navigation.header;
    const footer = this.navigation.footer;
    set('.site-nav a[href$="#services"], .mobile-nav a[href$="#services"]', header.solutions);
    set('.site-nav a[href$="#audit"], .mobile-nav a[href$="#audit"]', header.audit);
    set('.site-nav a[href$="#method"], .mobile-nav a[href$="#method"]', header.process);
    set('.site-nav > .site-nav-tools > .site-nav-tools__trigger[href*="tools/index.html"], .mobile-nav > a[href*="tools/index.html"]', header.tools);
    set('.site-nav > .site-nav-tools > .site-nav-tools__trigger[href*="memberships/index.html"], .mobile-nav > a[href*="memberships/index.html"]', header.memberships);
    set('.site-nav a[href$="#about"], .mobile-nav a[href$="#about"]', header.about);
    set('.site-nav a[href$="#contact"], .mobile-nav a[href$="#contact"]', header.contact);
    set('.site-header__cta, .mobile-menu__footer a', header.cta);
    set('.footer-nav a[href$="#services"]', footer.capabilities);
    set('.footer-nav a[href$="#audit"]', footer.diagnostic);
    set('.footer-nav a[href$="#method"]', footer.process);
    set('.footer-nav a[href$="#about"]', footer.about);
    set('.footer-nav a[href*="checkout.html"]', footer.book);
    set('.footer-nav a[href*="tools/index.html"]', footer.tools);
    set('.footer-nav a[href*="memberships/index.html"]', footer.memberships);
    set('.footer-dropdown__trigger', footer.policies);
  },
};

window.JISystemsPlatform.applyCatalogApps = function applyCatalogApps(apps) {
  this.tools = apps.map((app) => ({
    id: app.slug, name: app.name, tagline: app.tagline, description: app.description,
    category: app.category, iconText: app.icon_text, route: app.route,
    launchUrl: app.launch_url, price: { amount: app.price_amount_cents, currency: String(app.price_currency || "usd").toUpperCase(), interval: app.price_interval, stripePriceId: app.stripe_price_id },
    memberships: app.membership_slugs || [], disclaimerIds: app.disclaimer_ids || [],
    status: app.status, visible: app.visible, sortOrder: app.sort_order,
  }));
};
window.JISystemsPlatform.applyMembershipPlans = function applyMembershipPlans(plans) {
  this.memberships = plans.map((plan) => ({
    id: plan.slug, name: plan.name, eyebrow: plan.eyebrow, tagline: plan.tagline,
    description: plan.description, features: Array.isArray(plan.features) ? plan.features : [],
    route: plan.route, monthly: Number(plan.monthly_price_cents || 0) / 100,
    annual: Number(plan.annual_price_cents || 0) / 100,
    currency: String(plan.currency || "usd").toUpperCase(), featured: Boolean(plan.featured),
    checkoutLabel: plan.checkout_label, checkoutRoute: plan.checkout_route,
    paymentLinks: { monthly: plan.payment_link_monthly || null, annual: plan.payment_link_annual || null },
    stripePriceIds: { monthly: plan.stripe_price_id_monthly || null, annual: plan.stripe_price_id_annual || null },
    active: Boolean(plan.active), sortOrder: Number(plan.sort_order || 100),
  })).filter((plan) => plan.active).sort((a, b) => a.sortOrder - b.sortOrder);
};
try {
  const cachedApps = JSON.parse(localStorage.getItem("jiPlatformCatalog") || "null");
  if (Array.isArray(cachedApps)) window.JISystemsPlatform.applyCatalogApps(cachedApps);
  const cachedMemberships = JSON.parse(localStorage.getItem("jiMembershipCatalog") || "null");
  if (Array.isArray(cachedMemberships)) window.JISystemsPlatform.applyMembershipPlans(cachedMemberships);
} catch (_) { /* The bundled catalog remains available. */ }

window.JISystemsPlatform.refreshCatalog = async function refreshCatalog() {
  const requests = await Promise.allSettled([
    fetch("https://api.jisystems.net/v1/catalog", { headers: { Accept: "application/json" } }),
    fetch("https://api.jisystems.net/v1/memberships/catalog", { headers: { Accept: "application/json" } }),
  ]);
  let changed = false;
  if (requests[0].status === "fulfilled" && requests[0].value.ok) {
    const { apps } = await requests[0].value.json();
    if (Array.isArray(apps) && JSON.stringify(apps) !== localStorage.getItem("jiPlatformCatalog")) {
      localStorage.setItem("jiPlatformCatalog", JSON.stringify(apps)); this.applyCatalogApps(apps); changed = true;
    }
  }
  if (requests[1].status === "fulfilled" && requests[1].value.ok) {
    const { memberships } = await requests[1].value.json();
    if (Array.isArray(memberships) && JSON.stringify(memberships) !== localStorage.getItem("jiMembershipCatalog")) {
      localStorage.setItem("jiMembershipCatalog", JSON.stringify(memberships)); this.applyMembershipPlans(memberships); changed = true;
    }
  }
  if (changed) window.dispatchEvent(new CustomEvent("ji:catalog-updated"));
};
window.JISystemsPlatform.refreshCatalog();
