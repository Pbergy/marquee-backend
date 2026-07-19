const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Minimal JWT auth so the API is runnable and testable on its own.
 * For a real launch, swap this for Clerk or Auth0 — you get social login,
 * password reset flows, and session management for free instead of
 * maintaining it yourself. The rest of the app only depends on req.user
 * being set, so swapping the auth provider later doesn't touch any route logic.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing auth token" });

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires one of: ${allowed.join(", ")}` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
