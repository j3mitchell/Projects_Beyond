// React component tools.
import React, { useState, useEffect } from "react";
// axios for API requests.
import axios from "axios";

// Backend URL for local FastAPI server.
const API_BASE_URL = "http://127.0.0.1:8000";

// Meals component: view meals and create new meal names.
export default function Meals() {
  // meals = list returned by backend.
  const [meals, setMeals] = useState([]);
  // name = text input for new meal name.
  const [name, setName] = useState("");

  // Request all meals from backend.
  const fetchMeals = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/meals`);
      setMeals(res.data);
    } catch (err) {
      console.error("Error fetching meals:", err);
      alert("Failed to fetch meals. See console for details.");
    }
  };

  // Send new meal to backend.
  const addMeal = async () => {
    try {
      if (!name) return alert("Please enter a meal name");

      // This demo sends an empty ingredients array for a simple meal create.
      await axios.post(`${API_BASE_URL}/meals`, { name, ingredients: [] });

      // Reset input after save.
      setName("");
      // Refresh list so user sees the new meal.
      fetchMeals();
    } catch (err) {
      console.error("Error adding meal:", err);
      alert("Failed to add meal. See console for details.");
    }
  };

  // Load meal list when component opens.
  useEffect(() => {
    fetchMeals();
  }, []);

  return (
    <div>
      <h2>Meals</h2>

      {/* New meal name input */}
      <input
        type="text"
        placeholder="Meal Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {/* Save meal button */}
      <button onClick={addMeal}>Add Meal</button>

      {/* Show existing meals */}
      <ul>
        {meals.map((meal) => (
          <li key={meal.id}>
            {meal.name} ({meal.ingredients.length} ingredients)
          </li>
        ))}
      </ul>
    </div>
  );
}
