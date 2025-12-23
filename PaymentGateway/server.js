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

/* ================= MIDDLEWARE ================= */
app.use(bodyParser.json());
app.use(cors());
app.use(express.static("public"));

/* ================= MONGODB CONNECTION ================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log(" MongoDB Connected"))
  .catch((err) => console.error(" MongoDB Error:", err));

/* ================= TANK SCHEMA ================= */
const tankSchema = new mongoose.Schema(
  {
    tank_capacity: { type: Number, required: true },
    tds: { type: Number, required: true },
    remaining: { type: Number, required: true },

    deducted_water: { type: Number, default: 0 }, 
  },
  { timestamps: true }
);

const Tank = mongoose.model("Tank", tankSchema);

/* ================= ORDER FILE SETUP ================= */
const ORDERS_FILE = path.join(__dirname, "order.json");

if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
}

function saveOrder(order) {
  const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
  orders.push(order);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

/* ================= CASHFREE INIT ================= */
const cashfree = new Cashfree(
  CFEnvironment.SANDBOX, // change to PRODUCTION in live
  process.env.CF_CLIENT_ID,
  process.env.CF_CLIENT_SECRET
);

/* ================= TANK APIs ================= */

// GET tank data
app.get("/tank", async (req, res) => {
  try {
    let tank = await Tank.findOne();

    if (!tank) {
      tank = await Tank.create({
        tank_capacity: 4000,
        tds: 150,
        remaining: 3980,
        request: 0,
      });
    }

    res.json(tank);

  } catch (err) {
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
      request: 0,
    });

    res.status(201).json({ message: "Tank created", tank });
  } catch (err) {
    res.status(500).json({ error: "Failed to create tank" });
  }
});

// UPDATE tank
app.put("/tank", async (req, res) => {
  try {
    const { tank_capacity, tds, remaining, deducted_water } = req.body;

    const tank = await Tank.findOne();
    if (!tank) return res.status(404).json({ error: "Tank not found" });

    if (tank_capacity !== undefined) tank.tank_capacity = Number(tank_capacity);
    if (tds !== undefined) tank.tds = Number(tds);
    if (remaining !== undefined) tank.remaining = Number(remaining);

    // ✅ FORCE deducted_water (ALLOW 0)
    if (deducted_water !== undefined) {
      if (deducted_water < 0) {
        return res.status(400).json({ error: "Invalid deducted_water" });
      }
      tank.deducted_water = Number(deducted_water);
    }

    await tank.save();

    res.json({ message: "Tank updated", tank });
  } catch (err) {
    res.status(500).json({ error: "Failed to update tank" });
  }
});

// DELETE / RESET tank
app.delete("/tank", async (req, res) => {
  try {
    await Tank.deleteMany();

    const tank = await Tank.create({
      tank_capacity: 4000,
      tds: 150,
      remaining: 4000,
      request: 0,
    });

    res.json({ message: "Tank reset", tank });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset tank" });
  }
});

/* ================= WATER REQUEST API ================= */
app.post("/tank/request", async (req, res) => {
  try {
    const { request } = req.body;

    // allow 0, but still reject negative or non-number
    if (request === undefined || request === null) {
      return res.status(400).json({ error: "request is required" });
    }

    const numericRequest = Number(request);
    if (Number.isNaN(numericRequest) || numericRequest < 0) {
      return res.status(400).json({ error: "Invalid request value" });
    }

    const tank = await Tank.findOne();
    if (!tank) return res.status(404).json({ error: "Tank not found" });

    if (numericRequest > tank.remaining) {
      return res.status(400).json({
        error: "INSUFFICIENT_WATER",
        available: tank.remaining,
      });
    }

    tank.request = numericRequest;
    await tank.save();

    res.json({
      message: "Request stored, proceed to payment",
      request: tank.request,
      remaining: tank.remaining,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to process request" });
  }
});

/* ================= CREATE CASHFREE ORDER ================= */
app.post("/create-order", async (req, res) => {
  try {
    const { amount, mobile, liters } = req.body;

    if (!amount || !mobile || !liters) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const tank = await Tank.findOne();
    if (!tank) return res.status(404).json({ error: "Tank not found" });

    if (liters > tank.remaining) {
      return res.status(400).json({
        error: "INSUFFICIENT_WATER",
        available: tank.remaining,
      });
    }

    const orderId = `order_${Date.now()}`;
    const baseUrl =
      process.env.BASE_URL || "https://water-dispension.onrender.com";

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

    res.json({
      payment_session_id: response.data.payment_session_id,
      order_id: response.data.order_id,
      remaining: tank.remaining,
      tds: tank.tds,
    });
  } catch (err) {
    res.status(500).json({ error: "Order creation failed" });
  }
});

/* ================= PAYMENT SUCCESS ================= */
app.get("/payment-success", async (req, res) => {
  const { order_id, liters } = req.query;

  try {
    const response = await cashfree.PGFetchOrder(order_id);

    if (response.data.order_status === "PAID") {
      const used = Number(liters) || 0;

      const tank = await Tank.findOne();
      tank.remaining = Math.max(0, tank.remaining - used);
      tank.request = 0;
      await tank.save();

      saveOrder({
        order_id,
        amount: response.data.order_amount,
        liters: used,
        remaining_water: tank.remaining,
        payment_status: "PAID",
      });

      res.redirect(
        `/bill.html?order_id=${order_id}&liters=${used}&remaining=${tank.remaining}`
      );
    } else {
      res.send("<h3>Payment Failed or Pending</h3>");
    }
  } catch (err) {
    res.send("<h3>Error verifying payment</h3>");
  }
});

/* ================= SERVER ================= */
app.listen(port, () => {
  console.log(` Server running on http://localhost:${port}`);
});
