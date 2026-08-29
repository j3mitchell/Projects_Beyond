# J.I. Systems Platform Structure

This structure keeps public marketing, authenticated tools, and backend services
separate while presenting one connected J.I. Systems platform.

## Public website

Host these routes on `jisystems.net`:

- `/` — company website and systems diagnostic
- `/tools/` — searchable tools directory
- `/tools/tech180/` — public Tech180 product page
- `/privacy.html`, `/terms.html`, and `/refund-policy.html` — shared policies

Public pages explain products and route users into the platform. They do not
contain private application logic, database credentials, or API secrets.

## Authenticated application

The `app/` directory is the static foundation for the future
`app.jisystems.net` deployment:

- `/app/` — shared account and application hub
- `/app/gateway/` — account and entitlement verification before a tool launches
- `/app/tech180/` — Tech180 workspace mount

When authentication is added, the application host will own login, account,
subscription, usage, project history, and access to each tool.

The Tech180 flow is `/tools/tech180/` → `/app/gateway/` → `/app/tech180/`.
The gateway fails closed: it cannot launch the workspace unless the API returns
an authenticated response with `authorized: true`. Private-beta approval is the
first entitlement source; Stripe membership or credits can use the same check later.

## Backend API

The `api/` pages document the boundary that will eventually be served by the
Python backend at `api.jisystems.net`. They are not live API implementations.

Production API rules:

- React asks the API to perform an operation.
- Python validates identity, authorization, ownership, and usage.
- Python calls databases and third-party services.
- Python returns only the response the browser needs.

## Shared platform services

The platform should use one controlled integration for each responsibility:

- Supabase — authentication, Postgres data, and project ownership
- Stripe — products, prices, subscriptions or usage credits
- Resend — transactional email from a dedicated sending subdomain
- Cloudflare — DNS, domain routing, HTTPS, and email forwarding
- Google Cloud Run — containerized Python API deployment

Each service must keep development and production settings separate. Secrets
belong in backend or hosting environment variables, never browser JavaScript.

## Adding another tool

1. Add its public card to `/tools/`.
2. Create its public page under `/tools/<tool-name>/`.
3. Add its authenticated mount under `/app/<tool-name>/` only when needed.
4. Add a backend namespace under `/v1/<tool-name>/` only when it needs server work.
5. Reuse shared accounts, billing, support, email, and policies.
