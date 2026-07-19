const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const prisma = new PrismaClient();

/**
 * Design choice: conversations are scoped to a booking, not open DMs.
 * A renter can only message a host once they've actually requested to book
 * something. This keeps the inbox spam-free and every message has context
 * (which item, which dates) without either side having to repeat it.
 */
async function assertParticipant(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { listing: true },
  });
  if (!booking) return null;
  const isRenter = booking.renterId === userId;
  const isHost = booking.listing.hostId === userId;
  if (!isRenter && !isHost) return null;
  return booking;
}

// GET /messages/:bookingId — full thread for one booking
router.get("/:bookingId", requireAuth, async (req, res) => {
  const booking = await assertParticipant(req.params.bookingId, req.user.id);
  if (!booking) return res.status(403).json({ error: "Not part of this booking" });

  const messages = await prisma.message.findMany({
    where: { bookingId: req.params.bookingId },
    orderBy: { createdAt: "asc" },
  });

  // Mark the other participant's messages as read now that this user opened the thread
  await prisma.message.updateMany({
    where: { bookingId: req.params.bookingId, senderId: { not: req.user.id }, readAt: null },
    data: { readAt: new Date() },
  });

  res.json(messages);
});

// POST /messages/:bookingId — send a message on this booking's thread
router.post("/:bookingId", requireAuth, async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: "Message body is required" });

  const booking = await assertParticipant(req.params.bookingId, req.user.id);
  if (!booking) return res.status(403).json({ error: "Not part of this booking" });

  const message = await prisma.message.create({
    data: { bookingId: req.params.bookingId, senderId: req.user.id, body: body.trim() },
  });

  // If you add lib/notify.js later, this is where you'd email/push the other participant.
  req.app.get("io")?.to(`booking:${req.params.bookingId}`).emit("message:new", message);

  res.status(201).json(message);
});

// GET /messages — inbox: every thread this user is part of, most recent first
router.get("/", requireAuth, async (req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { OR: [{ renterId: req.user.id }, { listing: { hostId: req.user.id } }] },
    include: {
      listing: { select: { title: true, hostId: true } },
      renter: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const inbox = bookings
    .filter((b) => b.messages.length > 0)
    .map((b) => ({
      bookingId: b.id,
      listingTitle: b.listing.title,
      otherParty: b.renterId === req.user.id ? undefined : b.renter.name, // host sees renter's name; renter's UI already knows the host from the listing
      lastMessage: b.messages[0],
      unread: b.messages[0].senderId !== req.user.id && !b.messages[0].readAt,
    }))
    .sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt));

  res.json(inbox);
});

module.exports = router;
