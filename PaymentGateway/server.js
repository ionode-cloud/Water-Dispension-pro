require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const { Cashfree, CFEnvironment } = require("cashfree-pg");

const app = express();
const port = process.env.PORT || 3567;

/* MIDDLEWARE */
app.use(bodyParser.json());
app.use(cors());
app.use(express.static("public"));

/* MONGODB CONNECTION */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log(" MongoDB Connected"))
  .catch((err) => console.error("MongoDB Error:", err));

/* TANK SCHEMA */
const tankSchema = new mongoose.Schema(
  {
    tank_capacity: { type: Number, required: true },
    tds: { type: Number, required: true },
    remaining: { type: Number, required: true },

    // NEW FIELD
    request: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

const Tank = mongoose.model("Tank", tankSchema);

/* ORDER FILE SETUP */
const ORDERS_FILE = path.join(__dirname, "order.json");

if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
}

function saveOrder(order) {
  const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
  orders.push(order);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

/* CASHFREE INIT */
const cashfree = new Cashfree(
  CFEnvironment.SANDBOX,
  process.env.CF_CLIENT_ID,
  process.env.CF_CLIENT_SECRET
);

/* TANK APIs */

// GET tank
app.get("/tank", async (req, res) => {
  try {
    let tank = await Tank.findOne();

    if (!tank) {
      tank = await Tank.create({
        tank_capacity: 5000,
        tds: 150,
        remaining: 5000,
        request: 0, // default request when creating
      });
    }

    res.json(tank);
  } catch (err) {
    console.error("Error fetching tank:", err);
    res.status(500).json({ error: "Failed to fetch tank data" });
  }
});

// CREATE / RESET tank
app.post("/tank", async (req, res) => {
  try {
    const { tank_capacity, tds } = req.body;

    if (tank_capacity == null || tds == null) {
      return res.status(400).json({ error: "tank_capacity and tds required" });
    }

    await Tank.deleteMany();

    const tank = await Tank.create({
      tank_capacity: Number(tank_capacity),
      tds: Number(tds),
      remaining: Number(tank_capacity),
      request: 0, // default request
    });

    res.status(201).json({ message: "Tank created", tank });
  } catch (err) {
    console.error("Error creating tank:", err);
    res.status(500).json({ error: "Failed to create tank" });
  }
});

// UPDATE tank - NOW INCLUDES REMAINING FIELD
app.put("/tank", async (req, res) => {
  try {
    const { tank_capacity, tds, remaining, request } = req.body;

    const tank = await Tank.findOne();
    if (!tank) return res.status(404).json({ error: "Tank not found" });

    // Update tank_capacity if provided
    if (tank_capacity != null) {
      tank.tank_capacity = Number(tank_capacity);
      // If remaining exceeds new capacity, adjust it
      if (tank.remaining > tank.tank_capacity) {
        tank.remaining = tank.tank_capacity;
      }
    }

    // Update TDS if provided
    if (tds != null) {
      tank.tds = Number(tds);
    }

    // Update remaining if provided
    if (remaining != null) {
      const newRemaining = Number(remaining);
      // Validate remaining doesn't exceed capacity
      if (newRemaining > tank.tank_capacity) {
        return res.status(400).json({
          error: "Remaining cannot exceed tank capacity",
          tank_capacity: tank.tank_capacity,
        });
      }
      if (newRemaining < 0) {
        return res.status(400).json({ error: "Remaining cannot be negative" });
      }
      tank.remaining = newRemaining;
    }

    // Update request if provided
    if (request != null) {
      tank.request = Number(request);
    }

    await tank.save();
    res.json({ message: "Tank updated", tank });
  } catch (err) {
    console.error("Error updating tank:", err);
    res.status(500).json({ error: "Failed to update tank" });
  }
});

// DELETE tank (reset to default)
app.delete("/tank", async (req, res) => {
  try {
    await Tank.deleteMany();

    const tank = await Tank.create({
      tank_capacity: 5000,
      tds: 150,
      remaining: 5000,
      request: 0,
    });

    res.json({ message: "Tank reset", tank });
  } catch (err) {
    console.error("Error resetting tank:", err);
    res.status(500).json({ error: "Failed to reset tank" });
  }
});

/* CREATE ORDER */
app.post("/create-order", async (req, res) => {
  try {
    const { amount, mobile, liters } = req.body;

    if (!amount || !mobile || !liters) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const tank = await Tank.findOne();
    if (!tank) return res.status(404).json({ error: "Tank not found" });

    // Use tank.request to check available water (tank_capacity - remaining)
    const available = tank.tank_capacity - tank.remaining;
    if (liters > available) {
      return res.status(400).json({
        error: "INSUFFICIENT_WATER",
        available: available,
      });
    }

    const orderId = `order_${Date.now()}`;

    const baseUrl = process.env.BASE_URL || `https://water-dispension.onrender.com`;

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
        return_url: `${baseUrl}/payment-success?order_id=${orderId}&liters=${liters}`,
      },
    };

    const response = await cashfree.PGCreateOrder(request);

    // Store the requested liters in tank.request
    tank.request = Number(liters);
    await tank.save();

    res.json({
      payment_session_id: response.data.payment_session_id,
      order_id: response.data.order_id,
      remaining: tank.remaining,
      tds: tank.tds,
    });
  } catch (err) {
    console.error("Order creation error:", err);
    res.status(500).json({ error: "Order creation failed" });
  }
});

/* PAYMENT SUCCESS */
app.get("/payment-success", async (req, res) => {
  const { order_id, liters } = req.query;

  try {
    const response = await cashfree.PGFetchOrder(order_id);

    if (response.data.order_status === "PAID") {
      const used = Number(liters) || 0;

      const tank = await Tank.findOne();
      if (!tank) {
        return res.status(404).send("<h3>Tank not found</h3>");
      }

      // Update remaining water
      tank.remaining = Math.max(0, tank.remaining - used);
      // Reset request after successful payment
      tank.request = 0;
      await tank.save();

      const bill = {
        order_id: response.data.order_id,
        amount: response.data.order_amount,
        currency: response.data.order_currency,
        liters: used,
        customer: response.data.customer_details,
        payment_status: "PAID",
        payment_time: new Date().toISOString(),
        remaining_water: tank.remaining,
      };

      saveOrder(bill);

      res.redirect(
        `/bill.html?order_id=${bill.order_id}&amount=${bill.amount}&liters=${used}&remaining=${tank.remaining}`
      );
    } else {
      res.send("<h3>Payment Failed or Pending</h3>");
    }
  } catch (err) {
    console.error("Payment verification error:", err);
    res.send("<h3>Error verifying payment</h3>");
  }
});

// NEW: Check payment status endpoint for frontend polling
app.get("/check-payment-status/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const response = await cashfree.PGFetchOrder(orderId);
    
    res.json({
      status: response.data.order_status,
      amount: response.data.order_amount,
      order_id: response.data.order_id,
    });
  } catch (err) {
    console.error("Status check error:", err);
    res.status(500).json({ error: "Failed to check payment status" });
  }
});

/* START SERVER */
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
