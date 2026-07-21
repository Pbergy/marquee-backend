// src/stripe/server.example.js
// Minimal example demonstrating mounting the stripe routes correctly
const express = require('express');
const app = express();
const stripeRouter = require('../routes/stripe');
const PORT = process.env.PORT || 3000;

// General JSON middleware (for all endpoints except webhook)
app.use((req, res, next) => {
  // allow the webhook route to access raw body; for other routes parse JSON normally
  if (req.originalUrl === '/api/stripe/webhook') return next();
  express.json()(req, res, next);
});

// Raw body middleware for webhook verification
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  // Save rawBody so route can access it (the route expects req.rawBody or req.body)
  req.rawBody = req.body;
  next();
});

// Mount router (webhook path is handled above with raw body)
app.use('/api/stripe', stripeRouter);

// Start
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
