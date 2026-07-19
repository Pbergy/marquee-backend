const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Step 1 of the money flow: authorize the renter's card for the full total
 * when they submit a booking request. Nothing is captured yet — this just
 * places a hold, the same way a hotel does at check-in.
 */
async function createHoldPaymentIntent({ amount, renterStripeCustomerId }) {
  return stripe.paymentIntents.create({
    amount, // cents
    currency: "usd",
    customer: renterStripeCustomerId,
    capture_method: "manual", // <-- this is what makes it an authorization, not an immediate charge
    automatic_payment_methods: { enabled: true },
  });
}

/**
 * Step 2: host accepts. Capture the authorized funds, then transfer the
 * host's share to their connected Stripe account. Your platform keeps the
 * difference (the service fee) automatically — you never have to move it
 * yourself.
 */
async function capturePayment({ paymentIntentId, hostStripeConnectId, hostPayoutAmount }) {
  const captured = await stripe.paymentIntents.capture(paymentIntentId);

  const transfer = await stripe.transfers.create({
    amount: hostPayoutAmount,
    currency: "usd",
    destination: hostStripeConnectId,
    source_transaction: captured.latest_charge,
  });

  return { captured, transfer };
}

/**
 * Host declines, or a pending request expires: release the hold entirely.
 * The renter's card is never actually charged.
 */
async function cancelPaymentIntent(paymentIntentId) {
  return stripe.paymentIntents.cancel(paymentIntentId);
}

/**
 * Call this once when a host signs up, to create their Connect Express account
 * and get the onboarding link Stripe hosts for them (collects bank details,
 * identity verification, etc. — you never touch that data directly).
 */
async function createHostConnectAccount({ email }) {
  const account = await stripe.accounts.create({
    type: "express",
    email,
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
  });

  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${process.env.APP_URL}/host/onboarding/refresh`,
    return_url: `${process.env.APP_URL}/host/onboarding/complete`,
    type: "account_onboarding",
  });

  return { accountId: account.id, onboardingUrl: accountLink.url };
}

module.exports = {
  createHoldPaymentIntent,
  capturePayment,
  cancelPaymentIntent,
  createHostConnectAccount,
};
