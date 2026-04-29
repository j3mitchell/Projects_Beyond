// React lets us build UI components.
// useState stores values; useEffect runs code after render.
import React, { useState, useEffect } from "react";
// axios sends HTTP requests to our backend API.
import axios from "axios";

// Base URL for the FastAPI backend running locally.
const API_BASE_URL = "http://127.0.0.1:8000";

// Inventory component: lets user view and add inventory items.
export default function Inventory() {
  // inventory = array of items loaded from backend.
  const [inventory, setInventory] = useState([]);
  // itemName = text typed into item name box.
  const [itemName, setItemName] = useState("");
  // quantity = number typed into quantity box.
  const [quantity, setQuantity] = useState(0);

  // Load current inventory from backend.
  const fetchInventory = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/inventory`);
      setInventory(res.data);
    } catch (err) {
      // Show useful debug info in browser console.
      console.error("Error fetching inventory:", err);
      alert("Failed to fetch inventory. See console for details.");
    }
  };

  // Create a new inventory item in backend.
  const addItem = async () => {
    try {
      // Basic form checks before sending request.
      if (!itemName) return alert("Please enter an item name");
      if (quantity <= 0) return alert("Quantity must be greater than zero");

      await axios.post(`${API_BASE_URL}/inventory`, {
        name: itemName,
        quantity: quantity,
      });

      // Clear form after successful save.
      setItemName("");
      setQuantity(0);
      // Reload list so new item appears immediately.
      fetchInventory();
    } catch (err) {
      console.error("Error adding inventory item:", err);
      alert("Failed to add item. See console for details.");
    }
  };

  // Run once when component first loads.
  useEffect(() => {
    fetchInventory();
  }, []);

  return (
    <div>
      <h2>Inventory</h2>

      {/* Input for inventory item name */}
      <input
        type="text"
        placeholder="Item Name"
        value={itemName}
        onChange={(e) => setItemName(e.target.value)}
      />

      {/* Input for inventory quantity */}
      <input
        type="number"
        placeholder="Quantity"
        value={quantity}
        onChange={(e) => setQuantity(parseInt(e.target.value, 10))}
      />

      {/* Button to submit new item */}
      <button onClick={addItem}>Add Item</button>

      {/* Render each inventory item in a list */}
      <ul>
        {inventory.map((item) => (
          <li key={item.id}>
            {item.name} - {item.quantity}
          </li>
        ))}
      </ul>
    </div>
  );
}
