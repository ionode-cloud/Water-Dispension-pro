// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const { Cashfree, CFEnvironment } = require("cashfree-pg");

const app = express();
const port = process.env.PORT || 3567;

// Middleware
app.use(bodyParser.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.static("public"));

/* ==========================
   Cashfree Initialization
========================== */

const cashfree = new Cashfree(
  CFEnvironment.SANDBOX,
  process.env.CF_CLIENT_ID,
  process.env.CF_CLIENT_SECRET
);

/* ==========================
   In-memory Tank State
========================== */

// Tank settings (capacity, TDS) + current remaining water
let tankState = {
  tank_capacity: 500, // liters
  tds: 150,           // ppm
  remaining: 500,     // current available water
};

/* ==========================
   Tank Settings API
   POST / GET / PUT / DELETE
========================== */

app.get("/tank-settings", (req, res) => {
  res.json({
    tank_capacity: tankState.tank_capacity,
    tds: tankState.tds,
    remaining: tankState.remaining,
  });
});

app.post("/tank-settings", (req, res) => {
  const { tank_capacity, tds } = req.body;

  if (tank_capacity == null || tds == null) {
    return res.status(400).json({
      error: "tank_capacity and tds are required",
    });
  }

  tankState.tank_capacity = Number(tank_capacity);
  tankState.tds = Number(tds);
  tankState.remaining = tankState.tank_capacity; // reset remaining to full

  res.status(201).json({
    message: "Tank settings created/updated",
    ...tankState,
  });
});

app.put("/tank-settings", (req, res) => {
  const { tank_capacity, tds } = req.body;

  if (tank_capacity == null && tds == null) {
    return res.status(400).json({
      error: "Provide at least one of: tank_capacity, tds",
    });
  }

  if (tank_capacity != null) {
    tankState.tank_capacity = Number(tank_capacity);
    // If capacity is reduced below remaining, clamp remaining
    if (tankState.remaining > tankState.tank_capacity) {
      tankState.remaining = tankState.tank_capacity;
    }
  }
  if (tds != null) {
    tankState.tds = Number(tds);
  }

  res.json({
    message: "Tank settings updated",
    ...tankState,
  });
});

app.delete("/tank-settings", (req, res) => {
  tankState = {
    tank_capacity: 500,
    tds: 150,
    remaining: 500,
  };

  res.json({
    message: "Tank settings reset to default",
    ...tankState,
  });
});

/* ==========================
   Create Order API
========================== */

app.post("/create-order", async (req, res) => {
  try {
    const { amount, mobile, liters } = req.body; // now accept liters too

    console.log("Create order request:", req.body);

    if (!amount || !mobile || !liters) {
      return res.status(400).json({
        error: "AMOUNT_MOBILE_LITERS_REQUIRED",
        message: "Amount, mobile, and liters are required",
      });
    }

    // Check if enough water is available
    if (liters > tankState.remaining) {
      return res.status(400).json({
        error: "INSUFFICIENT_WATER",
        message: `Only ${tankState.remaining}L available`,
      });
    }

    const orderId = `order_${Date.now()}`;

    const request = {
      order_id: orderId,
      order_amount: Number(amount),
      order_currency: "INR",
      customer_details: {
        customer_id: mobile,
        customer_name: "Water User",
        customer_email: "test@example.com",
        customer_phone: mobile,
      },
      order_meta: {
        return_url: `http://localhost:3567/payment-success?order_id=${orderId}&liters=${liters}`,
      },
    };

    const response = await cashfree.PGCreateOrder(request);

    console.log("Cashfree response:", response.data);

    return res.json({
      payment_session_id: response.data.payment_session_id,
      order_id: response.data.order_id,
      // Also send current remaining so frontend can show it
      remaining: tankState.remaining,
    });
  } catch (error) {
    console.error("Cashfree error:", error.response?.data || error.message);

    return res.status(500).json({
      error: "ORDER_CREATION_FAILED",
      details: error.response?.data || error.message,
    });
  }
});

/* ==========================
   Payment Success Page
========================== */

app.get("/payment-success", async (req, res) => {
  const { order_id, liters } = req.query;

  try {
    const response = await cashfree.PGFetchOrder(order_id);

    if (response.data.order_status === "PAID") {
      const paidLiters = parseFloat(liters) || 0;

      // Deduct water only if payment is successful
      tankState.remaining = Math.max(0, tankState.remaining - paidLiters);

      // Redirect to bill page with updated info
      res.redirect(
        `/bill.html?order_id=${order_id}&amount=${response.data.order_amount}&liters=${paidLiters}&remaining=${tankState.remaining}`
      );
    } else {
      res.send("<h3>❌ Payment Failed or Pending</h3>");
    }
  } catch (err) {
    console.error(err);
    res.send("<h3>Error verifying payment</h3>");
  }
});

/* ==========================
   Start Server
========================== */

app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
