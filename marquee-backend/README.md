# Marquee Backend

API for the event-equipment rental marketplace (tents, tables, sound, bounce houses, decor).
Pairs with the `marquee-app.jsx` (renter browsing/booking) and `marquee-host-dashboard.jsx`
(host listings/requests) frontend prototypes.

## What's actually implemented here

- **Data model** (`prisma/schema.prisma`) — users, listings, bookings, all money in integer cents
- **Availability logic** (`lib/availability.js`) — prevents double-booking; pending requests soft-block dates, not just accepted ones
- **Pricing** (`lib/pricing.js`) — subtotal, 20% service fee, delivery fee, host payout — one source of truth so frontend and backend never disagree on totals
- **Stripe Connect flow** (`lib/stripe.js`) — authorize on request → capture + split on accept → release on decline. This is the real mechanic that makes "you never own inventory" also mean "you never hold renters' money yourself"
- **Auto-expiry job** (`jobs/expirePending.js`) — auto-declines requests a host ignores for 24h, so a calendar slot doesn't stay stuck forever
- **REST routes** for listings (browse, create, edit) and bookings (request, accept, decline, history)
- **Messaging** (`routes/messages.js`) — one thread per booking, so renter and host can only message once there's an actual booking request (keeps the inbox spam-free and every message has context). Pushed live over Socket.io, with the REST route as the source of truth so it still works for clients that don't connect a socket.

## What's intentionally left as a stub

- **Social login** (Google/Apple/Facebook buttons) — the frontend shows these the way Airbnb does, but wiring real OAuth is its own project (Clerk or Auth0 give you this for free instead of building it against each provider's API directly). Email/password signup and login are real and working via `/auth/signup` and `/auth/login`.
- **Notifications** — email on booking request/accept/decline isn't wired up. Resend or SendGrid are the usual pick; the TODO comments mark exactly where to add the calls.
- **Photo uploads** — no image handling yet; add an S3/Cloudflare R2 upload route and a `photos` field on `Listing` when ready.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and STRIPE_SECRET_KEY
npx prisma migrate dev --name init
npm run dev
```

Server runs on `http://localhost:4000`. Try:

```bash
curl http://localhost:4000/health
curl http://localhost:4000/listings
```

## Stripe Connect setup (one-time, per environment)

1. Create a [Stripe account](https://dashboard.stripe.com/register) and grab your test secret key
2. Enable Connect in the dashboard (Stripe walks you through this)
3. When a host signs up, call `createHostConnectAccount()` from `lib/stripe.js` — it returns an onboarding URL to redirect them to. They can't receive payouts until they complete it.
4. Use Stripe's test cards (`4242 4242 4242 4242`) to simulate bookings end to end before going live

## The money flow, concretely

1. Renter requests a booking → card is **authorized**, not charged (`capture_method: manual`)
2. Host has 24h to accept or decline
3. **Accept** → capture the charge, `stripe.transfers.create()` sends the host their cut, you keep the 20% automatically
4. **Decline / no response** → `cancelPaymentIntent()` releases the hold, renter is never charged

## Auth

```bash
# Sign up
curl -X POST http://localhost:4000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"a@example.com","password":"hunter2","name":"Alex","role":"RENTER"}'
# → { token, user }

# Log in
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"a@example.com","password":"hunter2"}'

# Use the token on any protected route
curl http://localhost:4000/bookings/mine -H "Authorization: Bearer <token>"
```

## Messaging

Threads are per-booking, not open DMs — this matters because it means a renter can't
message a host until they've actually requested to book something, so hosts don't get
cold-messaged before there's real intent.

```bash
# Send a message (renter or host, whoever is req.user)
curl -X POST http://localhost:4000/messages/<bookingId> \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"body": "Can you deliver before 10am on the 14th?"}'

# Read the thread
curl http://localhost:4000/messages/<bookingId> -H "Authorization: Bearer <token>"
```

Connected clients also get pushed new messages instantly via Socket.io — join a room with
`socket.emit("booking:join", bookingId)` on the client, then listen for `message:new`.

## Next build priorities, in order

1. Wire up a real auth provider
2. Email notifications on request/accept/decline and new messages
3. Photo upload for listings
4. Reviews (renter → host, host → renter) after a booking completes
5. Search improvements (geo radius instead of exact neighborhood match)
