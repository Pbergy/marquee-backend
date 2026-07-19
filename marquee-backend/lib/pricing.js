const SERVICE_FEE_RATE = 0.20; // 20% platform commission, matches the frontend cart

/**
 * All money is handled in integer cents throughout the backend — never floats —
 * to avoid rounding drift once real payments are involved.
 */
function calculateBookingTotal({ pricePerDay, startDate, endDate, quantity = 1, deliveryFee = 0, deliveryAdded = false }) {
  const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
  if (days < 1) throw new Error("End date must be on or after start date");

  const subtotal = pricePerDay * days * quantity;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
  const delivery = deliveryAdded ? deliveryFee || 0 : 0;
  const total = subtotal + serviceFee + delivery;

  // hostPayout is what the host receives via Stripe Connect — everything except
  // your service fee. Delivery fee, if the host handles delivery themselves,
  // passes through to the host too.
  const hostPayout = subtotal + delivery;

  return { days, subtotal, serviceFee, delivery, total, hostPayout };
}

module.exports = { calculateBookingTotal, SERVICE_FEE_RATE };
