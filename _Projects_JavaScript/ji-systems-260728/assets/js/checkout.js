"use strict";

const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/cNiaEXaJYgqod9L3KkcEw00";
const MEMBERSHIP_PLANS = Object.freeze({
  spark: { name: "Spark", monthly: "$39/month", annual: "$390/year", paymentLinks: { monthly: "https://buy.stripe.com/cNi4gzdWaa207Pr2GgcEw01", annual: "https://buy.stripe.com/eVqeVd6tIdecc5HcgQcEw02" } },
  surge: { name: "Surge", monthly: "$79/month", annual: "$790/year", paymentLinks: { monthly: "https://buy.stripe.com/7sYbJ13hweig2v73KkcEw03", annual: "https://buy.stripe.com/aFa28rbO26POd9LbcMcEw04" } },
  apex: { name: "Apex", monthly: "$149/month", annual: "$1,490/year", paymentLinks: { monthly: "https://buy.stripe.com/3cIfZh19oeigedPa8IcEw05", annual: "https://buy.stripe.com/00w4gz8BQa201r34OocEw06" } }
});
const form = document.querySelector("#checkout-consent");
const errorMessage = document.querySelector("#checkout-error");
const checkoutParams = new URLSearchParams(window.location.search);
const membershipSlug = checkoutParams.get("membership");
const billingPeriod = checkoutParams.get("billing") === "annual" ? "annual" : "monthly";
const membership = MEMBERSHIP_PLANS[membershipSlug];
const supabaseUrl = document.querySelector('meta[name="ji-supabase-url"]')?.content.trim();
const supabaseKey = document.querySelector('meta[name="ji-supabase-publishable-key"]')?.content.trim();
const supabaseClient = supabaseUrl && supabaseKey && window.supabase
  ? window.supabase.createClient(supabaseUrl, supabaseKey)
  : null;

if (membership) {
  document.title = `${membership.name} Membership Checkout | J.I. Systems`;
  document.querySelector("#checkout-eyebrow").textContent = "Membership checkout";
  document.querySelector("#checkout-title").textContent = `Choose ${membership.name}`;
  document.querySelector("#checkout-description").textContent = "Confirm the account details and policies before continuing to secure Stripe checkout.";
  const selection = document.querySelector("#checkout-selection");
  selection.textContent = `${membership.name} · ${membership[billingPeriod]}`;
  selection.hidden = false;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const data = new FormData(form);
  const consentId = globalThis.crypto?.randomUUID?.() || `consent-${Date.now()}`;
  const record = {
    consentId,
    companyName: String(data.get("companyName") || "").trim(),
    companyId: String(data.get("companyId") || "").trim(),
    acceptedAt: new Date().toISOString(),
    policyVersion: "2026-08-02",
    termsAccepted: data.get("accepted") === "on"
  };

  if (!record.companyName || !record.companyId || !record.termsAccepted) {
    errorMessage.textContent = "Complete the business details and accept the policies to continue.";
    errorMessage.hidden = false;
    return;
  }

  let signedInUser = null;
  if (membership) {
    try {
      const { data, error } = await supabaseClient?.auth.getUser() || {};
      if (error) throw error;
      signedInUser = data?.user || null;
    } catch (_) {
      signedInUser = null;
    }
    if (!signedInUser) {
      errorMessage.textContent = "Sign in to your J.I. Systems account before purchasing a membership. Open a tool, sign in, then return to this checkout.";
      errorMessage.hidden = false;
      return;
    }
  }

  try {
    localStorage.setItem(`jiSystemsConsent:${consentId}`, JSON.stringify(record));
    localStorage.setItem("jiSystemsLatestConsent", consentId);
  } catch (_) {
    // Stripe still receives the unique reference if browser storage is unavailable.
  }

  const selectedPaymentLink = membership ? membership.paymentLinks[billingPeriod] : STRIPE_PAYMENT_LINK;
  if (!selectedPaymentLink) {
    errorMessage.textContent = `${membership.name} checkout is staged, but its Stripe ${billingPeriod} price link still needs to be connected.`;
    errorMessage.hidden = false;
    return;
  }

  const stripeUrl = new URL(selectedPaymentLink);
  // Membership webhooks use this authenticated Supabase UUID to provision the
  // correct account. A diagnostic purchase keeps its separate consent ID.
  stripeUrl.searchParams.set("client_reference_id", signedInUser?.id || consentId);
  if (signedInUser?.email) stripeUrl.searchParams.set("prefilled_email", signedInUser.email);
  // Plan identity comes from trusted Stripe Payment Link metadata. Browser
  // query parameters are deliberately never used as authorization.
  window.location.assign(stripeUrl.toString());
});
