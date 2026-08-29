# Stripe membership webhook setup

Tech180 receives verified Stripe subscription events at:

`POST https://api.jisystems.net/v1/webhooks/stripe`

## 1. Prepare Supabase

Run these files in the Supabase SQL editor, in order:

1. `supabase/001_tech180_entitlements.sql`
2. `supabase/002_memberships.sql`
3. `supabase/003_stripe_webhooks.sql`

## 2. Configure each Stripe Payment Link

Add trusted metadata to each Payment Link:

| Payment Link | `plan_slug` | `billing_period` |
| --- | --- | --- |
| Spark monthly | `spark` | `monthly` |
| Spark annual | `spark` | `annual` |
| Surge monthly | `surge` | `monthly` |
| Surge annual | `surge` | `annual` |
| Apex monthly | `apex` | `monthly` |
| Apex annual | `apex` | `annual` |

## 3. Configure GCP secrets

Store these values in Google Secret Manager and expose them to the Cloud Run
service as environment variables. Never commit their real values:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## 4. Create the Stripe webhook destination

Use the endpoint above and subscribe to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Copy the destination's `whsec_...` signing secret into Google Secret Manager as
`STRIPE_WEBHOOK_SECRET`, then deploy a new Cloud Run revision.

## 5. Test

Complete a test checkout while signed into J.I. Systems. Confirm that:

1. Stripe reports a successful webhook delivery.
2. Supabase `memberships` contains the user's plan.
3. The gateway grants the correct Tech180 access.
