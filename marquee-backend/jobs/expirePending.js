// Run on a schedule (e.g. every 15 min via node-cron, or a hosted cron job).
// Without this, a renter's card stays authorized indefinitely and the calendar
// stays soft-blocked for a listing the host never responded to.

const { findExpiredPending, releaseHold } = require("../lib/availability");
const { cancelPaymentIntent } = require("../lib/stripe");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function expirePendingBookings() {
  const expired = await findExpiredPending(24); // 24-hour host response window

  for (const booking of expired) {
    await cancelPaymentIntent(booking.stripePaymentIntentId);
    await releaseHold(booking.id);
    console.log(`Auto-declined booking ${booking.id} — host did not respond in time`);
    // TODO: notify both renter and host by email when this happens
  }

  return expired.length;
}

module.exports = { expirePendingBookings };

// If running standalone: `node jobs/expirePending.js`
if (require.main === module) {
  expirePendingBookings()
    .then((n) => { console.log(`Expired ${n} stale booking(s)`); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}
