const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

function issueToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

// POST /auth/signup — { email, password, name, role: "RENTER" | "HOST" | "BOTH" }
// This is the "sign up" step the frontend's onboarding screen calls before
// letting someone into the customer or host experience.
router.post("/signup", async (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "email, password, and name are required" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "An account with that email already exists" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role: role || "RENTER" },
  });

  res.status(201).json({ token: issueToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// POST /auth/login — { email, password }
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid email or password" });

  res.json({ token: issueToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// PATCH /auth/role — lets someone switch between customer and host after signup,
// same idea as the "Switch to hosting" / "Switch to renting" links in the frontend.
router.patch("/role", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });
  const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);

  const { role } = req.body; // "RENTER" | "HOST" | "BOTH"
  const user = await prisma.user.update({ where: { id: payload.sub }, data: { role } });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

module.exports = router;
