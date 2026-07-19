const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Two date ranges overlap if one starts before the other ends, in both directions.
 * This is the standard interval-overlap check.
 */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Checks whether a listing is free for a given date range.
 *
 * Important design choice: PENDING bookings count as blockers too, not just
 * ACCEPTED ones. Otherwise two renters could both "request" the same tent for
 * the same weekend, and only one host decision away, both think they got it.
 * We soft-block on request, and free the dates again if the host declines
 * or the request times out.
 */
async function isAvailable(listingId, startDate, endDate, quantity = 1) {
  const overlapping = await prisma.booking.findMany({
    where: {
      listingId,
      status: { in: ["PENDING", "ACCEPTED"] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
  });

  const bookedQty = overlapping.reduce((sum, b) => sum + b.quantity, 0);

  // Most party-equipment listings represent a single physical item (qty available = 1),
  // but this supports hosts who list multiples (e.g. "10 round tables" listed as one
  // listing with quantity=10 available) by comparing against a listing.totalQuantity field
  // if you add one — for now this assumes single-unit listings unless extended.
  return bookedQty + quantity <= 1 || bookedQty === 0;
}

/**
 * Releases a PENDING booking's hold on the calendar — call this when a host
 * declines, or when a pending request passes its response-window deadline.
 */
async function releaseHold(bookingId) {
  return prisma.booking.update({
    where: { id: bookingId },
    data: { status: "DECLINED", respondedAt: new Date() },
  });
}

/**
 * Finds all pending requests older than the response window (default 24h)
 * so a scheduled job can auto-decline and free the calendar.
 * Run this on a cron (e.g. every 15 min) — see jobs/expirePending.js.
 */
async function findExpiredPending(hours = 24) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return prisma.booking.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
  });
}

module.exports = { rangesOverlap, isAvailable, releaseHold, findExpiredPending };
