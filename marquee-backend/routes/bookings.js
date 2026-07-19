const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { requireAuth } = require("../middleware/auth");
const { isAvailable } = require("../lib/availability");
const { calculateBookingTotal } = require("../lib/pricing");
const { createHoldPaymentIntent, capturePayment, cancelPaymentIntent } = require("../lib/stripe");

const router = express.Router();
const prisma = new PrismaClient();

// POST /bookings — renter requests to book a listing.
// Money is AUTHORIZED here but not captured — the host still has to accept.
router.post("/", requireAuth, async (req, res) => {
  const { listingId, startDate, endDate, quantity = 1, deliveryAdded = false } = req.body;

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing || !listing.active) return res.status(404).json({ error: "Listing not available" });

  const free = await isAvailable(listingId, new Date(startDate), new Date(endDate), quantity);
  if (!free) return res.status(409).json({ error: "Those dates are no longer available for this item" });

  const { days, subtotal, serviceFee, delivery, total, hostPayout } = calculateBookingTotal({
    pricePerDay: listing.pricePerDay,
    startDate, endDate, quantity,
    deliveryFee: listing.deliveryFee,
    deliveryAdded,
  });

  // Authorize funds now (renter's card is charged nothing yet — just a hold).
  const paymentIntent = await createHoldPaymentIntent({
    amount: total,
    renterStripeCustomerId: req.user.stripeCustomerId,
  });

  const booking = await prisma.booking.create({
    data: {
      listingId, renterId: req.user.id,
      startDate: new Date(startDate), endDate: new Date(endDate),
      quantity, deliveryAdded,
      subtotal, serviceFee, deliveryFee: delivery, total,
      status: "PENDING",
      stripePaymentIntentId: paymentIntent.id,
    },
  });

  res.status(201).json({ booking, days, hostPayout });
});

// POST /bookings/:id/accept — host accepts. Captures payment, splits via Stripe Connect.
router.post("/:id/accept", requireAuth, async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { listing: true },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.listing.hostId !== req.user.id) return res.status(403).json({ error: "Not your listing" });
  if (booking.status !== "PENDING") return res.status(400).json({ error: `Booking already ${booking.status.toLowerCase()}` });

  const hostPayout = booking.subtotal + booking.deliveryFee; // everything except your service fee

  await capturePayment({
    paymentIntentId: booking.stripePaymentIntentId,
    hostStripeConnectId: req.user.stripeConnectId,
    hostPayoutAmount: hostPayout,
  });

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });

  res.json(updated);
});

// POST /bookings/:id/decline — host declines. Releases the payment hold and frees the calendar.
router.post("/:id/decline", requireAuth, async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { listing: true },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (booking.listing.hostId !== req.user.id) return res.status(403).json({ error: "Not your listing" });

  await cancelPaymentIntent(booking.stripePaymentIntentId);

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "DECLINED", respondedAt: new Date() },
  });

  res.json(updated);
});

// GET /bookings/mine — renter's own booking history
router.get("/mine", requireAuth, async (req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { renterId: req.user.id },
    include: { listing: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(bookings);
});

// GET /bookings/incoming — host's requests across all their listings
router.get("/incoming", requireAuth, async (req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { listing: { hostId: req.user.id } },
    include: { listing: true, renter: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(bookings);
});

module.exports = router;
