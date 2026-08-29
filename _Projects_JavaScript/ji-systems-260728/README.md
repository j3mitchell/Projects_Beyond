# J.I. Systems Website

Static website snapshot prepared on July 28, 2026.

## Project structure

```text
ji-systems-260728/
├── index.html
├── tools/
│   ├── index.html
│   └── tech180/index.html
├── app/
│   ├── index.html
│   └── tech180/index.html
├── api/
│   ├── index.html
│   └── tech180/index.html
├── assets/
│   ├── css/
│   │   └── styles.css
│   └── js/
│       └── main.js
└── README.md
```

## Local preview

From this directory, run:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deployment

The project is a static site. Deploy the contents of this directory to any
static host with `index.html` as the entry point.

## Maintenance

- Keep site-wide styles in `assets/css/styles.css`.
- Keep browser behavior in `assets/js/main.js`.
- Keep images, fonts, and other local media under `assets/`.
- Do not commit editor backups or operating-system metadata.
- See `PLATFORM.md` before adding a product, route, subdomain, or shared service.
- See `GATEWAY_SETUP.md` before connecting identity or paid tool access.

## Platform routes

- `/tools/` is the public product and utility catalog.
- `/tools/tech180/` is the public Tech180 product page.
- `/app/` is the shared authenticated-platform boundary.
- `/app/gateway/` verifies account and tool entitlement before launch.
- `/app/tech180/` is the future Tech180 application mount.
- `/api/` and `/api/tech180/` document the future Python API boundary.

## Stripe checkout setup

The site routes purchase buttons through `checkout.html`, which requires the
customer's company name, company/customer ID, and policy acknowledgement. It
passes a unique `client_reference_id` to the Stripe Payment Link.

For durable, Stripe-side consent records, edit Payment Link
`cNiaEXaJYgqod9L3KkcEw00` in Stripe Dashboard:

1. Enable **Require customers to accept your terms of service** and set the
   public Terms URL to `https://jisystems.net/terms.html`.
2. Add required custom fields for **Company/legal business name** and
   **Company/customer ID**.
3. Set the post-payment redirect to
   `https://jisystems.net/payment-success.html?session_id={CHECKOUT_SESSION_ID}`.
4. Add the Privacy and Refund URLs to Stripe's public business information.

`payment-success.html` is deliberately absent from navigation and marked
`noindex`; Stripe should be the only normal route to it.
