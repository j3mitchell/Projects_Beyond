# J.I. Systems Platform Decisions

Last updated: August 26, 2026

This file is the reminder requested during the Tech180 launch work. Update it
when a business rule changes so the website, Stripe, Supabase, and apps do not
quietly drift apart.

## Business model

- The platform is membership-only. Do not advertise individual app purchases.
- Every new account starts on **Origin** by default.
- Billing time changes price only: monthly or annual.
- Annual pricing is approximately 17% lower (roughly two months free).
- AI-heavy tools always use credits or hard limits. Usage stops at the limit by
  default; no surprise overage billing.

## Memberships

| Membership | Monthly | Annual | Included access |
| --- | ---: | ---: | --- |
| Origin | $0 | $0 | Free tools and limited trials |
| Spark | $39 | $390 | Two selected premium apps, standard limits, shared AI credits |
| Surge | $79 | $790 | All apps, higher limits, larger shared AI-credit pool |
| Apex | $149 | $1,490 | Maximum standard usage, advanced/business features, priority onboarding |

The exact credit quantities still need cost testing before paid launch. Prices
and plan names are accepted; Stripe product and price IDs are not configured yet.

## Origin and Tech180 trial

- Trial ends at the first of: **5 days** or **3 imports**.
- One import runs at a time. “Concurrent import” means import jobs processing at
  the same moment; Origin permits one.
- Recommended Origin import cap: 5 pages per import.
- Recommended captured-asset cap: 50 MB per import.
- Recommended local-upload cap: 100 MB per file.
- Tech180 currently has no LLM inference charge. Its variable costs are browser
  rendering, CPU time, bandwidth, and temporary storage.

## Product routing

- Public links go to a J.I. Systems product page or secure gateway—never GitHub.
- GitHub is the private source/deployment location, not a customer interface.
- Route pattern: `/tools/<app>/` → `/app/gateway/?tool=<app>` → `/app/<app>/`.
- Known catalog entries: Tech180, ResumeATS, CoverAI, BookCraft, Operations
  Tools, and Data Tools.
- Tech180 is the first production-connected app. Other known apps have beta
  routes and will replace their staging workspaces as each service is deployed.
- About four additional app identities remain undecided. Do not invent names or
  promises until the products are selected.

## Technical architecture

- **Cloudflare:** DNS, HTTPS, `jisystems.net`, and the static platform/frontend.
- **Supabase:** accounts, magic-link login, Postgres records, RLS, memberships,
  entitlements, usage, and project ownership.
- **Google Cloud Run:** protected Python APIs and browser-rendering jobs.
- **Stripe:** membership checkout, renewals, payment state, and future credit
  add-ons. Stripe updates Supabase through a verified backend webhook—not GitHub.
- **Resend:** transactional email from a dedicated sending subdomain when ready.
- **GitHub:** private source control and deployment trigger only.

The Tech180 React frontend is built into the Cloudflare site at
`/app/tech180/`. Its Python API is intended for `api.jisystems.net`. The browser
sends a short-lived Supabase user token; the API validates both identity and
Tech180 entitlement before performing protected work.

## Security decisions

- Production fails closed when identity or entitlement cannot be verified.
- Secrets stay in project-root `.env` files locally and hosting environment
  variables in production. `.env` remains ignored by Git.
- Supabase publishable keys may appear in browser code; service-role, Stripe,
  Resend, and future OpenAI keys must remain server-only.
- Repositories are private, MFA stays enabled, RLS stays enabled, and production
  keys/databases remain separate from development.
- Supabase OAuth Server and Dynamic OAuth App Registration are not required for
  this architecture and should remain disabled.

## Remaining launch choices/actions

1. Create three Stripe membership products (Spark, Surge, Apex), with monthly
   and annual prices. Origin is a database default and needs no paid price.
2. Decide initial AI-credit quantities only after measuring real model costs.
3. Deploy the Tech180 backend to Google Cloud Run and attach `api.jisystems.net`.
4. Build and upload the platform `dist/` package to Cloudflare.
5. Run the membership/usage Supabase migration after it is reviewed.
6. Configure Resend and its DNS records before transactional mail is enabled.
7. Choose names and scopes for the remaining planned apps.
