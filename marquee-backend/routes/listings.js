const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = new PrismaClient();

// GET /listings?category=TENTS&query=tent&neighborhood=Riverside
// Public — anyone can browse without logging in.
router.get("/", async (req, res) => {
  const { category, query, neighborhood } = req.query;

  const listings = await prisma.listing.findMany({
    where: {
      active: true,
      ...(category && { category }),
      ...(neighborhood && { neighborhood }),
      ...(query && {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      }),
    },
    include: { host: { select: { name: true, verified: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json(listings);
});

// GET /listings/:id — single listing detail
router.get("/:id", async (req, res) => {
  const listing = await prisma.listing.findUnique({
    where: { id: req.params.id },
    include: { host: { select: { name: true, verified: true } } },
  });
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  res.json(listing);
});

// POST /listings — host creates a new listing. Requires auth + HOST/BOTH role.
router.post("/", requireAuth, requireRole(["HOST", "BOTH"]), async (req, res) => {
  const { title, category, description, pricePerDay, deliveryFee, neighborhood } = req.body;

  if (!title || !category || !pricePerDay || !neighborhood) {
    return res.status(400).json({ error: "title, category, pricePerDay, and neighborhood are required" });
  }

  const listing = await prisma.listing.create({
    data: {
      hostId: req.user.id,
      title,
      category,
      description: description || "",
      pricePerDay, // expected in cents from the client
      deliveryFee: deliveryFee ?? null,
      neighborhood,
    },
  });

  res.status(201).json(listing);
});

// PATCH /listings/:id — edit price, description, or pause a listing. Host-owner only.
router.patch("/:id", requireAuth, async (req, res) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  if (listing.hostId !== req.user.id) return res.status(403).json({ error: "Not your listing" });

  const updated = await prisma.listing.update({
    where: { id: req.params.id },
    data: req.body,
  });

  res.json(updated);
});

module.exports = router;
