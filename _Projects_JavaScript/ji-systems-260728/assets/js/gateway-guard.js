"use strict";

// This browser guard improves the user flow. The Tech180 API must independently
// verify the same session and entitlement on every protected request.
const protectedTool = document.querySelector("[data-protected-tool]");

if (protectedTool) {
  const tool = protectedTool.dataset.protectedTool;
  const apiBase = document.querySelector('meta[name="ji-api-base"]')?.content.replace(/\/$/, "");
  const supabaseUrl = document.querySelector('meta[name="ji-supabase-url"]')?.content.replace(/\/$/, "");
  const supabaseKey = document.querySelector('meta[name="ji-supabase-publishable-key"]')?.content.trim();
  const supabaseClient = supabaseUrl && supabaseKey && window.supabase
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null;
  const guardScriptUrl = document.currentScript?.src || document.baseURI;
  const siteRoot = new URL("../../", guardScriptUrl);
  const gatewayUrl = new URL("app/gateway/index.html", siteRoot);
  const websiteUrl = new URLSearchParams(window.location.search).get("url");

  gatewayUrl.searchParams.set("tool", tool);
  if (websiteUrl) gatewayUrl.searchParams.set("url", websiteUrl);

  async function authorizeWorkspace() {
    if (!apiBase || !supabaseClient) {
      window.location.replace(gatewayUrl.href);
      return;
    }

    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error || !data.session?.access_token) {
        window.location.replace(gatewayUrl.href);
        return;
      }

      const serviceBase = apiBase.replace(/\/v1$/, "");
      const response = await fetch(`${serviceBase}/api/access`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${data.session.access_token}`
        }
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.authorized !== true) {
        window.location.replace(gatewayUrl.href);
        return;
      }
      protectedTool.hidden = false;
    } catch (_) {
      window.location.replace(gatewayUrl.href);
    }
  }

  authorizeWorkspace();
}
