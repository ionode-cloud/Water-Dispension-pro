import React, { useState, useEffect } from "react";
import WaterJar from "./Components/Waterjar";
import { load } from "@cashfreepayments/cashfree-js";
import "./App.css";

const App = () => {
  const PRICE_PER_LITER = 5;
  const PRESET_LITERS = [1, 2, 5, 10, 15, 20];

  const [tds, setTds] = useState(0);
  const [tankCapacity, setTankCapacity] = useState(0);
  const [tankRemaining, setTankRemaining] = useState(0);
  const [liters, setLiters] = useState(0);
  const [amount, setAmount] = useState(0);
  const [mobile, setMobile] = useState("");
  const [litersInput, setLitersInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL;

  //  FIXED: Safe fetch that shows REAL errors instead of crashing
  const safeFetch = async (url, options = {}) => {
    console.log('Fetching:', url); // Debug
    const res = await fetch(url, options);
    
    if (!res.ok) {
      const text = await res.text();
      console.error(`${res.status} ${url}:`, text.slice(0, 200));
      throw new Error(`HTTP ${res.status} - Check backend`);
    }
    
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      const text = await res.text();
      console.error(' Not JSON:', text.slice(0, 200));
      throw new Error('Backend returned HTML (404/route missing)');
    }
    
    return res.json();
  };

  // 🔧 FIXED: Now shows exact error instead of crashing
  const fetchTankSettings = async () => {
    try {
      const data = await safeFetch(`${API_URL}/tank`);
      setTankCapacity(data.tank_capacity );
      setTankRemaining(data.remaining );
      if (data.tds != null) setTds(data.tds);
      console.log('✅ Tank data:', data);
    } catch (err) {
      console.error("Error fetching tank settings:", err.message);
      // Keep default values - app still works
    }
  };

  useEffect(() => {
    fetchTankSettings();
  }, []);

  const calculateFromLiters = (value) => {
    if (value > tankRemaining) {
      alert(`Water not available! Only ${tankRemaining}L left.`);
      setLiters(0);
      setAmount(0);
      setLitersInput("");
      setAmountInput("");
    } else {
      const cost = value * PRICE_PER_LITER;
      setLiters(value);
      setAmount(cost);
      setLitersInput(value.toString());
      setAmountInput(cost.toString());
      setShowDropdown(false);
    }
  };

  const calculateFromAmount = (value) => {
    const literValue = value / PRICE_PER_LITER;
    if (literValue > tankRemaining) {
      alert(`Water not available! Only ${tankRemaining}L left.`);
      setLiters(0);
      setAmount(0);
      setLitersInput("");
      setAmountInput("");
    } else {
      setLiters(literValue);
      setAmount(value);
      setLitersInput(literValue.toString());
      setAmountInput(value.toString());
    }
  };

  const handlePayNow = async () => {
    if (!amount || !mobile || !liters) {
      alert("Enter amount, mobile number, and liters");
      return;
    }

    try {
      // 🔧 FIXED: All fetches now safe
      await safeFetch(`${API_URL}/tank/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: liters }),
      });

      const data = await safeFetch(`${API_URL}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          mobile,
          liters,
          tds,
        }),
      });

      // Update tank UI
      if (data.remaining != null) setTankRemaining(data.remaining);
      if (data.tds != null) setTds(data.tds);

      // Cashfree checkout
      const cashfree = await load({ mode: "sandbox" });
      cashfree.checkout({
        paymentSessionId: data.payment_session_id,
        redirectTarget: "_self",
        onSuccess: () => setTimeout(fetchTankSettings, 2000),
      });
    } catch (err) {
      console.error("Payment error:", err.message);
      alert(err.message || "Payment failed. Please try again.");
    }
  };

  // Rest of your JSX stays exactly the same...
  return (
    <div className="bg-blue-200 min-h-screen flex flex-col items-center justify-center p-4">
      <div className="flex flex-col md:flex-row gap-5 p-8 bg-white rounded-xl shadow-lg w-full max-w-4xl">
        {/* Tank Section */}
        <div className="w-full md:w-1/2 flex flex-col items-center">
          <p className="text-xl font-bold mb-4 text-blue-600">
            TDS: {tds} ppm
          </p>
          <WaterJar
            remaining={tankRemaining}
            tankCapacity={tankCapacity}
            label="Water Tank"
          />
        </div>

        {/* Form Section */}
        <div className="w-full md:w-1/2 p-6 bg-gray-100 rounded-lg">
          <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">
            Water Dispensation
          </h1>

          {/* Liters */}
          <div className="relative mb-4">
            <label className="block text-sm mb-1 font-semibold text-gray-700">Liters</label>
            <input
              placeholder="Select or type manually"
              type="number"
              value={litersInput}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setLitersInput(e.target.value);
                if (!isNaN(val)) calculateFromLiters(val);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              className="w-full border px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {showDropdown && (
              <ul className="absolute w-full bg-white border mt-1 rounded shadow-lg z-10 max-h-48 overflow-y-auto">
                {PRESET_LITERS.map((l) => (
                  <li
                    key={l}
                    className="px-3 py-2 hover:bg-blue-500 hover:text-white cursor-pointer border-b last:border-b-0"
                    onMouseDown={() => calculateFromLiters(l)}
                  >
                    {l} Liter
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Amount */}
          <div className="mb-4">
            <label className="block text-sm mb-1 font-semibold text-gray-700">Amount (₹)</label>
            <input
              placeholder="Enter amount"
              type="text"
              value={amountInput}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, "");
                setAmountInput(val);
                const num = parseFloat(val);
                if (!isNaN(num)) calculateFromAmount(num);
              }}
              className="w-full border px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Mobile */}
          <div className="mb-6">
            <label className="block text-sm mb-1 font-semibold text-gray-700">Mobile Number</label>
            <input
              placeholder="+91"
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="w-full border px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={handlePayNow}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-semibold transition duration-200 shadow-md hover:shadow-lg"
          >
            Pay Now
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
