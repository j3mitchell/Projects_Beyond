"use strict";

// Tool links stay simple HTML links. This layer only replaces the full-page
// gateway with a compact sign-in dialog when the visitor has no active session.
const toolLoginLinks = [...document.querySelectorAll("[data-tool-login]")];

if (toolLoginLinks.length) {
  const supabaseUrl = document.querySelector('meta[name="ji-supabase-url"]')?.content.replace(/\/$/, "");
  const supabaseKey = document.querySelector('meta[name="ji-supabase-publishable-key"]')?.content.trim();
  const supabaseClient = supabaseUrl && supabaseKey && window.supabase
    ? window.supabase.createClient(supabaseUrl, supabaseKey)
    : null;
  let selectedGatewayUrl = null;
  let selectedToolName = "your tool";
  let lastFocusedElement = null;

  const dialog = document.createElement("dialog");
  dialog.className = "tool-login";
  dialog.setAttribute("aria-labelledby", "tool-login-title");
  dialog.innerHTML = `
    <div class="tool-login__visual" aria-hidden="true"></div>
    <section class="tool-login__panel">
      <button class="tool-login__close" type="button" aria-label="Close sign in" data-login-close>×</button>
      <a class="tool-login__brand" href="../index.html" aria-label="J.I. Systems home">
        <img src="../assets/ji-logo.png" alt="" aria-hidden="true">
        <span>J.I. Systems</span>
      </a>
      <p class="eyebrow eyebrow--compact">Secure tool access</p>
      <h2 class="tool-login__title" id="tool-login-title">Sign in to continue</h2>
      <p class="tool-login__intro">Continue to <strong data-login-tool>your tool</strong> with your J.I. Systems account.</p>

      <div class="tool-login__providers" aria-label="Sign-in options">
        <button class="tool-login__provider" type="button" data-oauth-provider="google"><img src="../assets/login-gmail.jpg" alt="" aria-hidden="true"> Gmail</button>
        <button class="tool-login__provider" type="button" data-oauth-provider="linkedin_oidc"><img src="../assets/login-linkedin.jpg" alt="" aria-hidden="true"> LinkedIn</button>
        <button class="tool-login__provider" type="button" data-oauth-provider="azure"><img src="../assets/login-microsoft.png" alt="" aria-hidden="true"> Outlook</button>
        <button class="tool-login__provider" type="button" data-email-provider="email"><img src="../assets/login-email.png" alt="" aria-hidden="true"> Email</button>
      </div>

      <div class="tool-login__divider"><span>or use your email</span></div>

      <form class="tool-login__form" data-login-form>
        <label for="tool-login-email">Email address</label>
        <input id="tool-login-email" name="email" type="email" autocomplete="email" placeholder="you@company.com" required>
        <button class="button button--primary" type="submit">Send secure sign-in link</button>
      </form>

      <p class="tool-login__status" data-login-status aria-live="polite"></p>
      <div class="tool-login__recovery">
        <button type="button" data-forgot-password>Forgot password?</button>
        <a href="mailto:info@jisystems.net?subject=J.I.%20Systems%20forgotten%20login">Forgot login?</a>
      </div>
      <p class="tool-login__privacy">Your account is checked securely before the tool opens.</p>
    </section>`;
  document.body.append(dialog);

  const form = dialog.querySelector("[data-login-form]");
  const emailInput = form.querySelector('input[name="email"]');
  const status = dialog.querySelector("[data-login-status]");
  const toolNameNode = dialog.querySelector("[data-login-tool]");

  function showStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function closeDialog() {
    dialog.close();
    document.body.classList.remove("login-open");
    lastFocusedElement?.focus();
  }

  function openDialog(link) {
    selectedGatewayUrl = new URL(link.href);
    selectedToolName = link.closest("[data-tool-card]")?.querySelector(".tool-card__title")?.textContent.trim()
      || link.textContent.replace(/Open|→/g, "").trim()
      || "your tool";
    toolNameNode.textContent = selectedToolName;
    showStatus("");
    lastFocusedElement = link;
    dialog.showModal();
    document.body.classList.add("login-open");
  }

  async function continueWithOAuth(provider) {
    if (!supabaseClient || !selectedGatewayUrl) {
      showStatus("Secure sign-in is temporarily unavailable.", "error");
      return;
    }
    const providerNames = { google: "Gmail", azure: "Outlook", linkedin_oidc: "LinkedIn" };
    showStatus(`Opening ${providerNames[provider] || "provider"} sign in…`);
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider,
      options: { redirectTo: selectedGatewayUrl.href }
    });
    if (error) showStatus(error.message, "error");
  }

  toolLoginLinks.forEach((link) => {
    link.addEventListener("click", async (event) => {
      if (!supabaseClient) return;
      event.preventDefault();
      const { data, error } = await supabaseClient.auth.getSession();
      if (!error && data.session) {
        window.location.assign(link.href);
        return;
      }
      openDialog(link);
    });
  });

  dialog.querySelector("[data-login-close]").addEventListener("click", closeDialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });

  dialog.querySelectorAll("[data-oauth-provider]").forEach((button) => {
    button.addEventListener("click", () => continueWithOAuth(button.dataset.oauthProvider));
  });

  dialog.querySelectorAll("[data-email-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      emailInput.placeholder = "you@company.com";
      emailInput.focus();
      showStatus("Enter any email address connected to your membership.");
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || !supabaseClient || !selectedGatewayUrl) return;
    showStatus("Sending your secure sign-in link…");
    const { error } = await supabaseClient.auth.signInWithOtp({
      email: emailInput.value.trim(),
      options: { emailRedirectTo: selectedGatewayUrl.href }
    });
    showStatus(error ? error.message : "Check your email, then use the secure link to continue.", error ? "error" : "success");
  });

  dialog.querySelector("[data-forgot-password]").addEventListener("click", async () => {
    if (!emailInput.reportValidity() || !supabaseClient || !selectedGatewayUrl) {
      emailInput.focus();
      return;
    }
    showStatus("Sending password recovery instructions…");
    const { error } = await supabaseClient.auth.resetPasswordForEmail(emailInput.value.trim(), {
      redirectTo: selectedGatewayUrl.href
    });
    showStatus(error ? error.message : "Check your email for password recovery instructions.", error ? "error" : "success");
  });
}
