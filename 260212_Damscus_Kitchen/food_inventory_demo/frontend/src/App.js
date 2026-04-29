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

const DATASET_KEYS = [
  "measurement_units",
  "cost_units",
  "unit_cost_options",
  "suppliers",
  "brands",
  "order_statuses",
  "food_restrictions",
  "meal_types",
];

function App() {
  // Current user role selected in the UI.
  const [role, setRole] = useState("Root");
  // If any API call fails, we show the message here.
  const [error, setError] = useState("");
  // Status message and progress for demo checks.
  const [demoCheckStatus, setDemoCheckStatus] = useState("Idle");
  const [demoCheckProgress, setDemoCheckProgress] = useState(0);

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
  const [demoTime, setDemoTime] = useState(null);
  const [ingredientCategories, setIngredientCategories] = useState([]);

  // Dropdown datasets loaded from backend.
  const [datasets, setDatasets] = useState({});

  // Expiring filter controls (days/months + demo clock mode).
  const [expiringIncrementType, setExpiringIncrementType] = useState("days");
  const [expiringIncrementValue, setExpiringIncrementValue] = useState(14);
  const [demoClock, setDemoClock] = useState(true);

  // Form state for creating a new ingredient.
  const [ingredientForm, setIngredientForm] = useState({
    name: "",
    category: "",
    barcode: "",
    unit: "lb",
    quantity_on_hand: "",
    reorder_level: "",
    shelf_life_days: "",
    expiration_date: "",
    default_unit_cost: "",
    cost_unit: "lb",
  });

  // Form state for logging an arrival scan by barcode.
  const [arrivalForm, setArrivalForm] = useState({
    barcode: "",
    quantity_received: 0,
    expiration_date: "",
    unit_cost: "",
    cost_unit: "lb",
  });

  // Form state for creating a meal + ingredient lines.
  const [mealForm, setMealForm] = useState({
    name: "",
    meal_type: "Lunch",
    restriction_ids: [],
    ingredients: [{ ingredient_id: "", quantity_per_serving: "" }],
  });

  // Form state for producing meal servings.
  const [productionForm, setProductionForm] = useState({ meal_id: "", servings: 1 });

  // Form state for creating purchase orders.
  const [poForm, setPoForm] = useState({
    supplier: "",
    status: "",
    items: [{ brand_name: "Brand", ingredient_id: "", quantity_ordered: "", unit_cost: "", cost_unit: "lb" }],
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

  const toErrorMessage = (err, fallback) => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((item) => item?.msg || (typeof item === "string" ? item : null))
        .filter(Boolean);
      if (msgs.length) return msgs.join(" | ");
    }
    if (detail && typeof detail === "object") {
      if (typeof detail.msg === "string") return detail.msg;
      try {
        return JSON.stringify(detail);
      } catch {
        return fallback;
      }
    }
    return fallback;
  };

  const getDatasetLabels = (key) => (datasets[key] || []).map((item) => item.label);

  const loadDatasets = async () => {
    const requests = DATASET_KEYS.map((key) => apiGet(`/datasets/${key}`));
    const responses = await Promise.all([...requests, apiGet("/ingredient-categories")]);
    const next = {};
    responses.forEach((res, index) => {
      if (index < DATASET_KEYS.length) {
        next[DATASET_KEYS[index]] = res.data;
      }
    });
    setDatasets(next);
    setIngredientCategories(responses[responses.length - 1].data || []);
  };

  // Keep category selection valid after category list loads/changes.
  useEffect(() => {
    if (!ingredientCategories.length) return;
    const ids = ingredientCategories.map((category) => String(category.id));
    if (!ids.includes(String(ingredientForm.category))) {
      setIngredientForm((prev) => ({ ...prev, category: ids[0] }));
    }
  }, [ingredientCategories]);

  // Keep derived barcode in sync with ingredient name.
  useEffect(() => {
    setIngredientForm((prev) => {
      const nextBarcode = buildDefaultBarcode(prev.name);
      if (prev.barcode === nextBarcode) return prev;
      return { ...prev, barcode: nextBarcode };
    });
  }, [ingredientForm.name, ingredients]);

  // Add custom option to a dataset and return label.
  const addCustomDatasetOption = async (datasetKey, label) => {
    const trimmed = (label || "").trim();
    if (!trimmed) return null;
    await apiPost(`/datasets/${datasetKey}`, { label: trimmed, value: trimmed });
    await loadDatasets();
    return trimmed;
  };

  // Shared handler for dropdowns with a custom item option.
  const resolveDropdownValue = async (datasetKey, value) => {
    if (value !== "__custom__") return value;
    const custom = window.prompt(`Add custom option for ${datasetKey}:`);
    if (!custom) return "";
    return addCustomDatasetOption(datasetKey, custom);
  };

  const resolveIngredientCategoryValue = async (value) => {
    if (value !== "__custom__") return value;
    const custom = window.prompt("Add custom ingredient category:");
    const trimmed = (custom || "").trim();
    if (!trimmed) return "";
    const response = await apiPost("/ingredient-categories", { name: trimmed });
    await loadDatasets();
    return response?.data?.id ? String(response.data.id) : "";
  };

  const ensureUndefinedIngredientCategoryId = async () => {
    const existing = (ingredientCategories || []).find(
      (row) => String(row?.name || "").trim().toLowerCase() === "undefined"
    );
    if (existing?.id) return String(existing.id);
    const response = await apiPost("/ingredient-categories", { name: "undefined" });
    await loadDatasets();
    return response?.data?.id ? String(response.data.id) : "";
  };

  const parseCurrencyValue = (raw) => {
    const cleaned = String(raw ?? "").replace(/[^0-9.-]/g, "");
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : NaN;
  };

  const formatCurrencyValue = (raw) => {
    const num = parseCurrencyValue(raw);
    if (!Number.isFinite(num)) return "";
    return `$ ${num.toFixed(2)}`;
  };

  const normalizeUnitCostOption = (raw) => {
    const num = parseCurrencyValue(raw);
    if (!Number.isFinite(num)) return "";
    return num.toFixed(2);
  };

  const nextBarcodeSequence = (prefix) => {
    const seqs = ingredients
      .map((row) => {
        const code = String(row?.barcode || "");
        if (!code.startsWith(`${prefix}-`)) return 0;
        const parts = code.split("-");
        if (parts.length < 2) return 0;
        const n = Number(parts[parts.length - 1]);
        return Number.isFinite(n) ? n : 0;
      })
      .filter((n) => n > 0);
    const maxSeq = seqs.length ? Math.max(...seqs) : 0;
    return String(maxSeq + 1).padStart(3, "0");
  };

  const buildDefaultBarcode = (name) => {
    const cleaned = String(name || "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
    const prefix = (cleaned.slice(0, 4) || "").padEnd(4, "_");
    return `${prefix}-${nextBarcodeSequence(prefix)}`;
  };

  const persistUnitCostOption = async (value) => {
    const trimmed = normalizeUnitCostOption(value);
    if (!trimmed) return;
    if (!["Root", "Mgmt"].includes(role)) return;
    const exists = getDatasetLabels("unit_cost_options").some(
      (item) => normalizeUnitCostOption(item) === trimmed
    );
    if (exists) return;
    try {
      await addCustomDatasetOption("unit_cost_options", trimmed);
    } catch (err) {
      // Keep typed value usable even if saving custom option fails.
      console.warn("Unable to persist unit cost option", err);
    }
  };

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
        demoTimeRes,
      ] = await Promise.all([
        apiGet("/reports/dashboard"),
        apiGet("/reports/site-deliveries"),
        apiGet("/ingredients"),
        apiGet("/meals"),
        apiGet("/sites"),
        apiGet("/clients"),
        apiGet("/arrivals"),
        apiGet("/inventory/low"),
        apiGet(
          `/inventory/expiring?increment_type=${expiringIncrementType}&increment_value=${expiringIncrementValue}&demo_clock=${demoClock}`
        ),
        apiGet("/purchase-orders"),
        apiGet("/deliveries"),
        apiGet("/demo/time"),
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
      setDemoTime(demoTimeRes.data);
    } catch (err) {
      setError(toErrorMessage(err, "Failed to load dashboard data"));
    }
  };

  // Button action: verify key backend endpoints are reachable and responsive.
  const runDemoChecks = async () => {
    const steps = [
      { label: "Preparing demo dataset", call: () => apiGet("/demo/bootstrap") },
      { label: "Checking backend health", call: () => apiGet("/") },
      { label: "Checking dashboard API", call: () => apiGet("/reports/dashboard") },
      { label: "Checking ingredients API", call: () => apiGet("/ingredients") },
      { label: "Checking sites/clients API", call: () => apiGet("/sites") },
      { label: "Checking meals API", call: () => apiGet("/meals") },
    ];

    try {
      setError("");
      setDemoCheckProgress(0);
      setDemoCheckStatus("Starting demo checks...");

      for (let i = 0; i < steps.length; i += 1) {
        setDemoCheckStatus(steps[i].label);
        await steps[i].call();
        setDemoCheckProgress(Math.round(((i + 1) / steps.length) * 100));
      }

      setDemoCheckStatus("All demo checks passed. App is ready.");
      await loadDatasets();
      await loadData();
    } catch (err) {
      setDemoCheckStatus("Demo checks failed.");
      setError(toErrorMessage(err, "Failed demo checks"));
    }
  };

  // Reload data when role or expiry controls change.
  useEffect(() => {
    (async () => {
      await loadDatasets();
      await loadData();
    })();
  }, [role, expiringIncrementType, expiringIncrementValue, demoClock]);

  // Client dropdown depends on selected site.
  const visibleClients = useMemo(() => {
    if (!deliveryForm.site_id) return [];
    return clients.filter((client) => client.site_id === Number(deliveryForm.site_id));
  }, [clients, deliveryForm.site_id]);

  const addIngredient = async (e) => {
    // Prevent browser page refresh on form submit.
    e.preventDefault();
    const buildIngredientPayload = (nameOverride = null) => ({
      ...ingredientForm,
      ...(nameOverride ? { name: nameOverride } : {}),
      ...(Number.isFinite(parseCurrencyValue(ingredientForm.default_unit_cost))
        ? { default_unit_cost: parseCurrencyValue(ingredientForm.default_unit_cost) }
        : { default_unit_cost: null }),
      quantity_on_hand: Number(ingredientForm.quantity_on_hand || 0),
      reorder_level: Number(ingredientForm.reorder_level || 0),
      shelf_life_days: ingredientForm.shelf_life_days ? Number(ingredientForm.shelf_life_days) : null,
      expiration_date: ingredientForm.expiration_date || null,
    });

    try {
      setError("");
      if (ingredientForm.default_unit_cost) {
        await persistUnitCostOption(ingredientForm.default_unit_cost);
      }
      await apiPost("/ingredients", buildIngredientPayload());

      // Reset form after success.
      setIngredientForm({
        name: "",
        category: ingredientCategories.length ? String(ingredientCategories[0].id) : "",
        barcode: "",
        unit: "lb",
        quantity_on_hand: "",
        reorder_level: "",
        shelf_life_days: "",
        expiration_date: "",
        default_unit_cost: "",
        cost_unit: "lb",
      });
      setError("");
      // Refresh tables/cards.
      loadData();
    } catch (err) {
      const detail = err?.response?.data?.detail || "";
      if (err?.response?.status === 409 && String(detail).includes("Ingredient name already exists")) {
        const overwrite = window.confirm(
          "Ingredient name already exists. Click OK to overwrite existing ingredient, or Cancel to create a new name."
        );
        try {
          if (overwrite) {
            await apiPost("/ingredients?overwrite=true", buildIngredientPayload());
          } else {
            const newName = window.prompt("Enter a different ingredient name:", `${ingredientForm.name} Copy`);
            const trimmed = (newName || "").trim();
            if (!trimmed) {
          setError("Create canceled. Enter a new name to save as a separate ingredient.");
          return;
            }
            await apiPost("/ingredients", buildIngredientPayload(trimmed));
            setIngredientForm((prev) => ({ ...prev, name: trimmed }));
          }
          setError("");
          loadData();
          return;
        } catch (retryErr) {
          setError(toErrorMessage(retryErr, "Failed to create ingredient"));
          return;
        }
      }
      setError(toErrorMessage(err, "Failed to create ingredient"));
    }
  };

  const scanArrival = async (e) => {
    e.preventDefault();
    try {
      if (arrivalForm.unit_cost) {
        await persistUnitCostOption(arrivalForm.unit_cost);
      }
      // Sends barcode scan and quantity; backend updates inventory.
      const arrivalUnitCost = parseCurrencyValue(arrivalForm.unit_cost);
      await apiPost("/arrivals/scan", {
        barcode: arrivalForm.barcode,
        quantity_received: Number(arrivalForm.quantity_received),
        expiration_date: arrivalForm.expiration_date || null,
        unit_cost: Number.isFinite(arrivalUnitCost) ? arrivalUnitCost : null,
        cost_unit: arrivalForm.cost_unit || null,
      });
      setArrivalForm({
        barcode: "",
        quantity_received: 0,
        expiration_date: "",
        unit_cost: "",
        cost_unit: "lb",
      });
      loadData();
    } catch (err) {
      setError(toErrorMessage(err, "Failed to scan arrival"));
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

  const onMealIngredientSelect = async (index, value) => {
    if (value !== "__custom__") {
      updateMealLine(index, "ingredient_id", value);
      return;
    }
    const customName = window.prompt("Enter custom ingredient name:");
    const trimmed = (customName || "").trim();
    if (!trimmed) {
      updateMealLine(index, "ingredient_id", "");
      return;
    }

    let nextCategory = ingredientForm.category;
    if (!nextCategory) {
      try {
        nextCategory = await ensureUndefinedIngredientCategoryId();
      } catch {
        nextCategory = "";
      }
    }

    setIngredientForm((prev) => ({
      ...prev,
      name: trimmed,
      category: prev.category || nextCategory,
    }));
    updateMealLine(index, "ingredient_id", "");
    const addIngredientCard = document.querySelector(".ingredient-grid");
    if (addIngredientCard?.scrollIntoView) {
      addIngredientCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const onPoIngredientSelect = async (index, value) => {
    if (value !== "__custom__") {
      updatePoLine(index, "ingredient_id", value);
      return;
    }
    const customName = window.prompt("Enter custom ingredient name:");
    const trimmed = (customName || "").trim();
    if (!trimmed) {
      updatePoLine(index, "ingredient_id", "");
      return;
    }

    let nextCategory = ingredientForm.category;
    if (!nextCategory) {
      try {
        nextCategory = await ensureUndefinedIngredientCategoryId();
      } catch {
        nextCategory = "";
      }
    }

    setIngredientForm((prev) => ({
      ...prev,
      name: trimmed,
      category: prev.category || nextCategory,
    }));
    updatePoLine(index, "ingredient_id", "");
    const addIngredientCard = document.querySelector(".ingredient-grid");
    if (addIngredientCard?.scrollIntoView) {
      addIngredientCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const onPoBrandSelect = async (index, value) => {
    if (value !== "__custom__") {
      updatePoLine(index, "brand_name", value);
      return;
    }
    const custom = window.prompt("Add custom option for brands:");
    const trimmed = (custom || "").trim();
    if (!trimmed) return;
    try {
      await addCustomDatasetOption("brands", trimmed);
      updatePoLine(index, "brand_name", trimmed);
    } catch (err) {
      setError(toErrorMessage(err, "Failed to add custom brand"));
    }
  };

  const createMeal = async (e) => {
    e.preventDefault();
    try {
      // Keep only complete lines, then convert IDs/quantities to numbers.
      const preparedLines = mealForm.ingredients
        .filter((line) => line.ingredient_id && line.quantity_per_serving)
        .map((line) => ({
          ingredient_id: Number(line.ingredient_id),
          quantity_per_serving: Number(line.quantity_per_serving),
        }));
      if (preparedLines.length === 0) {
        setError("Add at least one ingredient line before creating the meal.");
        return;
      }
      await apiPost("/meals", {
        name: mealForm.name,
        meal_type: mealForm.meal_type,
        restriction:
          mealForm.restriction_ids.length > 0
            ? mealForm.restriction_ids.join(",")
            : "01",
        ingredients: preparedLines,
      });
      setMealForm({
        name: "",
        meal_type: "Lunch",
        restriction_ids: [],
        ingredients: [{ ingredient_id: "", quantity_per_serving: "" }],
      });
      loadData();
    } catch (err) {
      setError(toErrorMessage(err, "Failed to create meal"));
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
      setError(toErrorMessage(err, "Failed to record meal production"));
    }
  };

  const addPoLine = () => {
    // Add another line to purchase order form.
    setPoForm((prev) => ({
        ...prev,
        items: [
          ...prev.items,
          { brand_name: "Brand", ingredient_id: "", quantity_ordered: "", unit_cost: "", cost_unit: "lb" },
        ],
      }));
  };

  const updatePoLine = (index, key, value) => {
    // Update one PO line by index.
    setPoForm((prev) => {
      const itemsCopy = [...prev.items];
      const nextLine = { ...itemsCopy[index], [key]: value };
      if (key === "ingredient_id") {
        const normalizedId =
          value === "" || Number.isNaN(Number(value)) ? String(value) : String(Number(value));
        nextLine.ingredient_id = normalizedId;
        const ingredient = ingredients.find((row) => String(Number(row.id)) === normalizedId);
        if (ingredient?.unit) {
          nextLine.cost_unit = ingredient.unit;
        }
        nextLine.brand_name = String(ingredient?.brand_name || nextLine.brand_name || "Brand");
      }
      itemsCopy[index] = nextLine;
      return { ...prev, items: itemsCopy };
    });
  };

  const autofillLowStockToPO = () => {
    // Build PO lines automatically from low stock table.
    const items = lowStock.map((ingredient) => ({
      brand_name: String(ingredient.brand_name || "Brand"),
      ingredient_id: String(ingredient.id),
      quantity_ordered: String(Math.max(ingredient.reorder_level - ingredient.quantity_on_hand, 1)),
      unit_cost: ingredient.default_unit_cost ? formatCurrencyValue(ingredient.default_unit_cost) : "",
      cost_unit: ingredient.unit || "lb",
    }));
    if (items.length > 0) {
      setPoForm((prev) => ({ ...prev, items }));
    }
  };

  const createPO = async (e) => {
    e.preventDefault();
    try {
      if (!poForm.supplier) {
        setError("Select a supplier before creating a purchase order.");
        return;
      }
      const newUnitCosts = [...new Set(poForm.items.map((line) => (line.unit_cost || "").trim()).filter(Boolean))];
      for (const value of newUnitCosts) {
        await persistUnitCostOption(value);
      }
      // Create PO header + lines.
      await apiPost("/purchase-orders", {
        supplier: poForm.supplier,
        po_status: poForm.status || "Draft",
        items: poForm.items
          .filter((line) => line.ingredient_id && line.quantity_ordered)
          .map((line) => {
            const unitCost = parseCurrencyValue(line.unit_cost);
            return {
              ingredient_id: Number(line.ingredient_id),
              quantity_ordered: Number(line.quantity_ordered),
              unit_cost: Number.isFinite(unitCost) ? unitCost : null,
              cost_unit: line.cost_unit || null,
            };
          }),
      });
      setPoForm({
        supplier: "",
        status: "",
        items: [{ brand_name: "Brand", ingredient_id: "", quantity_ordered: "", unit_cost: "", cost_unit: "lb" }],
      });
      loadData();
    } catch (err) {
      setError(toErrorMessage(err, "Failed to create purchase order"));
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
      setError(toErrorMessage(err, "Failed to create delivery record"));
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
          <button onClick={runDemoChecks}>Start Demo</button>
        </div>
      </header>

      {/* Progress bar for demo checks */}
      <section className="card">
        <h3>Demo Readiness</h3>
        <div className="progress-wrap">
          <div className="progress-fill" style={{ width: `${demoCheckProgress}%` }} />
        </div>
        <p>{demoCheckStatus}</p>
        {demoTime ? (
          <p>
            Demo clock: Day {demoTime.demo_days_elapsed} | Demo date: {demoTime.demo_date}
          </p>
        ) : null}
      </section>

      {/* Show any backend/API error */}
      {error ? <p className="error">{error}</p> : null}

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
          <form onSubmit={addIngredient} className="form-grid ingredient-grid">
            <input
              className="field-name"
              placeholder="Name"
              title="Ingredient name."
              value={ingredientForm.name}
              onChange={(e) => setIngredientForm({ ...ingredientForm, name: e.target.value })}
            />
            <select
              className="field-category"
              title="Ingredient category."
              value={ingredientForm.category}
              onChange={async (e) => {
                const value = await resolveIngredientCategoryValue(e.target.value);
                if (value) setIngredientForm({ ...ingredientForm, category: value });
              }}
            >
              <option value="__custom__">+ Add custom category</option>
              {ingredientCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <input
              className="field-barcode"
              placeholder="Barcode"
              title="Ingredient barcode identifier."
              value={ingredientForm.barcode}
              onChange={(e) => setIngredientForm({ ...ingredientForm, barcode: e.target.value })}
            />
            <input
              className="field-amount"
              type="number"
              step="0.01"
              placeholder="Quantity"
              title="Current quantity available in inventory."
              value={ingredientForm.quantity_on_hand}
              onChange={(e) =>
                setIngredientForm({ ...ingredientForm, quantity_on_hand: e.target.value })
              }
            />
            <select
              className="field-unit"
              title="Ingredient unit of measure (for example: lb, oz, count)."
              value={ingredientForm.unit}
              onChange={async (e) => {
                const value = await resolveDropdownValue("measurement_units", e.target.value);
                if (value) setIngredientForm({ ...ingredientForm, unit: value, cost_unit: value });
              }}
            >
              <option value="__custom__">+ Add custom unit</option>
              {getDatasetLabels("measurement_units").map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <input
              className="field-unit-cost"
              type="text"
              inputMode="decimal"
              placeholder="Avg Unit Cost"
              title="Average dollar cost per unit. Example: $4.50 for 1 lb."
              value={ingredientForm.default_unit_cost}
              list="unit-cost-options-list"
              onChange={(e) => {
                setIngredientForm({ ...ingredientForm, default_unit_cost: e.target.value });
              }}
              onBlur={async (e) => {
                setIngredientForm((prev) => ({
                  ...prev,
                  default_unit_cost: formatCurrencyValue(e.target.value),
                }));
                await persistUnitCostOption(e.target.value);
              }}
            />
            <select
              className="field-cost-unit"
              title="Unit that the unit cost applies to (cost per this unit)."
              value={ingredientForm.cost_unit || ""}
              onChange={async (e) => {
                const value = await resolveDropdownValue("measurement_units", e.target.value);
                if (value) setIngredientForm({ ...ingredientForm, cost_unit: value });
              }}
            >
              <option value="__custom__">+ Add custom unit</option>
              {getDatasetLabels("measurement_units").map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <datalist id="unit-cost-options-list">
              {getDatasetLabels("unit_cost_options").map((option) => (
                <option key={option} value={formatCurrencyValue(option) || option}>
                </option>
              ))}
            </datalist>
            <input
              className="field-expiration"
              type="date"
              title="Expiration date for current stock (optional)."
              value={ingredientForm.expiration_date}
              onChange={(e) =>
                setIngredientForm({ ...ingredientForm, expiration_date: e.target.value })
              }
            />
            <input
              className="field-shelf-life"
              type="number"
              placeholder="Shelf Life (days)"
              title="Typical shelf life in days."
              value={ingredientForm.shelf_life_days}
              onChange={(e) =>
                setIngredientForm({ ...ingredientForm, shelf_life_days: e.target.value })
              }
            />
            <input
              className="field-reorder"
              type="number"
              step="0.01"
              placeholder="Restock Point"
              title="Minimum quantity before this ingredient should be reordered."
              value={ingredientForm.reorder_level}
              onChange={(e) =>
                setIngredientForm({ ...ingredientForm, reorder_level: e.target.value })
              }
            />
            <button className="field-submit" type="submit" title="Save this ingredient to inventory.">Create Ingredient</button>
          </form>
        </article>

        <article className="card">
          <h2>Scan Arrival</h2>
          <form onSubmit={scanArrival} className="form-grid">
            <input
              placeholder="Barcode"
              value={arrivalForm.barcode}
              onChange={(e) => setArrivalForm({ ...arrivalForm, barcode: e.target.value })}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Quantity Received"
              value={arrivalForm.quantity_received}
              onChange={(e) =>
                setArrivalForm({ ...arrivalForm, quantity_received: e.target.value })
              }
            />
            <input
              type="date"
              value={arrivalForm.expiration_date}
              onChange={(e) =>
                setArrivalForm({ ...arrivalForm, expiration_date: e.target.value })
              }
            />
            <input
              type="text"
              inputMode="decimal"
              value={arrivalForm.unit_cost}
              placeholder="Unit Cost (opt)"
              title="Dollar cost per received unit for this arrival."
              list="unit-cost-options-list"
              onChange={(e) => {
                setArrivalForm({ ...arrivalForm, unit_cost: e.target.value });
              }}
              onBlur={async (e) => {
                setArrivalForm((prev) => ({
                  ...prev,
                  unit_cost: formatCurrencyValue(e.target.value),
                }));
                await persistUnitCostOption(e.target.value);
              }}
            />
            <select
              value={arrivalForm.cost_unit || ""}
              title="Unit that the arrival unit cost applies to."
              onChange={async (e) => {
                const value = await resolveDropdownValue("measurement_units", e.target.value);
                if (value) setArrivalForm({ ...arrivalForm, cost_unit: value });
              }}
            >
              <option value="__custom__">+ Add custom unit</option>
              {getDatasetLabels("measurement_units").map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button type="submit">Record Arrival</button>
          </form>
        </article>
      </section>

      {/* Meal recipe creation + meal production logging */}
      <section className="card-grid two">
        <article className="card">
          <h2>Create Meal + Ingredients</h2>
          <form onSubmit={createMeal} className="form-grid">
            <input
              placeholder="Meal Name"
              value={mealForm.name}
              onChange={(e) => setMealForm({ ...mealForm, name: e.target.value })}
            />
            <div className="meal-meta-row">
              <select
                className="meal-type-select"
                value={mealForm.meal_type}
                title="Meal type (Breakfast, Lunch, Dinner, Special Occasion)."
                onChange={async (e) => {
                  const value = await resolveDropdownValue("meal_types", e.target.value);
                  if (value) setMealForm({ ...mealForm, meal_type: value });
                }}
              >
                <option value="__custom__">+ Add custom meal type</option>
                {getDatasetLabels("meal_types").map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="meal-restrictions-select"
                multiple
                title="Select one or more food restrictions that cannot eat this meal."
                value={mealForm.restriction_ids}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
                  setMealForm({ ...mealForm, restriction_ids: selected });
                }}
              >
                {(datasets.food_restrictions || [])
                  .filter((option) => String(option.id) !== "1")
                  .map((option) => (
                    <option key={option.id} value={String(option.id).padStart(2, "0")}>
                      {String(option.id).padStart(2, "0")} - {option.label}
                    </option>
                  ))}
              </select>
            </div>
            {mealForm.ingredients.map((line, index) => (
              <div className="line" key={index}>
                <select
                  value={line.ingredient_id}
                  onChange={async (e) => {
                    await onMealIngredientSelect(index, e.target.value);
                  }}
                >
                  <option value="">Ingredient</option>
                  <option value="__custom__">+ Add custom ingredient</option>
                  {ingredients.map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {ingredient.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Qty per serving"
                  value={line.quantity_per_serving}
                  onChange={(e) =>
                    updateMealLine(index, "quantity_per_serving", e.target.value)
                  }
                />
              </div>
            ))}
            <button type="button" onClick={addMealLine}>
              Add Ingredient Line
            </button>
            <button type="submit">Create Meal</button>
          </form>
        </article>

        <article className="card">
          <h2>Record Meal Production</h2>
          <form onSubmit={produceMeal} className="form-grid">
            <select
              value={productionForm.meal_id}
              onChange={(e) =>
                setProductionForm({ ...productionForm, meal_id: e.target.value })
              }
            >
              <option value="">Select Meal</option>
              {meals.map((meal) => (
                <option key={meal.id} value={meal.id}>
                  {meal.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              value={productionForm.servings}
              onChange={(e) =>
                setProductionForm({ ...productionForm, servings: e.target.value })
              }
            />
            <button type="submit">Produce</button>
          </form>
        </article>
      </section>

      {/* Purchase order creation + delivery logging */}
      <section className="card-grid two">
        <article className="card">
          <h2>Create Purchase Order</h2>
          <form onSubmit={createPO} className="form-grid">
            <div className="po-header-row">
              <select
                className="po-supplier"
                value={poForm.supplier}
                onChange={async (e) => {
                  const value = await resolveDropdownValue("suppliers", e.target.value);
                  if (value) setPoForm({ ...poForm, supplier: value });
                }}
              >
                <option value="">Supplier</option>
                <option value="__custom__">+ Add custom supplier</option>
                {getDatasetLabels("suppliers").map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="po-status"
                value={poForm.status}
                onChange={async (e) => {
                  const value = await resolveDropdownValue("order_statuses", e.target.value);
                  if (value) setPoForm({ ...poForm, status: value });
                }}
              >
                <option value="">Status</option>
                <option value="__custom__">+ Add custom status</option>
                {getDatasetLabels("order_statuses").map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {poForm.items.map((line, index) => (
              <div className="line po-line" key={index}>
                {(() => {
                  const selectedBrand = line.brand_name || "Brand";
                  const brandOptions = getDatasetLabels("brands");
                  const hasSelectedBrand = brandOptions.includes(selectedBrand);
                  return (
                <select
                  value={selectedBrand}
                  onChange={async (e) => {
                    const nextValue = e.target.value;
                    await onPoBrandSelect(index, nextValue);
                  }}
                >
                  <option value="Brand">Brand</option>
                  <option value="__custom__">+ Add custom brand</option>
                  {!hasSelectedBrand && selectedBrand !== "Brand" ? (
                    <option value={selectedBrand}>{selectedBrand}</option>
                  ) : null}
                  {(getDatasetLabels("brands").length ? getDatasetLabels("brands") : ["Brand"]).map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
                  );
                })()}
                <select
                  value={
                    line.ingredient_id === "" || Number.isNaN(Number(line.ingredient_id))
                      ? String(line.ingredient_id || "")
                      : String(Number(line.ingredient_id))
                  }
                  onChange={async (e) => {
                    await onPoIngredientSelect(index, e.target.value);
                  }}
                >
                  <option value="">Ingredient</option>
                  <option value="__custom__">+ Add custom ingredient</option>
                  {ingredients.map((ingredient) => (
                    <option key={ingredient.id} value={String(Number(ingredient.id))}>
                      {ingredient.name}
                    </option>
                  ))}
                </select>
                <input
                  className="po-qty"
                  type="number"
                  step="0.01"
                  placeholder="Quantity"
                  value={line.quantity_ordered}
                  onChange={(e) => updatePoLine(index, "quantity_ordered", e.target.value)}
                />
                <select
                  className="po-size"
                  value={line.cost_unit || ""}
                  title="Unit that the PO line cost applies to."
                  onChange={async (e) => {
                    const value = await resolveDropdownValue("measurement_units", e.target.value);
                    if (value) updatePoLine(index, "cost_unit", value);
                  }}
                >
                  <option value="__custom__">+ Custom unit</option>
                  {getDatasetLabels("measurement_units").map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <input
                  className="po-unit-cost"
                  type="text"
                  inputMode="decimal"
                  placeholder="Unit Cost"
                  title="Dollar cost per unit for this PO line."
                  value={line.unit_cost}
                  list="unit-cost-options-list"
                  onChange={(e) => {
                    updatePoLine(index, "unit_cost", e.target.value);
                  }}
                  onBlur={async (e) => {
                    updatePoLine(index, "unit_cost", formatCurrencyValue(e.target.value));
                    await persistUnitCostOption(e.target.value);
                  }}
                />
              </div>
            ))}
            <button type="button" onClick={addPoLine}>
              Add PO Line
            </button>
            <button type="button" onClick={autofillLowStockToPO}>
              Autofill from Low Stock
            </button>
            <button type="submit">Create PO</button>
          </form>
        </article>

        <article className="card">
          <h2>Record Delivery</h2>
          <form onSubmit={createDelivery} className="form-grid">
            <select
              value={deliveryForm.meal_id}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, meal_id: e.target.value })}
            >
              <option value="">Meal</option>
              {meals.map((meal) => (
                <option key={meal.id} value={meal.id}>
                  {meal.name}
                </option>
              ))}
            </select>
            <select
              value={deliveryForm.site_id}
              onChange={(e) =>
                setDeliveryForm({ ...deliveryForm, site_id: e.target.value, client_id: "" })
              }
            >
              <option value="">Site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
            <select
              value={deliveryForm.client_id}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, client_id: e.target.value })}
            >
              <option value="">Client</option>
              {visibleClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.display_name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              value={deliveryForm.quantity}
              onChange={(e) => setDeliveryForm({ ...deliveryForm, quantity: e.target.value })}
            />
            <button type="submit">Log Delivery</button>
          </form>
        </article>
      </section>

      {/* Alerts: low stock and expiring ingredients */}
      <section className="card-grid two">
        <article className="card table-wrap">
          <h2>Low Inventory (Need to Order)</h2>
          <table>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>On Hand</th>
                <th>Reorder</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>
                    {item.quantity_on_hand} {item.unit}
                  </td>
                  <td>
                    {item.reorder_level} {item.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card table-wrap">
          <h2>Expiring Inventory</h2>
          <div className="line">
            <select
              value={expiringIncrementType}
              onChange={(e) => setExpiringIncrementType(e.target.value)}
            >
              <option value="days">Days</option>
              <option value="months">Months</option>
            </select>
            <input
              type="number"
              min="1"
              max="24"
              value={expiringIncrementValue}
              onChange={(e) => setExpiringIncrementValue(Number(e.target.value || 1))}
            />
            <label>
              <input
                type="checkbox"
                checked={demoClock}
                onChange={(e) => setDemoClock(e.target.checked)}
              />
              Demo Clock (1 sec = 1 day)
            </label>
          </div>
          <table>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Expiry</th>
                <th>Demo Days Left</th>
              </tr>
            </thead>
            <tbody>
              {expiring.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.expiration_date || "-"}</td>
                  <td>{item.demo_days_to_expiry ?? "-"}</td>
                </tr>
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
            <thead>
              <tr>
                <th>ID</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.map((po) => (
                <tr key={po.id}>
                  <td>{po.id}</td>
                  <td>{po.supplier}</td>
                  <td>{po.status}</td>
                  <td>{po.items.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card table-wrap">
          <h2>Arrivals</h2>
          <table>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Qty</th>
                <th>Unit Cost</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {arrivals.slice(0, 10).map((arrival) => (
                <tr key={arrival.id}>
                  <td>{arrival.ingredient_name}</td>
                  <td>{arrival.quantity_received}</td>
                  <td>
                    {arrival.unit_cost ?? "-"} {arrival.cost_unit || ""}
                  </td>
                  <td>{new Date(arrival.arrived_at).toLocaleString()}</td>
                </tr>
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
            <thead>
              <tr>
                <th>Meal</th>
                <th>Site</th>
                <th>Client</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.slice(0, 15).map((delivery) => (
                <tr key={delivery.id}>
                  <td>{delivery.meal_name}</td>
                  <td>{delivery.site_name}</td>
                  <td>{delivery.client_name}</td>
                  <td>{delivery.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card table-wrap">
          <h2>Site Delivery Report</h2>
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>Meals Delivered</th>
                <th>Clients Served</th>
              </tr>
            </thead>
            <tbody>
              {siteReport.map((row) => (
                <tr key={row.site_id}>
                  <td>{row.site_name}</td>
                  <td>{row.meals_delivered}</td>
                  <td>{row.clients_served}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      {/* Client dataset with restrictions, notes, and meal history count */}
      <section className="card table-wrap">
        <h2>Clients Dataset</h2>
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Site</th>
              <th>Restriction</th>
              <th>Meal History</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {clients.slice(0, 40).map((client) => (
              <tr key={client.id}>
                <td>{client.display_name}</td>
                <td>{client.site_name}</td>
                <td>{client.food_restrictions}</td>
                <td>{client.meal_history_count}</td>
                <td>{client.special_notes || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default App;
