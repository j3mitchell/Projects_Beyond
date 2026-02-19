// React hooks:
// useState = store data in the component
// useEffect = run code when component loads/changes
// useMemo = cache calculated values
import React, { useEffect, useMemo, useState } from "react";
// axios makes HTTP requests to our FastAPI backend.
import axios from "axios";
// CSS styles for this page.
import "./App.css";

// Backend URL for local development.
const API_BASE_URL = "http://127.0.0.1:8000";

function App() {
  // Current user role selected in the UI.
  const [role, setRole] = useState("Root");
  // If any API call fails, we show the message here.
  const [error, setError] = useState("");
  // Status message for quick "demo checks" button.
  const [demoCheckStatus, setDemoCheckStatus] = useState("");

  // Data used in dashboard cards and tables.
  const [dashboard, setDashboard] = useState(null);
  const [siteReport, setSiteReport] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [meals, setMeals] = useState([]);
  const [sites, setSites] = useState([]);
  const [clients, setClients] = useState([]);
  const [arrivals, setArrivals] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [deliveries, setDeliveries] = useState([]);

  // Form state for creating a new ingredient.
  const [ingredientForm, setIngredientForm] = useState({
    name: "",
    barcode: "",
    unit: "lb",
    quantity_on_hand: 0,
    reorder_level: 0,
    shelf_life_days: 30,
    expiration_date: "",
  });

  // Form state for logging an arrival scan by barcode.
  const [arrivalForm, setArrivalForm] = useState({
    barcode: "",
    quantity_received: 0,
    expiration_date: "",
    unit_cost: "",
  });

  // Form state for creating a meal + ingredient lines.
  const [mealForm, setMealForm] = useState({
    name: "",
    ingredients: [{ ingredient_id: "", quantity_per_serving: "" }],
  });

  // Form state for producing meal servings.
  const [productionForm, setProductionForm] = useState({ meal_id: "", servings: 1 });

  // Form state for creating purchase orders.
  const [poForm, setPoForm] = useState({
    supplier: "Default Supplier",
    items: [{ ingredient_id: "", quantity_ordered: "", unit_cost: "" }],
  });

  // Form state for recording deliveries to site/client.
  const [deliveryForm, setDeliveryForm] = useState({
    meal_id: "",
    site_id: "",
    client_id: "",
    quantity: 1,
  });

  // Send selected role to backend so backend can authorize the action.
  const headers = useMemo(() => ({ "X-Role": role }), [role]);

  // Small helper for GET requests.
  const apiGet = async (path) => axios.get(`${API_BASE_URL}${path}`, { headers });
  // Small helper for POST requests.
  const apiPost = async (path, payload) =>
    axios.post(`${API_BASE_URL}${path}`, payload, { headers });

  // Load all dashboard data in parallel for speed.
  const loadData = async () => {
    try {
      setError("");
      const [
        dashboardRes,
        siteReportRes,
        ingredientRes,
        mealRes,
        siteRes,
        clientRes,
        arrivalRes,
        lowRes,
        expiringRes,
        poRes,
        deliveryRes,
      ] = await Promise.all([
        apiGet("/reports/dashboard"),
        apiGet("/reports/site-deliveries"),
        apiGet("/ingredients"),
        apiGet("/meals"),
        apiGet("/sites"),
        apiGet("/clients"),
        apiGet("/arrivals"),
        apiGet("/inventory/low"),
        apiGet("/inventory/expiring?days=14"),
        apiGet("/purchase-orders"),
        apiGet("/deliveries"),
      ]);

      // Save all responses into component state.
      setDashboard(dashboardRes.data);
      setSiteReport(siteReportRes.data);
      setIngredients(ingredientRes.data);
      setMeals(mealRes.data);
      setSites(siteRes.data);
      setClients(clientRes.data);
      setArrivals(arrivalRes.data);
      setLowStock(lowRes.data);
      setExpiring(expiringRes.data);
      setPurchaseOrders(poRes.data);
      setDeliveries(deliveryRes.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to load dashboard data");
    }
  };

  // Button action: verify key backend endpoints are reachable and responsive.
  const runDemoChecks = async () => {
    const started = Date.now();
    try {
      setError("");
      setDemoCheckStatus("Running checks...");
      await Promise.all([
        apiGet("/"),
        apiGet("/reports/dashboard"),
        apiGet("/ingredients"),
        apiGet("/meals"),
        apiGet("/sites"),
      ]);
      const ms = Date.now() - started;
      setDemoCheckStatus(`All checks passed in ${ms} ms`);
      loadData();
    } catch (err) {
      setDemoCheckStatus("Checks failed");
      setError(err?.response?.data?.detail || "Failed demo checks");
    }
  };

  // Reload data when role changes (permissions can change responses).
  useEffect(() => {
    loadData();
  }, [role]);

  // Client dropdown depends on selected site.
  const visibleClients = useMemo(() => {
    if (!deliveryForm.site_id) return [];
    return clients.filter((client) => client.site_id === Number(deliveryForm.site_id));
  }, [clients, deliveryForm.site_id]);

  const addIngredient = async (e) => {
    // Prevent browser page refresh on form submit.
    e.preventDefault();
    try {
      // Convert text inputs to numbers where needed.
      await apiPost("/ingredients", {
        ...ingredientForm,
        quantity_on_hand: Number(ingredientForm.quantity_on_hand),
        reorder_level: Number(ingredientForm.reorder_level),
        shelf_life_days: Number(ingredientForm.shelf_life_days),
        expiration_date: ingredientForm.expiration_date || null,
      });
      setIngredientForm({
        // Reset form after success.
        name: "",
        barcode: "",
        unit: "lb",
        quantity_on_hand: 0,
        reorder_level: 0,
        shelf_life_days: 30,
        expiration_date: "",
      });
      // Refresh tables/cards.
      loadData();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to create ingredient");
    }
  };

  const scanArrival = async (e) => {
    e.preventDefault();
    try {
      // Sends barcode scan and quantity; backend updates inventory.
      await apiPost("/arrivals/scan", {
        barcode: arrivalForm.barcode,
        quantity_received: Number(arrivalForm.quantity_received),
        expiration_date: arrivalForm.expiration_date || null,
        unit_cost: arrivalForm.unit_cost ? Number(arrivalForm.unit_cost) : null,
      });
      setArrivalForm({ barcode: "", quantity_received: 0, expiration_date: "", unit_cost: "" });
      loadData();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to scan arrival");
    }
  };

  const addMealLine = () => {
    // Add another ingredient line to the meal recipe form.
    setMealForm((prev) => ({
      ...prev,
      ingredients: [...prev.ingredients, { ingredient_id: "", quantity_per_serving: "" }],
    }));
  };

  const updateMealLine = (index, key, value) => {
    // Update one specific row in the meal ingredient list.
    setMealForm((prev) => {
      const ingredientsCopy = [...prev.ingredients];
      ingredientsCopy[index] = { ...ingredientsCopy[index], [key]: value };
      return { ...prev, ingredients: ingredientsCopy };
    });
  };

  const createMeal = async (e) => {
    e.preventDefault();
    try {
      // Keep only complete lines, then convert IDs/quantities to numbers.
      await apiPost("/meals", {
        name: mealForm.name,
        ingredients: mealForm.ingredients
          .filter((line) => line.ingredient_id && line.quantity_per_serving)
          .map((line) => ({
            ingredient_id: Number(line.ingredient_id),
            quantity_per_serving: Number(line.quantity_per_serving),
          })),
      });
      setMealForm({ name: "", ingredients: [{ ingredient_id: "", quantity_per_serving: "" }] });
      loadData();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to create meal");
    }
  };

  const produceMeal = async (e) => {
    e.preventDefault();
    try {
      // Backend deducts ingredient inventory using meal recipe x servings.
      await apiPost("/meal-productions", {
        meal_id: Number(productionForm.meal_id),
        servings: Number(productionForm.servings),
      });
      setProductionForm({ meal_id: "", servings: 1 });
      loadData();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to record meal production");
    }
  };

  const addPoLine = () => {
    // Add another line to purchase order form.
    setPoForm((prev) => ({
      ...prev,
      items: [...prev.items, { ingredient_id: "", quantity_ordered: "", unit_cost: "" }],
    }));
  };

  const updatePoLine = (index, key, value) => {
    // Update one PO line by index.
    setPoForm((prev) => {
      const itemsCopy = [...prev.items];
      itemsCopy[index] = { ...itemsCopy[index], [key]: value };
      return { ...prev, items: itemsCopy };
    });
  };

  const autofillLowStockToPO = () => {
    // Build PO lines automatically from low stock table.
    const items = lowStock.map((ingredient) => ({
      ingredient_id: String(ingredient.id),
      quantity_ordered: String(Math.max(ingredient.reorder_level - ingredient.quantity_on_hand, 1)),
      unit_cost: "",
    }));
    if (items.length > 0) {
      setPoForm((prev) => ({ ...prev, items }));
    }
  };

  const createPO = async (e) => {
    e.preventDefault();
    try {
      // Create PO header + lines.
      await apiPost("/purchase-orders", {
        supplier: poForm.supplier,
        items: poForm.items
          .filter((line) => line.ingredient_id && line.quantity_ordered)
          .map((line) => ({
            ingredient_id: Number(line.ingredient_id),
            quantity_ordered: Number(line.quantity_ordered),
            unit_cost: line.unit_cost ? Number(line.unit_cost) : null,
          })),
      });
      setPoForm({
        supplier: "Default Supplier",
        items: [{ ingredient_id: "", quantity_ordered: "", unit_cost: "" }],
      });
      loadData();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to create purchase order");
    }
  };

  const createDelivery = async (e) => {
    e.preventDefault();
    try {
      // Record where prepared meals were delivered.
      await apiPost("/deliveries", {
        meal_id: Number(deliveryForm.meal_id),
        site_id: Number(deliveryForm.site_id),
        client_id: Number(deliveryForm.client_id),
        quantity: Number(deliveryForm.quantity),
      });
      setDeliveryForm({ meal_id: "", site_id: "", client_id: "", quantity: 1 });
      loadData();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to create delivery record");
    }
  };

  return (
    // Entire app dashboard container.
    <div className="app-shell">
      <header className="toolbar">
        <h1>Kitchen Food Inventory Dashboard</h1>
        <div className="toolbar-actions">
          {/* Role selector lets you test Root/Mgmt/Rep permissions */}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option>Root</option>
            <option>Mgmt</option>
            <option>Rep</option>
          </select>
          {/* Manual reload button */}
          <button onClick={loadData}>Refresh</button>
          {/* One-click API health check for live demos */}
          <button onClick={runDemoChecks}>Run Demo Checks</button>
        </div>
      </header>

      {/* Show any backend/API error */}
      {error ? <p className="error">{error}</p> : null}
      {demoCheckStatus ? <p>{demoCheckStatus}</p> : null}

      {/* Top summary cards */}
      {dashboard && (
        <section className="card-grid stats">
          <article className="card">Ingredients: {dashboard.total_ingredients}</article>
          <article className="card">Meals: {dashboard.total_meals}</article>
          <article className="card">Clients: {dashboard.total_clients}</article>
          <article className="card">Sites: {dashboard.total_sites}</article>
          <article className="card">Open POs: {dashboard.open_purchase_orders}</article>
          <article className="card">Low Stock: {dashboard.low_stock_count}</article>
        </section>
      )}

      {/* Ingredient creation + arrival scanning */}
      <section className="card-grid two">
        <article className="card">
          <h2>Add Ingredient</h2>
          <form onSubmit={addIngredient} className="form-grid">
            <input placeholder="Name" value={ingredientForm.name} onChange={(e) => setIngredientForm({ ...ingredientForm, name: e.target.value })} />
            <input placeholder="Barcode" value={ingredientForm.barcode} onChange={(e) => setIngredientForm({ ...ingredientForm, barcode: e.target.value })} />
            <input placeholder="Unit" value={ingredientForm.unit} onChange={(e) => setIngredientForm({ ...ingredientForm, unit: e.target.value })} />
            <input type="number" step="0.01" placeholder="Qty On Hand" value={ingredientForm.quantity_on_hand} onChange={(e) => setIngredientForm({ ...ingredientForm, quantity_on_hand: e.target.value })} />
            <input type="number" step="0.01" placeholder="Reorder Level" value={ingredientForm.reorder_level} onChange={(e) => setIngredientForm({ ...ingredientForm, reorder_level: e.target.value })} />
            <input type="number" placeholder="Shelf Life (days)" value={ingredientForm.shelf_life_days} onChange={(e) => setIngredientForm({ ...ingredientForm, shelf_life_days: e.target.value })} />
            <input type="date" value={ingredientForm.expiration_date} onChange={(e) => setIngredientForm({ ...ingredientForm, expiration_date: e.target.value })} />
            <button type="submit">Create Ingredient</button>
          </form>
        </article>

        <article className="card">
          <h2>Scan Arrival</h2>
          <form onSubmit={scanArrival} className="form-grid">
            <input placeholder="Barcode" value={arrivalForm.barcode} onChange={(e) => setArrivalForm({ ...arrivalForm, barcode: e.target.value })} />
            <input type="number" step="0.01" placeholder="Quantity Received" value={arrivalForm.quantity_received} onChange={(e) => setArrivalForm({ ...arrivalForm, quantity_received: e.target.value })} />
            <input type="date" value={arrivalForm.expiration_date} onChange={(e) => setArrivalForm({ ...arrivalForm, expiration_date: e.target.value })} />
            <input type="number" step="0.01" placeholder="Unit Cost" value={arrivalForm.unit_cost} onChange={(e) => setArrivalForm({ ...arrivalForm, unit_cost: e.target.value })} />
            <button type="submit">Record Arrival</button>
          </form>
        </article>
      </section>

      {/* Meal recipe creation + meal production logging */}
      <section className="card-grid two">
        <article className="card">
          <h2>Create Meal + Ingredients</h2>
          <form onSubmit={createMeal} className="form-grid">
            <input placeholder="Meal Name" value={mealForm.name} onChange={(e) => setMealForm({ ...mealForm, name: e.target.value })} />
            {mealForm.ingredients.map((line, index) => (
              <div className="line" key={index}>
                <select value={line.ingredient_id} onChange={(e) => updateMealLine(index, "ingredient_id", e.target.value)}>
                  <option value="">Ingredient</option>
                  {ingredients.map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {ingredient.name}
                    </option>
                  ))}
                </select>
                <input type="number" step="0.01" placeholder="Qty per serving" value={line.quantity_per_serving} onChange={(e) => updateMealLine(index, "quantity_per_serving", e.target.value)} />
              </div>
            ))}
            <button type="button" onClick={addMealLine}>Add Ingredient Line</button>
            <button type="submit">Create Meal</button>
          </form>
        </article>

        <article className="card">
          <h2>Record Meal Production</h2>
          <form onSubmit={produceMeal} className="form-grid">
            <select value={productionForm.meal_id} onChange={(e) => setProductionForm({ ...productionForm, meal_id: e.target.value })}>
              <option value="">Select Meal</option>
              {meals.map((meal) => (
                <option key={meal.id} value={meal.id}>{meal.name}</option>
              ))}
            </select>
            <input type="number" min="1" value={productionForm.servings} onChange={(e) => setProductionForm({ ...productionForm, servings: e.target.value })} />
            <button type="submit">Produce</button>
          </form>
        </article>
      </section>

      {/* Purchase order creation + delivery logging */}
      <section className="card-grid two">
        <article className="card">
          <h2>Create Purchase Order</h2>
          <form onSubmit={createPO} className="form-grid">
            <input value={poForm.supplier} onChange={(e) => setPoForm({ ...poForm, supplier: e.target.value })} placeholder="Supplier" />
            {poForm.items.map((line, index) => (
              <div className="line" key={index}>
                <select value={line.ingredient_id} onChange={(e) => updatePoLine(index, "ingredient_id", e.target.value)}>
                  <option value="">Ingredient</option>
                  {ingredients.map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>
                  ))}
                </select>
                <input type="number" step="0.01" placeholder="Qty" value={line.quantity_ordered} onChange={(e) => updatePoLine(index, "quantity_ordered", e.target.value)} />
                <input type="number" step="0.01" placeholder="Unit Cost" value={line.unit_cost} onChange={(e) => updatePoLine(index, "unit_cost", e.target.value)} />
              </div>
            ))}
            <button type="button" onClick={addPoLine}>Add PO Line</button>
            <button type="button" onClick={autofillLowStockToPO}>Autofill from Low Stock</button>
            <button type="submit">Create PO</button>
          </form>
        </article>

        <article className="card">
          <h2>Record Delivery</h2>
          <form onSubmit={createDelivery} className="form-grid">
            <select value={deliveryForm.meal_id} onChange={(e) => setDeliveryForm({ ...deliveryForm, meal_id: e.target.value })}>
              <option value="">Meal</option>
              {meals.map((meal) => (
                <option key={meal.id} value={meal.id}>{meal.name}</option>
              ))}
            </select>
            <select value={deliveryForm.site_id} onChange={(e) => setDeliveryForm({ ...deliveryForm, site_id: e.target.value, client_id: "" })}>
              <option value="">Site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>
            <select value={deliveryForm.client_id} onChange={(e) => setDeliveryForm({ ...deliveryForm, client_id: e.target.value })}>
              <option value="">Client</option>
              {visibleClients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
            <input type="number" min="1" value={deliveryForm.quantity} onChange={(e) => setDeliveryForm({ ...deliveryForm, quantity: e.target.value })} />
            <button type="submit">Log Delivery</button>
          </form>
        </article>
      </section>

      {/* Alerts: low stock and expiring ingredients */}
      <section className="card-grid two">
        <article className="card table-wrap">
          <h2>Low Inventory (Need to Order)</h2>
          <table>
            <thead><tr><th>Ingredient</th><th>On Hand</th><th>Reorder</th></tr></thead>
            <tbody>
              {lowStock.map((item) => (
                <tr key={item.id}><td>{item.name}</td><td>{item.quantity_on_hand}</td><td>{item.reorder_level}</td></tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card table-wrap">
          <h2>Expiring Soon (14 days)</h2>
          <table>
            <thead><tr><th>Ingredient</th><th>Expiry</th></tr></thead>
            <tbody>
              {expiring.map((item) => (
                <tr key={item.id}><td>{item.name}</td><td>{item.expiration_date || "-"}</td></tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      {/* Operational logs: purchase orders and arrivals */}
      <section className="card-grid two">
        <article className="card table-wrap">
          <h2>Purchase Orders</h2>
          <table>
            <thead><tr><th>ID</th><th>Supplier</th><th>Status</th><th>Items</th></tr></thead>
            <tbody>
              {purchaseOrders.map((po) => (
                <tr key={po.id}><td>{po.id}</td><td>{po.supplier}</td><td>{po.status}</td><td>{po.items.length}</td></tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card table-wrap">
          <h2>Arrivals</h2>
          <table>
            <thead><tr><th>Ingredient</th><th>Qty</th><th>When</th></tr></thead>
            <tbody>
              {arrivals.slice(0, 10).map((arrival) => (
                <tr key={arrival.id}><td>{arrival.ingredient_name}</td><td>{arrival.quantity_received}</td><td>{new Date(arrival.arrived_at).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      {/* Distribution logs + per-site report */}
      <section className="card-grid two">
        <article className="card table-wrap">
          <h2>Deliveries</h2>
          <table>
            <thead><tr><th>Meal</th><th>Site</th><th>Client</th><th>Qty</th></tr></thead>
            <tbody>
              {deliveries.slice(0, 15).map((delivery) => (
                <tr key={delivery.id}><td>{delivery.meal_name}</td><td>{delivery.site_name}</td><td>{delivery.client_name}</td><td>{delivery.quantity}</td></tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card table-wrap">
          <h2>Site Delivery Report</h2>
          <table>
            <thead><tr><th>Site</th><th>Meals Delivered</th><th>Clients Served</th></tr></thead>
            <tbody>
              {siteReport.map((row) => (
                <tr key={row.site_id}><td>{row.site_name}</td><td>{row.meals_delivered}</td><td>{row.clients_served}</td></tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>
    </div>
  );
}

export default App;
