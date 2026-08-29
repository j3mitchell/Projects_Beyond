# Tech180 Access Gateway Setup

## Local development

When the gateway is opened directly from disk with a `file://` address, it uses
the temporary `demo@jisystems.net` / `Tech180Temp!` credential. Approval is kept
only in that browser tab's `sessionStorage`, and the launch button opens the real
local editor at `http://127.0.0.1:4050`. Tech180 must first be started with its
Python launcher. This temporary path is disabled on HTTP and HTTPS websites.

The gateway reads the private-beta editor location from the
`ji-tech180-app-url` meta setting and automatically forwards an approved user.
The submitted website remains attached as the encoded `url` query parameter.
Change that setting to the hosted Tech180 URL when the app is deployed.

The browser gateway now uses Supabase magic-link authentication. Run
`supabase/001_tech180_entitlements.sql` in the Supabase SQL Editor, then add an
entitlement row for each approved beta user after their first sign-in.

The publishable key in the page is intentionally public. Never add the Supabase
service-role key or database password to browser JavaScript or GitHub.

## 1. Request a sign-in link

`POST /auth/magic-link`

```json
{
  "email": "approved-user@example.com",
  "return_to": "https://app.jisystems.net/gateway/?tool=tech180"
}
```

Return `202 Accepted` whether or not the email exists. This prevents account
enumeration. The server must allow only known J.I. Systems return URLs.

## 2. Check Tech180 access

`GET /access/tech180`

- Return `401` when no valid account session exists.
- Return `403` when the account is valid but lacks Tech180 access.
- Return `200` only when access is approved:

```json
{
  "authenticated": true,
  "authorized": true,
  "source": "beta_allowlist"
}
```

The first `source` is `beta_allowlist`. Later it can be `stripe_subscription` or
`usage_credits` without changing the website flow.

## Security requirements

- Supabase owns account identity and the approved-user table.
- The API validates the Supabase session; the browser never receives service keys.
- Session cookies use `Secure`, `HttpOnly`, and an appropriate `SameSite` setting.
- CORS permits only the production J.I. Systems site and app origins.
- Tech180 API routes repeat identity, entitlement, ownership, and usage checks.
- Stripe webhooks—not the browser success page—update paid entitlements later.

The JavaScript workspace guard improves navigation but is not the security
boundary. Server-side authorization remains mandatory for every protected action.
