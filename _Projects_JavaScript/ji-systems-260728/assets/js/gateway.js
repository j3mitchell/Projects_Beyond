"use strict";

const gatewayRoot = document.querySelector("[data-access-gateway]");

if (gatewayRoot) {
  const apiBase = document.querySelector('meta[name="ji-api-base"]')?.content.replace(/\/$/, "");
  const supabaseUrl = document.querySelector('meta[name="ji-supabase-url"]')?.content.replace(/\/$/, "");
  const supabaseKey = document.querySelector('meta[name="ji-supabase-publishable-key"]')?.content.trim();
  const params = new URLSearchParams(window.location.search);
  const tool = params.get("tool") || "tech180";
  const toolCatalog = Object.freeze({
    tech180: { name: "Tech180", details: "tools/tech180/index.html" },
    resumeats: { name: "ResumeATS", details: "tools/index.html#resumeats" },
    coverai: { name: "CoverAI", details: "tools/index.html#coverai" },
    bookcraft: { name: "BookCraft", details: "tools/index.html#bookcraft" },
    operations: { name: "Operations Tools", details: "tools/index.html#operations" },
    "data-tools": { name: "Data Tools", details: "tools/index.html#data-tools" }
  });
  const selectedTool = toolCatalog[tool] || { name: tool, details: "tools/index.html" };
  const websiteUrl = params.get("url") || "";
  const gatewayScriptUrl = document.currentScript?.src || document.baseURI;
  const siteRoot = new URL("../../", gatewayScriptUrl);
  const configuredAppUrl = document.querySelector('meta[name="ji-tech180-app-url"]')?.content.trim();
  // A file:// page is the local development copy on this Mac. In that one
  // situation, launch the real React editor instead of the website placeholder.
  // Deployed web pages still use the protected workspace URL below.
  const isLocalDevelopment = window.location.protocol === "file:";
  const supabaseClient = !isLocalDevelopment && supabaseUrl && supabaseKey && window.supabase
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null;
  const temporaryUser = Object.freeze({
    email: "demo@jisystems.net",
    password: "Tech180Temp!"
  });
  const localAccessKey = `ji-temporary-access-${tool}`;
  const workspaceUrl = isLocalDevelopment && tool === "tech180"
    ? new URL("http://127.0.0.1:4050/")
    : configuredAppUrl && tool === "tech180"
      ? new URL(configuredAppUrl)
      : new URL(`app/${tool}/index.html`, siteRoot);

  if (websiteUrl) workspaceUrl.searchParams.set("url", websiteUrl);

  const stateBadge = gatewayRoot.querySelector("[data-gateway-state]");
  const message = gatewayRoot.querySelector("[data-gateway-message]");
  const signInForm = gatewayRoot.querySelector("[data-gateway-form]");
  const launchLink = gatewayRoot.querySelector("[data-launch-tool]");
  const recheckButton = gatewayRoot.querySelector("[data-recheck-access]");
  const emailInput = signInForm.querySelector('input[name="email"]');
  const passwordInput = gatewayRoot.querySelector("[data-dev-password]");
  const submitButton = gatewayRoot.querySelector("[data-gateway-submit]");
  const testCredentials = gatewayRoot.querySelector("[data-test-credentials]");

  gatewayRoot.querySelectorAll("[data-tool-name]").forEach((node) => {
    node.textContent = selectedTool.name;
  });
  const returnToolLink = gatewayRoot.querySelector("[data-return-tool]");
  if (returnToolLink) returnToolLink.href = new URL(selectedTool.details, siteRoot).href;

  if (isLocalDevelopment) {
    emailInput.value = temporaryUser.email;
    passwordInput.value = temporaryUser.password;
    passwordInput.hidden = false;
    passwordInput.required = true;
    submitButton.textContent = "Validate temporary user";
    testCredentials.hidden = false;
  }

  function showState(state, text, options = {}) {
    stateBadge.dataset.state = state;
    stateBadge.textContent = options.badge || state;
    message.textContent = text;
    signInForm.hidden = !options.showSignIn;
    launchLink.hidden = !options.canLaunch;
    recheckButton.hidden = Boolean(options.canLaunch);
    if (options.canLaunch) launchLink.href = workspaceUrl.href;
    if (options.autoLaunch) window.location.replace(workspaceUrl.href);
  }

  async function checkAccess() {
    showState("checking", `Checking your account and ${selectedTool.name} access…`, { badge: "Checking" });

    // Local files use an intentionally temporary browser-only credential so the
    // complete gateway flow can be tested before the production API is ready.
    if (isLocalDevelopment) {
      const isApproved = sessionStorage.getItem(localAccessKey) === "approved";
      showState(
        isApproved ? "approved" : "signin",
        isApproved
          ? `Temporary access validated. ${selectedTool.name} is ready to launch.`
          : "Enter the temporary development credential to validate access.",
        isApproved
          ? { badge: "Temporary access", canLaunch: true, autoLaunch: true }
          : { badge: "Temporary sign in", showSignIn: true }
      );
      return;
    }

    if (!supabaseClient) {
      showState("unavailable", "Supabase authentication is not configured yet.", { badge: "Setup needed" });
      return;
    }

    try {
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;

      if (!sessionData.session) {
        showState("signin", `Sign in to check whether this account can use ${selectedTool.name}.`, {
          badge: "Sign in required",
          showSignIn: true
        });
        return;
      }

      const { data: entitlement, error: accessError } = await supabaseClient
        .from("tool_entitlements")
        .select("status, expires_at")
        .eq("tool_slug", tool)
        .maybeSingle();

      if (accessError) throw accessError;

      const hasNotExpired = !entitlement?.expires_at || new Date(entitlement.expires_at) > new Date();
      if (entitlement?.status === "active" && hasNotExpired) {
        showState("approved", `Access verified. ${selectedTool.name} is ready to launch.`, {
          badge: "Access approved",
          canLaunch: true,
          autoLaunch: true
        });
        return;
      }

      showState("denied", `Your account is signed in but does not currently have ${selectedTool.name} access.`, {
        badge: "Access required",
        showSignIn: true
      });
    } catch (error) {
      console.error("Gateway access check failed", error);
      showState("unavailable", "The secure access check could not be completed. Tech180 remains locked.", {
        badge: "Access unavailable",
        showSignIn: true
      });
    }
  }

  signInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!signInForm.reportValidity()) return;

    const email = String(new FormData(signInForm).get("email") || "").trim();
    const password = String(new FormData(signInForm).get("password") || "");

    if (isLocalDevelopment) {
      const credentialsMatch = email.toLowerCase() === temporaryUser.email && password === temporaryUser.password;

      if (credentialsMatch) {
        sessionStorage.setItem(localAccessKey, "approved");
        showState("approved", `Temporary access validated. ${selectedTool.name} is ready to launch.`, {
          badge: "Temporary access",
          canLaunch: true,
          autoLaunch: true
        });
      } else {
        showState("denied", "That temporary email or password is incorrect.", {
          badge: "Invalid credential",
          showSignIn: true
        });
      }
      return;
    }

    showState("checking", "Requesting your secure sign-in link…", { badge: "Sending" });

    try {
      if (!supabaseClient) throw new Error("Supabase is not configured");
      const returnUrl = new URL(window.location.href);
      returnUrl.hash = "";
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: returnUrl.href }
      });
      if (error) throw error;
      showState("sent", "Check your email for the secure sign-in link, then return here.", { badge: "Email sent" });
    } catch (error) {
      console.error("Gateway sign-in failed", error);
      showState("unavailable", "The secure sign-in link could not be sent. No access was granted.", {
        badge: "Sign-in unavailable",
        showSignIn: true
      });
    }
  });

  recheckButton.addEventListener("click", checkAccess);
  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") checkAccess();
    });
  }
  checkAccess();
}
