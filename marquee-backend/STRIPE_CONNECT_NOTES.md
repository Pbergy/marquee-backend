# Marquee backend — notes for deploying stripe-connect branch

This branch adds Stripe Connect Express flows, webhook handling, and server wiring. Before merging to main, verify the following:

- Environment variables (Railway):
  - STRIPE_SECRET_KEY
  - STRIPE_PUBLISHABLE_KEY
  - STRIPE_WEBHOOK_SECRET
  - APP_URL
  - JWT_SECRET

- The webhook path is /stripe/webhook. If you prefer /api/stripe/webhook, update server.js and routes accordingly.

- Code touches:
  - marquee-backend/routes/stripe.js (new)
  - marquee-backend/server.js (mounted stripe router and raw webhook body handler)

