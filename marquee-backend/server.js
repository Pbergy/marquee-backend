require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const listingsRouter = require("./routes/listings");
const bookingsRouter = require("./routes/bookings");
const messagesRouter = require("./routes/messages");
const authRouter = require("./routes/auth");

// Stripe routes (added on stripe-connect branch)
const stripeRouter = require("./routes/stripe");

const app = express();
app.use(cors());

// Important: let the webhook path receive the raw body for Stripe signature verification.
// Use express.json() for all routes except the webhook path.
app.use((req, res, next) => {
  if (req.originalUrl === "/stripe/webhook" || req.originalUrl === "/stripe/webhook/") return next();
  express.json()(req, res, next);
});

// Raw body middleware for webhook verification (must be BEFORE the router that handles /stripe/webhook)
app.post("/stripe/webhook", express.raw({ type: "application/json" }), (req, res, next) => {
  // Save rawBody so the route can access it (the route expects req.rawBody)
  req.rawBody = req.body;
  next();
});

// Mount main API routes
app.use("/auth", authRouter);
app.use("/listings", listingsRouter);
app.use("/bookings", bookingsRouter);
app.use("/messages", messagesRouter);

// Mount stripe routes (all other stripe endpoints expect normal JSON parsing)
app.use("/stripe", stripeRouter);

app.get("/health", (req, res) => res.json({ status: "ok" }));

// Socket.io
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

io.on("connection", (socket) => {
  socket.on("booking:join", (bookingId) => socket.join(`booking:${bookingId}`));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Marquee API running on port ${PORT}`));
