const express = require("express");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const Stripe = require("stripe");

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" });

// Auth middleware — mirrors routes/auth.js token verification and loads user
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "Invalid token (user not found)" });
    req.user = user;
    next();
  } catch (err) {
    console.error('auth error', err);
    return res.status(401).json({ error: 'Invalid auth token' });
  }
}

/**
 * POST /stripe/create-express-account
 * Creates a Stripe Express account, persists stripeConnectId on the user record.
 */
router.post('/create-express-account', requireAuth, async (req, res) => {
  try {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: req.user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
    });

    // persist to DB
    await prisma.user.update({ where: { id: req.user.id }, data: { stripeConnectId: account.id } });

    res.json({ accountId: account.id });
  } catch (err) {
    console.error('create-express-account err', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /stripe/account-link
 * Body: { accountId? }
 * Creates an account link for onboarding (redirect user to Stripe-hosted onboarding).
 */
router.post('/account-link', requireAuth, async (req, res) => {
  try {
    const accountId = req.body.accountId || req.user.stripeConnectId;
    if (!accountId) return res.status(400).json({ error: 'accountId required (or create-express-account first)' });

    const origin = process.env.APP_URL || 'http://localhost:3000';
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/onboard/refresh`,
      return_url: `${origin}/onboard/return`,
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error('account-link err', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /stripe/create-payment-intent
 * Body: { bookingId, application_fee_amount? }
 * Creates a PaymentIntent for a booking and routes funds to the host's connected account.
 */
router.post('/create-payment-intent', requireAuth, async (req, res) => {
  try {
    const { bookingId, application_fee_amount } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { listing: { include: { host: true } }, renter: true },
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const connectedAccountId = booking.listing.host.stripeConnectId;
    if (!connectedAccountId) return res.status(400).json({ error: 'Host is not onboarded to Stripe Connect' });

    const amount = booking.total; // already in cents
    const fee = application_fee_amount ? Number(application_fee_amount) : booking.serviceFee;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Number(amount),
      currency: 'usd',
      payment_method_types: ['card'],
      transfer_data: { destination: connectedAccountId },
      ...(fee ? { application_fee_amount: Number(fee) } : {}),
      metadata: { bookingId: booking.id },
    });

    // persist the payment intent id to booking
    await prisma.booking.update({ where: { id: booking.id }, data: { stripePaymentIntentId: paymentIntent.id } });

    res.json({ clientSecret: paymentIntent.client_secret, id: paymentIntent.id });
  } catch (err) {
    console.error('create-payment-intent err', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /stripe/webhook
 * Raw body middleware must be applied on the server for this path so req.rawBody exists.
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const rawBody = req.rawBody || req.body;
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object;
        console.log('account.updated', account.id, 'payouts_enabled=', account.payouts_enabled);
        // TODO: persist any requirements/payouts_enabled state to your DB if needed
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        console.log('payment_intent.succeeded', pi.id, 'amount:', pi.amount);
        const bookingId = pi.metadata?.bookingId;
        if (bookingId) {
          await prisma.booking.update({ where: { id: bookingId }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        console.log('payment_intent.payment_failed', pi.id, pi.last_payment_error);
        const bookingId = pi.metadata?.bookingId;
        if (bookingId) {
          await prisma.booking.update({ where: { id: bookingId }, data: { status: 'PENDING' } });
        }
        break;
      }
      case 'payout.paid': {
        const payout = event.data.object;
        console.log('payout.paid for account', payout.destination, payout.amount);
        break;
      }
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  } catch (err) {
    console.error('Error handling webhook event', err);
  }

  res.json({ received: true });
});

module.exports = router;
