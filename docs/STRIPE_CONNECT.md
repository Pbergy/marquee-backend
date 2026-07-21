# Stripe Express Connect - Setup & Testing

This document explains how to configure and test Stripe Express Connect for the Marquee backend. The code for the integration is provided in src/routes/stripe.js and an example server mount is in src/stripe/server.example.js.

Files added
- src/routes/stripe.js — Express routes: create-express-account, account-link, create-payment-intent, webhook handler
- src/stripe/server.example.js — Example mounting showing raw-body webhook handling and JSON parsing
- .env.example — Environment variable placeholders

1) Add the env vars to Railway
- In your Railway project → click your backend service → Variables tab
- Add:
  - STRIPE_SECRET_KEY (sk_test_...)
  - STRIPE_PUBLISHABLE_KEY (pk_test_...)
  - APP_URL (set to your Railway domain, e.g. https://marquee-backend-production.up.railway.app)
  - JWT_SECRET (if not already set)
  - STRIPE_WEBHOOK_SECRET (set after creating a webhook; see below)

2) Deploy to Railway
- Push the stripe-connect branch changes (already committed in this branch).
- Deploy the branch in Railway (or merge to main and let auto-deploy run).

3) Create a webhook in Stripe (or use stripe listen for local testing)
- In Stripe Dashboard → Developers → Webhooks → Add endpoint
  - Endpoint URL: https://<your-railway-domain>/api/stripe/webhook
  - Events to send (recommended minimal):
    - account.updated
    - payment_intent.succeeded
    - payment_intent.payment_failed
    - payout.paid
- Copy the Signing secret (starts with whsec_...) and paste it into Railway as STRIPE_WEBHOOK_SECRET.

Local testing with Stripe CLI
- Install the Stripe CLI and login: npm install -g stripe; stripe login
- Forward events to local server: stripe listen --forward-to localhost:3000/api/stripe/webhook
- The CLI prints a webhook signing secret (whsec_...); set that in your local .env as STRIPE_WEBHOOK_SECRET
- Create test events: stripe trigger payment_intent.succeeded, stripe trigger account.updated

Basic usage
- Onboard a user:
  1. POST /api/stripe/create-express-account (persist returned accountId to the user record)
  2. POST /api/stripe/account-link with { accountId } — respond with a url you redirect the user to for onboarding
- Create a payment:
  1. POST /api/stripe/create-payment-intent with { amount, connectedAccountId, application_fee_amount? }
  2. Use the returned clientSecret on the client with Stripe.js to confirm the payment

Notes & TODOs
- Persist Stripe account IDs and webhook-derived status (e.g., payouts_enabled) to your DB so you know which users are onboarded and payable.
- Ensure you never expose STRIPE_SECRET_KEY to clients.
- The webhook handler in src/routes/stripe.js validates Stripe signatures; keep STRIPE_WEBHOOK_SECRET safe.
- Replace the placeholder requireAuth and DB TODOs with your real auth and persistence logic.

If you want, I can open a PR from stripe-connect into your default branch, or merge these changes for you — tell me which you prefer and I'll proceed.
