/**
 * src/routes/stripe.js
 *
 * Stripe Connect (Express) routes
 *
 * Mount this router on /api/stripe
 *
 * Requirements:
 * - npm install stripe
 * - Add env vars: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, APP_URL, STRIPE_WEBHOOK_SECRET (set after you create webhook)
 *
 * Important: the webhook route must be called with raw body (see server mounting below).
 */
const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2022-11-15' }); // adjust version if you prefer

// Helpers: replace these with your real auth/DB code
function requireAuth(req, res, next) {
  // placeholder: validate JWT / session and set req.user
  // e.g. req.user = { id: 'user-id', email: 'owner@example.com' }
  next();
}

/**
 * POST /api/stripe/create-express-account
 * Creates a Stripe Express account and returns the account id.
 * You should persist the returned account.id on your user record.
 */
router.post('/create-express-account', requireAuth, async (req, res) => {
  try {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US', // change as needed or make dynamic
      email: req.body.email || (req.user && req.user.email),
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual', // or 'company' depending on your UX
    });

    // TODO: persist `account.id` to your DB for the current user
    // await prisma.user.update({ where: { id: req.user.id }, data: { stripeAccountId: account.id } });

    res.json({ accountId: account.id });
  } catch (err) {
    console.error('create-express-account err', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stripe/account-link
 * Request body: { accountId }
 * Creates an account link for onboarding (redirect user to Stripe-hosted onboarding).
 */
router.post('/account-link', requireAuth, async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    const origin = process.env.APP_URL || 'http://localhost:3000';
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/onboard/refresh`, // handle refresh as you like
      return_url: `${origin}/onboard/return`,   // user lands here after onboarding
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error('account-link err', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stripe/create-payment-intent
 * Body: { amount, currency, connectedAccountId, application_fee_amount? }
 *
 * Creates a PaymentIntent on the platform that transfers to the connected account via transfer_data.destination.
 * The client should use the returned client_secret with Stripe.js to confirm the payment.
 */
router.post('/create-payment-intent', requireAuth, async (req, res) => {
  try {
    const { amount, currency = 'usd', connectedAccountId, application_fee_amount } = req.body;
    if (!amount || !connectedAccountId) return res.status(400).json({ error: 'amount and connectedAccountId required' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Number(amount),
      currency,
      payment_method_types: ['card'],
      // Route funds to the connected account
      transfer_data: {
        destination: connectedAccountId,
      },
      // Optional platform fee you keep (in cents)
      ...(application_fee_amount ? { application_fee_amount: Number(application_fee_amount) } : {}),
      // Optionally set metadata (booking id, listing id, etc.)
      metadata: {
        platform: 'marquee',
      },
    });

    res.json({ clientSecret: paymentIntent.client_secret, id: paymentIntent.id });
  } catch (err) {
    console.error('create-payment-intent err', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stripe/webhook
 * This endpoint must receive the raw request body to verify the Stripe signature header.
 *
 * IMPORTANT: When you mount this route, use express.raw({type: 'application/json'}) for this path.
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const rawBody = req.rawBody || req.body; // req.rawBody set by mounting middleware below
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event types you care about
  switch (event.type) {
    case 'account.updated': {
      const account = event.data.object;
      // Use account.id to map to your user and update status (payouts_enabled, requirements)
      // Example: mark user as fully onboarded when payouts_enabled === true
      console.log('account.updated', account.id, 'payouts_enabled=', account.payouts_enabled);
      // TODO: persist to DB
      break;
    }
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      console.log('payment_intent.succeeded', pi.id, 'amount:', pi.amount);
      // TODO: mark booking as paid, send emails, etc.
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      console.log('payment_intent.payment_failed', pi.last_payment_error);
      // TODO: handle failure
      break;
    }
    case 'payout.paid': {
      const payout = event.data.object;
      console.log('payout.paid for account', payout.destination, payout.amount);
      // TODO: notify user / update payout record in DB
      break;
    }
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

module.exports = router;
