require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const listingsRouter = require("./routes/listings");
const bookingsRouter = require("./routes/bookings");
const messagesRouter = require("./routes/messages");
const authRouter = require("./routes/auth");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/listings", listingsRouter);
app.use("/bookings", bookingsRouter);
app.use("/messages", messagesRouter);

app.get("/health", (req, res) => res.json({ status: "ok" }));

// Socket.io: messages are written via the normal REST route (POST /messages/:bookingId),
// which then emits over this socket — so the API works fine even for clients that don't
// use sockets, and connected clients just get pushed the new message instantly instead
// of having to poll GET /messages/:bookingId on a timer.
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

io.on("connection", (socket) => {
  socket.on("booking:join", (bookingId) => socket.join(`booking:${bookingId}`));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Marquee API running on port ${PORT}`));
