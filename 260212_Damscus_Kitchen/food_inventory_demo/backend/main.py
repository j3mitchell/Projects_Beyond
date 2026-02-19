# Core date helpers for expiration math and seeded demo data.
from datetime import date, datetime, timedelta
# Typing for response lists.
from typing import List, Optional

# FastAPI gives API routing/dependencies; CORS allows frontend-backend communication.
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
# SQL helpers for aggregate reports and schema inspection.
from sqlalchemy import func, inspect, text
from sqlalchemy.exc import IntegrityError, InvalidRequestError
from sqlalchemy.orm import Session, joinedload

# Database session/engine objects.
from backend.database import Base, SessionLocal, engine
# SQLAlchemy table classes.
from backend.models import (
    Client,
    CostUnit,
    FoodArrival,
    FoodRestriction,
    Ingredient,
    IngredientCategory,
    IngredientUsage,
    Meal,
    MealDelivery,
    MealIngredient,
    MealType,
    MealProduction,
    PurchaseOrder,
    PurchaseOrderItem,
    POStatus,
    Site,
    Supplier,
    Unit,
    UnitCostOption,
    User,
)
from backend.schemas import (
    ClientOut,
    DashboardReport,
    DatasetOptionCreate,
    DatasetOptionOut,
    DemoTimeOut,
    FoodArrivalOut,
    FoodArrivalScan,
    IngredientCreate,
    IngredientCategoryCreate,
    IngredientCategoryOut,
    IngredientOut,
    IngredientUpdate,
    IngredientUsageOut,
    MealCreate,
    MealDeliveryCreate,
    MealDeliveryOut,
    MealIngredientOut,
    MealOut,
    MealProductionCreate,
    MealProductionOut,
    PurchaseOrderCreate,
    PurchaseOrderItemOut,
    PurchaseOrderOut,
    SiteCreate,
    SiteDeliveryReport,
    SiteOut,
)


# Default dropdown datasets used by frontend.
DEFAULT_DATASETS = {
    "measurement_units": ["count", "oz", "lb", "g", "kg", "ml", "liter", "cup", "tbsp", "tsp", "gallon"],
    "cost_units": ["USD / count", "USD / oz", "USD / lb", "USD / kg", "USD / liter", "USD / gallon"],
    "unit_cost_options": ["0.25", "0.50", "0.75", "1.00", "1.50", "2.00", "2.50", "3.00", "4.50", "5.00"],
    "order_statuses": ["Draft", "Submitted", "Approved", "In Transit", "Delivered", "Closed"],
    "meal_types": ["Breakfast", "Lunch", "Dinner", "Special Occasion"],
    "food_restrictions": ["None", "Low Sodium", "Diabetic", "Gluten Free", "Dairy Free", "Nut Allergy", "Halal", "Vegetarian"],
}

DEFAULT_INGREDIENT_CATEGORIES = [
    "Produce",
    "Meat",
    "Dairy",
    "Flour",
    "Fruit",
    "Sugar",
    "Dry Goods",
    "Spices",
    "Frozen",
]


def ensure_schema():
    # Look at current database tables.
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    # These are the tables our current app version needs.
    required_tables = {
        "users",
        "ingredient_categories",
        "meal_types",
        "po_status",
        "sites",
        "clients",
        "ingredients",
        "meals",
        "meal_ingredients",
        "food_arrivals",
        "meal_productions",
        "ingredient_usage",
        "purchase_orders",
        "purchase_order_items",
        "meal_deliveries",
    }

    # Recreate database when old schema is missing required tables.
    recreate = not required_tables.issubset(existing_tables)
    if not recreate and "clients" in existing_tables:
        client_columns = {col["name"] for col in inspector.get_columns("clients")}
        recreate = "client_code" not in client_columns or "first_name" not in client_columns
    if not recreate and "ingredients" in existing_tables:
        ingredient_columns = {col["name"] for col in inspector.get_columns("ingredients")}
        recreate = "category" not in ingredient_columns or "cost_unit" not in ingredient_columns

    if recreate:
        # Drop old tables so we can rebuild to the latest schema.
        Base.metadata.drop_all(bind=engine)
    # Create tables if they do not already exist.
    Base.metadata.create_all(bind=engine)
    migrate_drop_is_custom()
    migrate_ingredient_category_ids()
    migrate_ingredient_category_values_to_ids()
    migrate_client_food_restrictions()
    migrate_meal_type_to_restriction()
    migrate_po_status()
    migrate_purchase_orders_po_status_fk()
    migrate_ingredients_enforce_non_null_pk()
    migrate_meals_enforce_non_null_ids()


def migrate_drop_is_custom():
    # Remove legacy is_custom from lookup tables.
    with engine.begin() as conn:
        inspector = inspect(conn)
        for table_name in [
            "ingredient_categories",
            "food_restrictions",
            "units",
            "meal_types",
            "po_status",
            "order_statuses",
        ]:
            if table_name not in set(inspector.get_table_names()):
                continue
            columns = inspector.get_columns(table_name)
            col_names = {col["name"] for col in columns}
            if "is_custom" not in col_names:
                continue

            id_col = next(col for col in columns if col["name"] == "id")
            name_col = next(col for col in columns if col["name"] == "name")
            id_type = str(id_col["type"])
            name_type = str(name_col["type"])

            conn.exec_driver_sql(
                f"""
                CREATE TABLE {table_name}_new (
                    id {id_type} PRIMARY KEY,
                    name {name_type} NOT NULL UNIQUE
                )
                """
            )
            conn.exec_driver_sql(
                f"INSERT INTO {table_name}_new (id, name) SELECT id, name FROM {table_name}"
            )
            conn.exec_driver_sql(f"DROP TABLE {table_name}")
            conn.exec_driver_sql(f"ALTER TABLE {table_name}_new RENAME TO {table_name}")
            conn.exec_driver_sql(f"CREATE INDEX IF NOT EXISTS ix_{table_name}_id ON {table_name} (id)")
            conn.exec_driver_sql(f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{table_name}_name ON {table_name} (name)")


def migrate_ingredient_category_ids():
    # Convert legacy integer IDs to two-digit text IDs without touching other tables.
    with engine.begin() as conn:
        inspector = inspect(conn)
        if "ingredient_categories" not in set(inspector.get_table_names()):
            return
        id_col = next((col for col in inspector.get_columns("ingredient_categories") if col["name"] == "id"), None)
        if id_col is None:
            return
        # SQLite may report INTEGER/INT for legacy schema; skip if already text.
        if "INT" not in str(id_col["type"]).upper():
            return

        conn.exec_driver_sql(
            """
            CREATE TABLE ingredient_categories_new (
                id TEXT PRIMARY KEY,
                name VARCHAR NOT NULL UNIQUE
            )
            """
        )
        conn.exec_driver_sql(
            """
            INSERT INTO ingredient_categories_new (id, name)
            SELECT printf('%02d', id), name
            FROM ingredient_categories
            ORDER BY id
            """
        )
        conn.exec_driver_sql("DROP TABLE ingredient_categories")
        conn.exec_driver_sql("ALTER TABLE ingredient_categories_new RENAME TO ingredient_categories")


def migrate_ingredient_category_values_to_ids():
    # Store category IDs in ingredients.category (legacy data may contain names).
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        if "ingredients" not in existing_tables or "ingredient_categories" not in existing_tables:
            return

        conn.exec_driver_sql(
            """
            UPDATE ingredients
            SET category = (
                SELECT ic.id
                FROM ingredient_categories ic
                WHERE lower(trim(ic.name)) = lower(trim(ingredients.category))
                LIMIT 1
            )
            WHERE EXISTS (
                SELECT 1
                FROM ingredient_categories ic
                WHERE lower(trim(ic.name)) = lower(trim(ingredients.category))
            )
            """
        )


def migrate_client_food_restrictions():
    # Normalize clients.food_restrictions text into food_restrictions FK table.
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        if "clients" not in existing_tables:
            return

        if "food_restrictions" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE food_restrictions (
                    id TEXT PRIMARY KEY,
                    name VARCHAR NOT NULL UNIQUE
                )
                """
            )

        # Seed default restriction rows if missing.
        for i, name in enumerate(DEFAULT_DATASETS["food_restrictions"], start=1):
            conn.exec_driver_sql(
                """
                INSERT OR IGNORE INTO food_restrictions (id, name)
                VALUES (?, ?)
                """,
                (f"{i:02d}", name),
            )

        client_columns = {col["name"]: col for col in inspector.get_columns("clients")}
        if "restriction_id" in client_columns:
            # Ensure no NULL restriction_id values remain.
            none_id = conn.exec_driver_sql(
                "SELECT id FROM food_restrictions WHERE name = 'None' LIMIT 1"
            ).scalar()
            if none_id:
                conn.exec_driver_sql(
                    "UPDATE clients SET restriction_id = ? WHERE restriction_id IS NULL",
                    (none_id,),
                )
            return

        if "food_restrictions" not in client_columns:
            return

        id_type = str(client_columns["id"]["type"])
        site_id_type = str(client_columns["site_id"]["type"])
        none_id = conn.exec_driver_sql("SELECT id FROM food_restrictions WHERE name = 'None' LIMIT 1").scalar()
        if none_id is None:
            none_id = "01"

        conn.exec_driver_sql(
            f"""
            CREATE TABLE clients_new (
                id {id_type} PRIMARY KEY,
                site_id {site_id_type} NOT NULL,
                restriction_id TEXT NOT NULL,
                client_code VARCHAR NOT NULL UNIQUE,
                first_name VARCHAR NOT NULL,
                last_name VARCHAR NOT NULL,
                special_notes TEXT,
                FOREIGN KEY(site_id) REFERENCES sites(id),
                FOREIGN KEY(restriction_id) REFERENCES food_restrictions(id)
            )
            """
        )
        conn.exec_driver_sql(
            """
            INSERT INTO clients_new (id, site_id, restriction_id, client_code, first_name, last_name, special_notes)
            SELECT
                c.id,
                c.site_id,
                COALESCE(
                    fr.id,
                    CASE
                        WHEN c.food_restrictions IS NULL OR trim(c.food_restrictions) IN ('', '-', ' - ') THEN ?
                        ELSE ?
                    END
                ) AS restriction_id,
                c.client_code,
                c.first_name,
                c.last_name,
                c.special_notes
            FROM clients c
            LEFT JOIN food_restrictions fr
                ON lower(trim(c.food_restrictions)) = lower(fr.name)
            """,
            (none_id, none_id),
        )
        conn.exec_driver_sql("DROP TABLE clients")
        conn.exec_driver_sql("ALTER TABLE clients_new RENAME TO clients")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_clients_id ON clients (id)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_clients_site_id ON clients (site_id)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_clients_restriction_id ON clients (restriction_id)")
        conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_clients_client_code ON clients (client_code)")


def migrate_meal_type_to_restriction():
    # Rename meals.meal_type to meals.restriction and map values to food_restrictions IDs.
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        if "meals" not in existing_tables:
            return

        meal_columns = {col["name"] for col in inspector.get_columns("meals")}
        if "restriction" in meal_columns and "meal_type" not in meal_columns:
            return

        if "restriction" not in meal_columns:
            conn.exec_driver_sql("ALTER TABLE meals ADD COLUMN restriction VARCHAR")

        if "meal_type" in meal_columns:
            conn.exec_driver_sql(
                """
                UPDATE meals
                SET restriction = CASE lower(trim(meal_type))
                    WHEN '02' THEN '03'
                    WHEN 'diabetic' THEN '03'
                    WHEN '04' THEN '02'
                    WHEN 'low sodium' THEN '02'
                    WHEN 'low-sodium' THEN '02'
                    WHEN '07' THEN '08'
                    WHEN 'vegetarian' THEN '08'
                    ELSE '01'
                END
                WHERE restriction IS NULL OR trim(restriction) = ''
                """
            )
        else:
            conn.exec_driver_sql(
                "UPDATE meals SET restriction = '01' WHERE restriction IS NULL OR trim(restriction) = ''"
            )

        # Rebuild table to drop legacy meal_type column.
        id_type = next(col for col in inspector.get_columns("meals") if col["name"] == "id")["type"]
        conn.exec_driver_sql(
            f"""
            CREATE TABLE meals_new (
                id {id_type} PRIMARY KEY,
                name VARCHAR NOT NULL UNIQUE,
                restriction VARCHAR NOT NULL
            )
            """
        )
        conn.exec_driver_sql(
            "INSERT INTO meals_new (id, name, restriction) SELECT id, name, restriction FROM meals"
        )
        conn.exec_driver_sql("DROP TABLE meals")
        conn.exec_driver_sql("ALTER TABLE meals_new RENAME TO meals")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_meals_id ON meals (id)")
        conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_meals_name ON meals (name)")


def migrate_po_status():
    # Normalize PO statuses into po_status and store purchase_orders.po_status as status ID.
    with engine.begin() as conn:
        conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS po_status (
                id TEXT PRIMARY KEY,
                name VARCHAR NOT NULL UNIQUE
            )
            """
        )
        defaults = [
            ("01", "Draft"),
            ("02", "Submitted"),
            ("03", "Approved"),
            ("04", "In Transit"),
            ("05", "Delivered"),
            ("06", "Closed"),
        ]
        for sid, name in defaults:
            conn.exec_driver_sql("INSERT OR IGNORE INTO po_status (id, name) VALUES (?, ?)", (sid, name))

        inspector = inspect(conn)
        if "purchase_orders" not in set(inspector.get_table_names()):
            return

        po_columns = {col["name"] for col in inspector.get_columns("purchase_orders")}
        if "status" in po_columns and "po_status" not in po_columns:
            conn.exec_driver_sql('ALTER TABLE purchase_orders RENAME COLUMN status TO "po_status"')
        if "PO_Status" in po_columns and "po_status" not in po_columns:
            conn.exec_driver_sql('ALTER TABLE purchase_orders RENAME COLUMN "PO_Status" TO "po_status"')

        conn.exec_driver_sql(
            """
            UPDATE purchase_orders
            SET "po_status" = CASE lower(trim("po_status"))
                WHEN 'draft' THEN '01'
                WHEN 'submitted' THEN '02'
                WHEN 'approved' THEN '03'
                WHEN 'in transit' THEN '04'
                WHEN 'delivered' THEN '05'
                WHEN 'closed' THEN '06'
                ELSE "po_status"
            END
            """
        )


def migrate_purchase_orders_po_status_fk():
    # Enforce purchase_orders.po_status -> po_status.id as a real FK.
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        if "purchase_orders" not in existing_tables or "po_status" not in existing_tables:
            return

        fk_rows = inspector.get_foreign_keys("purchase_orders")
        for fk in fk_rows:
            constrained = set(fk.get("constrained_columns") or [])
            referred_table = fk.get("referred_table")
            referred_cols = set(fk.get("referred_columns") or [])
            if constrained == {"po_status"} and referred_table == "po_status" and referred_cols == {"id"}:
                return

        po_columns = {col["name"] for col in inspector.get_columns("purchase_orders")}
        if "po_status" not in po_columns:
            return

        # Keep data valid before FK is enforced.
        conn.exec_driver_sql(
            """
            UPDATE purchase_orders
            SET "po_status" = '01'
            WHERE "po_status" NOT IN (SELECT id FROM po_status)
            """
        )

        conn.exec_driver_sql(
            """
            CREATE TABLE purchase_orders_new (
                id TEXT PRIMARY KEY CHECK(length(id)=2 AND id GLOB '[0-9][0-9]'),
                supplier VARCHAR NOT NULL,
                "po_status" VARCHAR NOT NULL,
                created_at DATETIME NOT NULL,
                arrival TEXT,
                FOREIGN KEY("po_status") REFERENCES po_status(id)
            )
            """
        )
        conn.exec_driver_sql(
            """
            INSERT INTO purchase_orders_new (id, supplier, "po_status", created_at, arrival)
            SELECT id, supplier, "po_status", created_at, arrival
            FROM purchase_orders
            """
        )
        conn.exec_driver_sql("DROP TABLE purchase_orders")
        conn.exec_driver_sql("ALTER TABLE purchase_orders_new RENAME TO purchase_orders")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_purchase_orders_id ON purchase_orders (id)")
        conn.exec_driver_sql('CREATE INDEX IF NOT EXISTS ix_purchase_orders_po_status ON purchase_orders ("po_status")')


def migrate_ingredients_enforce_non_null_pk():
    # SQLite does not enforce NOT NULL for TEXT PK unless explicitly set.
    # Rebuild ingredients so id is guaranteed non-null and repair any existing null IDs.
    with engine.begin() as conn:
        inspector = inspect(conn)
        if "ingredients" not in set(inspector.get_table_names()):
            return

        table_info = conn.exec_driver_sql("PRAGMA table_info(ingredients)").fetchall()
        id_info = next((row for row in table_info if row[1] == "id"), None)
        id_is_not_null = bool(id_info and int(id_info[3]) == 1)

        # First repair any existing NULL/blank IDs.
        rows = conn.exec_driver_sql("SELECT rowid, id FROM ingredients ORDER BY rowid").fetchall()
        used_ids = set()
        for _, raw_id in rows:
            try:
                if raw_id is not None and str(raw_id).strip() != "":
                    used_ids.add(int(str(raw_id)))
            except (TypeError, ValueError):
                continue

        next_id = (max(used_ids) if used_ids else 0) + 1
        for rowid, raw_id in rows:
            if raw_id is not None and str(raw_id).strip() != "":
                continue
            while next_id in used_ids:
                next_id += 1
            conn.exec_driver_sql(
                "UPDATE ingredients SET id = ? WHERE rowid = ?",
                (f"{next_id:02d}", rowid),
            )
            used_ids.add(next_id)
            next_id += 1

        # If already enforced by schema, no rebuild needed.
        if id_is_not_null:
            return

        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        conn.exec_driver_sql(
            """
            CREATE TABLE ingredients_new (
              id TEXT NOT NULL PRIMARY KEY,
              name VARCHAR NOT NULL UNIQUE,
              category VARCHAR NOT NULL,
              barcode VARCHAR NOT NULL UNIQUE,
              unit VARCHAR NOT NULL,
              quantity_on_hand FLOAT NOT NULL,
              reorder_level FLOAT NOT NULL,
              shelf_life_days TEXT NOT NULL,
              expiration_date DATE,
              default_unit_cost FLOAT,
              cost_unit VARCHAR,
              ingredient_code TEXT,
              shelf_life TEXT
            )
            """
        )
        conn.exec_driver_sql(
            """
            INSERT INTO ingredients_new (
              id, name, category, barcode, unit, quantity_on_hand, reorder_level,
              shelf_life_days, expiration_date, default_unit_cost, cost_unit, ingredient_code, shelf_life
            )
            SELECT
              id, name, category, barcode, unit, quantity_on_hand, reorder_level,
              shelf_life_days, expiration_date, default_unit_cost, cost_unit, ingredient_code, shelf_life
            FROM ingredients
            WHERE id IS NOT NULL AND TRIM(CAST(id AS TEXT)) <> ''
            """
        )
        conn.exec_driver_sql("DROP TABLE ingredients")
        conn.exec_driver_sql("ALTER TABLE ingredients_new RENAME TO ingredients")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_ingredients_id ON ingredients (id)")
        conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_ingredients_name ON ingredients (name)")
        conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_ingredients_barcode ON ingredients (barcode)")
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")


def migrate_meals_enforce_non_null_ids():
    # Enforce NOT NULL IDs on meals/meal_ingredients and repair legacy NULL IDs.
    with engine.begin() as conn:
        inspector = inspect(conn)
        existing_tables = set(inspector.get_table_names())
        if "meals" not in existing_tables or "meal_ingredients" not in existing_tables:
            return

        # Repair NULL/blank meal IDs.
        meal_rows = conn.exec_driver_sql("SELECT rowid, id FROM meals ORDER BY rowid").fetchall()
        used_meal_ids = set()
        for _, raw_id in meal_rows:
            try:
                if raw_id is not None and str(raw_id).strip() != "":
                    used_meal_ids.add(int(str(raw_id)))
            except (TypeError, ValueError):
                continue
        next_meal_id = (max(used_meal_ids) if used_meal_ids else 0) + 1
        for rowid, raw_id in meal_rows:
            if raw_id is not None and str(raw_id).strip() != "":
                continue
            while next_meal_id in used_meal_ids:
                next_meal_id += 1
            conn.exec_driver_sql("UPDATE meals SET id = ? WHERE rowid = ?", (f"{next_meal_id:02d}", rowid))
            used_meal_ids.add(next_meal_id)
            next_meal_id += 1

        # Repair NULL/blank meal_ingredients IDs.
        mi_rows = conn.exec_driver_sql("SELECT rowid, id FROM meal_ingredients ORDER BY rowid").fetchall()
        used_mi_ids = set()
        for _, raw_id in mi_rows:
            try:
                if raw_id is not None and str(raw_id).strip() != "":
                    used_mi_ids.add(int(str(raw_id)))
            except (TypeError, ValueError):
                continue
        next_mi_id = (max(used_mi_ids) if used_mi_ids else 0) + 1
        for rowid, raw_id in mi_rows:
            if raw_id is not None and str(raw_id).strip() != "":
                continue
            while next_mi_id in used_mi_ids:
                next_mi_id += 1
            conn.exec_driver_sql("UPDATE meal_ingredients SET id = ? WHERE rowid = ?", (f"{next_mi_id:02d}", rowid))
            used_mi_ids.add(next_mi_id)
            next_mi_id += 1

        meal_info = conn.exec_driver_sql("PRAGMA table_info(meals)").fetchall()
        mi_info = conn.exec_driver_sql("PRAGMA table_info(meal_ingredients)").fetchall()
        meal_id_not_null = bool(next((row for row in meal_info if row[1] == "id" and int(row[3]) == 1), None))
        mi_id_not_null = bool(next((row for row in mi_info if row[1] == "id" and int(row[3]) == 1), None))
        if meal_id_not_null and mi_id_not_null:
            return

        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        conn.exec_driver_sql(
            """
            CREATE TABLE meals_new (
                id TEXT NOT NULL PRIMARY KEY,
                name VARCHAR NOT NULL UNIQUE,
                restriction VARCHAR NOT NULL
            )
            """
        )
        conn.exec_driver_sql(
            """
            INSERT INTO meals_new (id, name, restriction)
            SELECT id, name, restriction
            FROM meals
            WHERE id IS NOT NULL AND TRIM(CAST(id AS TEXT)) <> ''
            """
        )
        conn.exec_driver_sql("DROP TABLE meals")
        conn.exec_driver_sql("ALTER TABLE meals_new RENAME TO meals")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_meals_id ON meals (id)")
        conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_meals_name ON meals (name)")

        conn.exec_driver_sql(
            """
            CREATE TABLE meal_ingredients_new (
              id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=2 AND id GLOB '[0-9][0-9]'),
              meal_id TEXT NOT NULL,
              ingredient_id TEXT NOT NULL,
              quantity_per_serving FLOAT NOT NULL,
              FOREIGN KEY(meal_id) REFERENCES meals(id),
              FOREIGN KEY(ingredient_id) REFERENCES ingredients(id)
            )
            """
        )
        conn.exec_driver_sql(
            """
            INSERT INTO meal_ingredients_new (id, meal_id, ingredient_id, quantity_per_serving)
            SELECT id, meal_id, ingredient_id, quantity_per_serving
            FROM meal_ingredients
            WHERE id IS NOT NULL AND TRIM(CAST(id AS TEXT)) <> ''
            """
        )
        conn.exec_driver_sql("DROP TABLE meal_ingredients")
        conn.exec_driver_sql("ALTER TABLE meal_ingredients_new RENAME TO meal_ingredients")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_meal_ingredients_meal_id ON meal_ingredients (meal_id)")
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_meal_ingredients_ingredient_id ON meal_ingredients (ingredient_id)"
        )
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")


# Run schema check once when module starts.
ensure_schema()

# Create FastAPI app instance with API docs title and version.
app = FastAPI(title="Kitchen Food Inventory API", version="1.3.5")

# Allow browser apps on other ports (like localhost:4000) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple role hierarchy for authorization checks.
ROLE_WEIGHT = {"Rep": 1, "Mgmt": 2, "Root": 3}


def get_db():
    # Open a fresh DB session for one request.
    db = SessionLocal()
    try:
        # Hand session to route function.
        yield db
    finally:
        # Always close session, even if request fails.
        db.close()


def authorize(min_role: str):
    # Convert role name to numeric "power level."
    required_weight = ROLE_WEIGHT[min_role]

    def _authorize(x_role: str = Header(default="Rep")):
        # Reject unknown role header values.
        if x_role not in ROLE_WEIGHT:
            raise HTTPException(status_code=403, detail="Invalid role")
        # Reject users with lower access than required.
        if ROLE_WEIGHT[x_role] < required_weight:
            raise HTTPException(status_code=403, detail=f"{min_role} role required")
        return x_role

    # Return dependency function used inside route definitions.
    return _authorize


def get_demo_days_elapsed() -> int:
    # Demo rule: 1 second in real time = 1 day in app time.
    elapsed_seconds = int((datetime.utcnow() - app.state.demo_started_at).total_seconds())
    return max(elapsed_seconds, 0)


def get_demo_date() -> date:
    # Virtual demo date moves forward quickly for expiration demos.
    return date.today() + timedelta(days=get_demo_days_elapsed())


def parse_currency_to_float(value) -> Optional[float]:
    # Accept floats/ints and "$ 12.34" style strings from legacy seeded data.
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    raw = str(value).strip()
    if not raw:
        return None
    cleaned = raw.replace("$", "").replace(",", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def resolve_ingredient_category_id(raw_value: str, db: Session) -> str:
    # Accept either a category ID (e.g. "01") or category name (e.g. "Produce").
    value = (raw_value or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Ingredient category is required")

    by_id = db.query(IngredientCategory).filter(IngredientCategory.id == value).first()
    if by_id:
        return by_id.id

    by_name = db.query(IngredientCategory).filter(func.lower(IngredientCategory.name) == value.lower()).first()
    if by_name:
        return by_name.id

    raise HTTPException(status_code=400, detail=f"Invalid ingredient category: {raw_value}")


def ingredient_to_schema(ingredient: Ingredient, ref_date: date, db: Session) -> IngredientOut:
    # Convert SQLAlchemy Ingredient object into API response object.
    days = None
    if ingredient.expiration_date:
        days = (ingredient.expiration_date - ref_date).days
    category_id = str(ingredient.category or "")
    category_row = db.query(IngredientCategory).filter(IngredientCategory.id == category_id).first()
    category_name = category_row.name if category_row else category_id

    return IngredientOut(
        id=ingredient.id,
        name=ingredient.name,
        category=category_name,
        category_id=category_id or None,
        barcode=ingredient.barcode,
        unit=ingredient.unit,
        quantity_on_hand=ingredient.quantity_on_hand,
        reorder_level=ingredient.reorder_level,
        shelf_life_days=ingredient.shelf_life_days,
        expiration_date=ingredient.expiration_date,
        default_unit_cost=parse_currency_to_float(ingredient.default_unit_cost),
        cost_unit=ingredient.cost_unit,
        demo_days_to_expiry=days,
    )


def meal_to_schema(meal: Meal) -> MealOut:
    # Convert SQLAlchemy Meal object into API response object.
    return MealOut(
        id=meal.id,
        name=meal.name,
        restriction=meal.restriction,
        ingredients=[
            MealIngredientOut(
                id=item.id,
                ingredient_id=item.ingredient_id,
                quantity_per_serving=item.quantity_per_serving,
                ingredient_name=item.ingredient.name,
                unit=item.ingredient.unit,
            )
            for item in meal.ingredients
        ],
    )


def normalize_meal_restriction_ids(raw: str, db: Session) -> str:
    # Restriction IDs are stored as comma-separated 2-digit IDs, e.g. "04,07,08".
    tokens = [part.strip() for part in (raw or "").split(",") if part.strip()]
    if not tokens:
        return "01"

    normalized: list[str] = []
    for token in tokens:
        token = token.zfill(2) if token.isdigit() and len(token) < 2 else token
        if not db.query(FoodRestriction).filter(FoodRestriction.id == token).first():
            raise HTTPException(status_code=400, detail=f"Invalid meal restriction ID: {token}")
        if token not in normalized:
            normalized.append(token)

    normalized.sort(key=lambda value: int(value))
    return ",".join(normalized)


def purchase_order_to_schema(po: PurchaseOrder) -> PurchaseOrderOut:
    # Convert PO DB object into nested response format.
    return PurchaseOrderOut(
        id=po.id,
        supplier=po.supplier,
        po_status=po.po_status,
        created_at=po.created_at,
        items=[
            PurchaseOrderItemOut(
                id=item.id,
                ingredient_id=item.ingredient_id,
                ingredient_name=item.ingredient.name,
                quantity_ordered=item.quantity_ordered,
                unit_cost=parse_currency_to_float(item.unit_cost),
                cost_unit=item.cost_unit,
            )
            for item in po.items
        ],
    )


def next_lookup_id(db: Session, model) -> str:
    rows = db.query(model.id).all()
    max_id = 0
    for (raw_id,) in rows:
        try:
            max_id = max(max_id, int(raw_id))
        except (TypeError, ValueError):
            continue
    next_id = max_id + 1
    if next_id > 99:
        raise HTTPException(status_code=400, detail=f"{model.__tablename__} ID limit reached (99)")
    return f"{next_id:02d}"


def repair_null_ingredient_ids(db: Session):
    # Defensive repair for legacy rows where SQLite allowed NULL on TEXT PK.
    null_rows = db.query(Ingredient).filter(Ingredient.id.is_(None)).order_by(Ingredient.name.asc()).all()
    if not null_rows:
        return

    used_ids = set()
    for (raw_id,) in db.query(Ingredient.id).filter(Ingredient.id.isnot(None)).all():
        try:
            used_ids.add(int(str(raw_id)))
        except (TypeError, ValueError):
            continue

    next_id = (max(used_ids) if used_ids else 0) + 1
    for row in null_rows:
        while next_id in used_ids:
            next_id += 1
        db.query(Ingredient).filter(Ingredient.barcode == row.barcode, Ingredient.id.is_(None)).update(
            {Ingredient.id: f"{next_id:02d}"},
            synchronize_session=False,
        )
        used_ids.add(next_id)
        next_id += 1
    db.commit()


def ensure_units(db: Session):
    for name in DEFAULT_DATASETS["measurement_units"]:
        exists = db.query(Unit).filter(Unit.name == name).first()
        if not exists:
            db.add(Unit(id=next_lookup_id(db, Unit), name=name))
            db.flush()


def ensure_cost_units(db: Session):
    for name in DEFAULT_DATASETS["cost_units"]:
        exists = db.query(CostUnit).filter(CostUnit.name == name).first()
        if not exists:
            db.add(CostUnit(id=next_lookup_id(db, CostUnit), name=name))
            db.flush()


def ensure_unit_cost_options(db: Session):
    for name in DEFAULT_DATASETS["unit_cost_options"]:
        exists = db.query(UnitCostOption).filter(UnitCostOption.name == name).first()
        if not exists:
            db.add(UnitCostOption(id=next_lookup_id(db, UnitCostOption), name=name))
            db.flush()


def ensure_order_statuses(db: Session):
    for name in DEFAULT_DATASETS["order_statuses"]:
        exists = db.query(POStatus).filter(POStatus.name == name).first()
        if not exists:
            db.add(POStatus(id=next_lookup_id(db, POStatus), name=name))
            db.flush()


def ensure_meal_types(db: Session):
    for name in DEFAULT_DATASETS["meal_types"]:
        exists = db.query(MealType).filter(MealType.name == name).first()
        if not exists:
            db.add(MealType(id=next_lookup_id(db, MealType), name=name))
            db.flush()


def ensure_suppliers(db: Session):
    # Keep at least a few supplier names for dropdown usage.
    if db.query(Supplier).count() > 0:
        return
    seed = [
        ("01", "TX", "Dallas", "800 Trinity Mills Rd, Dallas, TX 75287", "Sysco Corporation"),
        ("02", "VA", "Arlington", "3033 Wilson Blvd, Arlington, VA 22201", "US Foods Holding Corp."),
        ("03", "PA", "Philadelphia", "1701 Market St, Philadelphia, PA 19103", "WebstaurantStore"),
    ]
    for row in seed:
        db.add(Supplier(id=row[0], st=row[1], city=row[2], address=row[3], name=row[4]))
        db.flush()


def next_food_restriction_id(db: Session) -> str:
    return next_lookup_id(db, FoodRestriction)


def next_site_id(db: Session) -> str:
    rows = db.query(Site.id).all()
    max_id = 0
    for (raw_id,) in rows:
        try:
            max_id = max(max_id, int(raw_id))
        except (TypeError, ValueError):
            continue
    next_id = max_id + 1
    if next_id > 99:
        raise HTTPException(status_code=400, detail="Site ID limit reached (99)")
    return f"{next_id:02d}"


def derive_site_fields(db: Session, state_code: str, city: str) -> tuple[str, str]:
    state = (state_code or "").strip().upper()
    if len(state) != 2:
        raise HTTPException(status_code=400, detail="state_code must be exactly 2 characters")
    clean_city = (city or "").strip()
    if not clean_city:
        raise HTTPException(status_code=400, detail="city is required")

    existing_codes = (
        db.query(Site.site_code)
        .filter(Site.state_code == state, Site.site_code.like(f"{state}-%"))
        .all()
    )
    max_seq = 0
    for (code,) in existing_codes:
        try:
            max_seq = max(max_seq, int(str(code).split("-")[-1]))
        except (TypeError, ValueError):
            continue
    seq = max_seq + 1
    if seq > 99:
        raise HTTPException(status_code=400, detail=f"Site sequence limit reached for {state}")

    site_code = f"{state}-{seq:02d}"
    site_name = f"{state} - {clean_city} {seq:02d}"
    return site_code, site_name


def ensure_food_restrictions(db: Session):
    # Seed normalized client food restrictions table.
    for name in DEFAULT_DATASETS["food_restrictions"]:
        exists = db.query(FoodRestriction).filter(FoodRestriction.name == name).first()
        if not exists:
            db.add(FoodRestriction(id=next_food_restriction_id(db), name=name))
            db.flush()


def next_ingredient_category_id(db: Session) -> str:
    # Keep IDs as zero-padded two-digit strings.
    return next_lookup_id(db, IngredientCategory)


def ensure_ingredient_categories(db: Session):
    # Seed ingredient categories into dedicated table for Add Ingredient DDL.
    existing_names = {row.name for row in db.query(IngredientCategory).all()}
    for name in DEFAULT_INGREDIENT_CATEGORIES:
        if name in existing_names:
            continue
        db.add(IngredientCategory(id=next_ingredient_category_id(db), name=name))
        db.flush()
        existing_names.add(name)


def seed_sites_and_clients(db: Session):
    if db.query(Site).count() > 0:
        return

    # 10 sites in [State] - [City] [ID ##] format.
    site_seed = [
        ("CA", "San Diego"),
        ("CA", "Los Angeles"),
        ("AZ", "Phoenix"),
        ("NV", "Las Vegas"),
        ("TX", "Dallas"),
        ("TX", "Austin"),
        ("CO", "Denver"),
        ("WA", "Seattle"),
        ("OR", "Portland"),
        ("NM", "Albuquerque"),
    ]

    first_names = [
        "Avery",
        "Jordan",
        "Taylor",
        "Morgan",
        "Riley",
        "Casey",
        "Cameron",
        "Parker",
        "Emerson",
        "Quinn",
    ]
    last_names = [
        "Johnson",
        "Williams",
        "Brown",
        "Davis",
        "Miller",
        "Wilson",
        "Moore",
        "Taylor",
        "Anderson",
        "Thomas",
    ]
    restrictions = DEFAULT_DATASETS["food_restrictions"]
    restriction_map = {row.name: row.id for row in db.query(FoodRestriction).all()}
    default_restriction_id = restriction_map.get("None")

    client_counter = 1
    for i, (state_code, city) in enumerate(site_seed, start=1):
        site_code, site_name = derive_site_fields(db, state_code, city)
        site = Site(
            id=next_site_id(db),
            state_code=state_code,
            city=city,
            site_code=site_code,
            name=site_name,
            address=f"{100 + i} Community Lane, {city}, {state_code}",
        )
        db.add(site)
        db.flush()

        for j in range(20):
            first_name = first_names[(client_counter + j) % len(first_names)]
            last_name = last_names[(client_counter + j * 2) % len(last_names)]
            # Format: [client_id 2-digit][site_id 2-digit] [Last] [First 2 chars]
            code = f"{int(client_counter):02d}{int(site.id):02d} {last_name} {first_name[:2]}"
            restriction = restrictions[(client_counter + j) % len(restrictions)]
            db.add(
                Client(
                    site_id=site.id,
                    restriction_id=restriction_map.get(restriction, default_restriction_id),
                    client_code=code,
                    first_name=first_name,
                    last_name=last_name,
                    special_notes="Prefers afternoon delivery" if j % 3 == 0 else "",
                )
            )
            client_counter += 1


def seed_ingredients(db: Session):
    if db.query(Ingredient).count() > 0:
        return

    groceries = [
        ("Chicken Breast", "Meat", "CHICK-001", "lb", 220, 65, 6, 2.8, "USD / lb", 5),
        ("Ground Turkey", "Meat", "TURKY-001", "lb", 180, 55, 5, 3.1, "USD / lb", 4),
        ("Whole Milk", "Dairy", "MILK-001", "gallon", 30, 12, 14, 3.2, "USD / gallon", 14),
        ("Broccoli", "Produce", "BROCC-001", "lb", 140, 45, 7, 1.6, "USD / lb", 6),
        ("Carrots", "Produce", "CARRT-001", "lb", 110, 35, 21, 1.1, "USD / lb", 15),
        ("Spinach", "Produce", "SPINA-001", "lb", 75, 30, 6, 2.1, "USD / lb", 5),
        ("Apples", "Fruit", "APPLE-001", "lb", 160, 50, 30, 1.3, "USD / lb", 22),
        ("Bananas", "Fruit", "BANAN-001", "lb", 120, 40, 10, 0.9, "USD / lb", 8),
        ("Blueberries", "Fruit", "BERRY-001", "lb", 55, 20, 7, 3.5, "USD / lb", 7),
        ("All-Purpose Flour", "Flour", "FLOUR-001", "lb", 300, 80, 180, 0.6, "USD / lb", 150),
        ("Granulated Sugar", "Sugar", "SUGAR-001", "lb", 250, 70, 365, 0.8, "USD / lb", 330),
        ("Brown Rice", "Dry Goods", "RICE-001", "lb", 400, 110, 365, 1.2, "USD / lb", 300),
        ("Olive Oil", "Dry Goods", "OIL-001", "liter", 50, 16, 365, 6.0, "USD / liter", 260),
        ("Eggs", "Dairy", "EGG-001", "count", 600, 180, 30, 0.25, "USD / count", 20),
        ("Black Beans", "Dry Goods", "BEAN-001", "lb", 175, 50, 365, 1.0, "USD / lb", 320),
        ("Cheddar Cheese", "Dairy", "CHED-001", "lb", 80, 25, 25, 2.9, "USD / lb", 18),
    ]

    for item in groceries:
        name, category, barcode, unit, qty, reorder, shelf_life, unit_cost, cost_unit, expiry_days = item
        db.add(
            Ingredient(
                name=name,
                category=resolve_ingredient_category_id(category, db),
                barcode=barcode,
                unit=unit,
                quantity_on_hand=qty,
                reorder_level=reorder,
                shelf_life_days=shelf_life,
                expiration_date=date.today() + timedelta(days=expiry_days),
                default_unit_cost=unit_cost,
                cost_unit=cost_unit,
            )
        )


def seed_meals(db: Session):
    if db.query(Meal).count() > 0:
        return

    ingredient_map = {ingredient.name: ingredient for ingredient in db.query(Ingredient).all()}

    meal_recipes = [
        ("Grilled Chicken Bowl", "01", [("Chicken Breast", 0.55), ("Brown Rice", 0.35), ("Broccoli", 0.2)]),
        ("Turkey & Spinach Plate", "02", [("Ground Turkey", 0.5), ("Spinach", 0.18), ("Carrots", 0.2)]),
        ("Veggie Rice Plate", "08", [("Brown Rice", 0.4), ("Broccoli", 0.22), ("Carrots", 0.15), ("Black Beans", 0.2)]),
        ("Breakfast Egg Scramble", "01", [("Eggs", 2.0), ("Spinach", 0.08), ("Cheddar Cheese", 0.05)]),
        ("Apple Oat Snack Cup", "03,08", [("Apples", 0.25), ("Whole Milk", 0.1), ("Granulated Sugar", 0.03)]),
    ]

    for meal_name, restriction, lines in meal_recipes:
        meal = Meal(name=meal_name, restriction=restriction)
        db.add(meal)
        db.flush()
        for ingredient_name, per_serving in lines:
            ingredient = ingredient_map.get(ingredient_name)
            if ingredient:
                db.add(
                    MealIngredient(
                        meal_id=meal.id,
                        ingredient_id=ingredient.id,
                        quantity_per_serving=per_serving,
                    )
                )


def seed_users(db: Session):
    if db.query(User).count() == 0:
        db.add_all(
            [
                User(username="root.admin", role="Root"),
                User(username="ops.manager", role="Mgmt"),
                User(username="field.rep", role="Rep"),
            ]
        )


def seed_if_empty(db: Session):
    # Seed all core datasets and demo data if first run.
    ensure_units(db)
    ensure_cost_units(db)
    ensure_unit_cost_options(db)
    ensure_order_statuses(db)
    ensure_meal_types(db)
    ensure_suppliers(db)
    ensure_food_restrictions(db)
    ensure_ingredient_categories(db)
    seed_users(db)
    seed_sites_and_clients(db)
    seed_ingredients(db)
    seed_meals(db)
    db.commit()


@app.on_event("startup")
def startup_seed():
    # Startup hook: seed database once when server boots.
    app.state.demo_started_at = datetime.utcnow()
    db = SessionLocal()
    try:
        seed_if_empty(db)
        repair_null_ingredient_ids(db)
        migrate_meals_enforce_non_null_ids()
    finally:
        db.close()


@app.get("/")
def read_root():
    # Health endpoint for quick sanity checks.
    return {"status": "ok", "app": "Kitchen Food Inventory", "version": app.version}


@app.get("/demo/bootstrap")
def demo_bootstrap(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Ensures seed data exists before live demo.
    seed_if_empty(db)
    return {"status": "ready", "message": "Demo data verified"}


@app.get("/demo/time", response_model=DemoTimeOut)
def read_demo_time(_: str = Depends(authorize("Rep"))):
    # Returns fast-moving demo clock information.
    days = get_demo_days_elapsed()
    return DemoTimeOut(
        seconds_since_demo_start=days,
        demo_days_elapsed=days,
        demo_date=get_demo_date(),
    )


@app.get("/roles")
def read_roles():
    # UI can use this list to show role options.
    return ["Root", "Mgmt", "Rep"]


@app.get("/ingredient-categories", response_model=List[IngredientCategoryOut])
def read_ingredient_categories(
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Rep")),
):
    # Return ingredient categories for Add Ingredient dropdown.
    return db.query(IngredientCategory).order_by(IngredientCategory.name.asc()).all()


@app.post("/ingredient-categories", response_model=IngredientCategoryOut)
def add_ingredient_category(
    payload: IngredientCategoryCreate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Add custom ingredient category.
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")

    exists = db.query(IngredientCategory).filter(IngredientCategory.name == name).first()
    if exists:
        return exists

    row = IngredientCategory(id=next_ingredient_category_id(db), name=name)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.get("/datasets/{dataset_key}", response_model=List[DatasetOptionOut])
def read_dataset_options(
    dataset_key: str,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Rep")),
):
    # Backward-compatible dataset API backed by normalized tables/constants.
    if dataset_key == "measurement_units":
        rows = db.query(Unit).order_by(Unit.name.asc()).all()
        return [
            DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)
            for row in rows
        ]
    if dataset_key == "suppliers":
        rows = db.query(Supplier).order_by(Supplier.name.asc()).all()
        return [
            DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)
            for row in rows
        ]
    if dataset_key == "food_restrictions":
        rows = db.query(FoodRestriction).order_by(FoodRestriction.name.asc()).all()
        return [
            DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)
            for row in rows
        ]
    if dataset_key == "order_statuses":
        rows = db.query(POStatus).order_by(POStatus.id.asc()).all()
        return [
            DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)
            for row in rows
        ]
    if dataset_key == "meal_types":
        rows = db.query(MealType).order_by(MealType.id.asc()).all()
        return [
            DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)
            for row in rows
        ]
    if dataset_key == "cost_units":
        rows = db.query(CostUnit).order_by(CostUnit.id.asc()).all()
        return [
            DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)
            for row in rows
        ]
    if dataset_key == "unit_cost_options":
        rows = db.query(UnitCostOption).order_by(UnitCostOption.id.asc()).all()
        return [
            DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)
            for row in rows
        ]
    return []


@app.post("/datasets/{dataset_key}", response_model=DatasetOptionOut)
def add_dataset_option(
    dataset_key: str,
    payload: DatasetOptionCreate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Add custom option to the normalized source table for this key.
    label = (payload.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Label is required")

    if dataset_key == "measurement_units":
        exists = db.query(Unit).filter(Unit.name == label).first()
        if exists:
            return DatasetOptionOut(id=int(exists.id), dataset_key=dataset_key, label=exists.name, value=exists.name)
        row = Unit(id=next_lookup_id(db, Unit), name=label)
        db.add(row)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=f"Unable to save ingredient: {exc.orig}")
        db.refresh(row)
        return DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)

    if dataset_key == "food_restrictions":
        exists = db.query(FoodRestriction).filter(FoodRestriction.name == label).first()
        if exists:
            return DatasetOptionOut(id=int(exists.id), dataset_key=dataset_key, label=exists.name, value=exists.name)
        row = FoodRestriction(id=next_lookup_id(db, FoodRestriction), name=label)
        db.add(row)
        db.commit()
        db.refresh(row)
        return DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)

    if dataset_key == "order_statuses":
        exists = db.query(POStatus).filter(POStatus.name == label).first()
        if exists:
            return DatasetOptionOut(id=int(exists.id), dataset_key=dataset_key, label=exists.name, value=exists.name)
        row = POStatus(id=next_lookup_id(db, POStatus), name=label)
        db.add(row)
        db.commit()
        db.refresh(row)
        return DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)

    if dataset_key == "meal_types":
        exists = db.query(MealType).filter(MealType.name == label).first()
        if exists:
            return DatasetOptionOut(id=int(exists.id), dataset_key=dataset_key, label=exists.name, value=exists.name)
        row = MealType(id=next_lookup_id(db, MealType), name=label)
        db.add(row)
        db.commit()
        db.refresh(row)
        return DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)

    if dataset_key == "cost_units":
        exists = db.query(CostUnit).filter(CostUnit.name == label).first()
        if exists:
            return DatasetOptionOut(id=int(exists.id), dataset_key=dataset_key, label=exists.name, value=exists.name)
        row = CostUnit(id=next_lookup_id(db, CostUnit), name=label)
        db.add(row)
        db.commit()
        db.refresh(row)
        return DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)

    if dataset_key == "unit_cost_options":
        exists = db.query(UnitCostOption).filter(UnitCostOption.name == label).first()
        if exists:
            return DatasetOptionOut(id=int(exists.id), dataset_key=dataset_key, label=exists.name, value=exists.name)
        row = UnitCostOption(id=next_lookup_id(db, UnitCostOption), name=label)
        db.add(row)
        db.commit()
        db.refresh(row)
        return DatasetOptionOut(id=int(row.id), dataset_key=dataset_key, label=row.name, value=row.name)

    raise HTTPException(status_code=400, detail=f"Dataset '{dataset_key}' is read-only or managed by a dedicated table")


@app.get("/sites", response_model=List[SiteOut])
def read_sites(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # List all sites for dropdowns and reports.
    return db.query(Site).order_by(Site.id).all()


@app.post("/sites", response_model=SiteOut)
def create_site(
    payload: SiteCreate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Derive site_code and name from state/city. id is generated sequentially.
    state = payload.state_code.strip().upper()
    city = payload.city.strip()
    address = payload.address.strip()
    if not address:
        raise HTTPException(status_code=400, detail="address is required")

    site_code, site_name = derive_site_fields(db, state, city)
    row = Site(
        id=next_site_id(db),
        state_code=state,
        city=city,
        site_code=site_code,
        name=site_name,
        address=address,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Unable to save ingredient: {exc.orig}")
    db.refresh(row)
    return row


@app.get("/clients", response_model=List[ClientOut])
def read_clients(
    site_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Rep")),
):
    # Optional filter: only clients in one site.
    client_query = db.query(Client).options(joinedload(Client.site), joinedload(Client.food_restriction))
    if site_id is not None:
        client_query = client_query.filter(Client.site_id == site_id)

    clients = client_query.order_by(Client.client_code.asc()).all()

    # Precompute meal history count for each client from deliveries.
    counts = dict(
        db.query(MealDelivery.client_id, func.count(MealDelivery.id))
        .group_by(MealDelivery.client_id)
        .all()
    )

    return [
        ClientOut(
            id=client.id,
            site_id=client.site_id,
            site_name=client.site.name,
            client_code=client.client_code,
            first_name=client.first_name,
            last_name=client.last_name,
            display_name=f"[{client.client_code}] {client.last_name}, {client.first_name}",
            food_restrictions=client.food_restriction.name if client.food_restriction else "None",
            special_notes=client.special_notes,
            meal_history_count=int(counts.get(client.id, 0)),
        )
        for client in clients
    ]


@app.get("/ingredients", response_model=List[IngredientOut])
def read_ingredients(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Full inventory list.
    repair_null_ingredient_ids(db)
    ref_date = get_demo_date()
    rows = db.query(Ingredient).filter(Ingredient.id.isnot(None)).order_by(Ingredient.name).all()
    result: list[IngredientOut] = []
    for row in rows:
        if row is None or getattr(row, "id", None) in (None, ""):
            continue
        result.append(ingredient_to_schema(row, ref_date, db))
    return result


@app.post("/ingredients", response_model=IngredientOut)
def create_ingredient(
    payload: IngredientCreate,
    overwrite: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    repair_null_ingredient_ids(db)
    existing_by_name = db.query(Ingredient).filter(Ingredient.name == payload.name).first()
    existing_by_barcode = db.query(Ingredient).filter(Ingredient.barcode == payload.barcode).first()

    # If name exists, only overwrite when explicitly requested.
    if existing_by_name:
        if not overwrite:
            raise HTTPException(
                status_code=409,
                detail="Ingredient name already exists. Use overwrite=true or submit a different name.",
            )
        if existing_by_barcode and existing_by_barcode.id != existing_by_name.id:
            raise HTTPException(status_code=400, detail="Barcode already exists")

        payload_data = payload.dict()
        payload_data["category"] = resolve_ingredient_category_id(payload_data.get("category", ""), db)
        payload_data["shelf_life_days"] = payload_data.get("shelf_life_days") or 30
        for key, value in payload_data.items():
            setattr(existing_by_name, key, value)
        db.commit()
        try:
            db.refresh(existing_by_name)
            row = existing_by_name
        except InvalidRequestError:
            # Fallback for legacy SQLite PK type drift (TEXT id vs ORM Integer id).
            row = db.query(Ingredient).filter(Ingredient.name == payload.name).first()
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to load saved ingredient row")
        return ingredient_to_schema(row, get_demo_date(), db)

    # New ingredient path still enforces unique barcode.
    if existing_by_barcode:
        raise HTTPException(status_code=400, detail="Barcode already exists")

    payload_data = payload.dict()
    payload_data["category"] = resolve_ingredient_category_id(payload_data.get("category", ""), db)
    payload_data["shelf_life_days"] = payload_data.get("shelf_life_days") or 30
    new_id = next_lookup_id(db, Ingredient)
    # Use explicit SQL insert so id is always written even under ORM/SQLite PK type drift.
    db.execute(
        text(
            """
            INSERT INTO ingredients (
                id, name, category, barcode, unit, quantity_on_hand, reorder_level,
                shelf_life_days, expiration_date, default_unit_cost, cost_unit
            ) VALUES (
                :id, :name, :category, :barcode, :unit, :quantity_on_hand, :reorder_level,
                :shelf_life_days, :expiration_date, :default_unit_cost, :cost_unit
            )
            """
        ),
        {
            "id": new_id,
            "name": payload_data["name"],
            "category": payload_data["category"],
            "barcode": payload_data["barcode"],
            "unit": payload_data["unit"],
            "quantity_on_hand": payload_data["quantity_on_hand"],
            "reorder_level": payload_data["reorder_level"],
            "shelf_life_days": payload_data["shelf_life_days"],
            "expiration_date": payload_data["expiration_date"],
            "default_unit_cost": payload_data["default_unit_cost"],
            "cost_unit": payload_data["cost_unit"],
        },
    )
    db.commit()
    row = db.query(Ingredient).filter(Ingredient.barcode == payload.barcode).first()
    if row is None:
        row = db.query(Ingredient).filter(Ingredient.name == payload.name).first()
    if row is None:
        raise HTTPException(status_code=500, detail="Ingredient saved but could not be reloaded")
    return ingredient_to_schema(row, get_demo_date(), db)


@app.patch("/ingredients/{ingredient_id}", response_model=IngredientOut)
def update_ingredient(
    ingredient_id: int,
    payload: IngredientUpdate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Find ingredient row by id.
    ingredient = db.query(Ingredient).filter(Ingredient.id == ingredient_id).first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")

    # Only update fields user actually sent.
    updates = payload.dict(exclude_unset=True)
    if "category" in updates:
        updates["category"] = resolve_ingredient_category_id(updates["category"], db)
    for key, value in updates.items():
        setattr(ingredient, key, value)

    db.commit()
    try:
        db.refresh(ingredient)
        row = ingredient
    except InvalidRequestError:
        row = db.query(Ingredient).filter(Ingredient.barcode == ingredient.barcode).first()
    return ingredient_to_schema(row, get_demo_date(), db)


@app.get("/inventory/low", response_model=List[IngredientOut])
def read_low_inventory(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Ingredients at or below reorder threshold.
    repair_null_ingredient_ids(db)
    rows = (
        db.query(Ingredient)
        .filter(Ingredient.id.isnot(None), Ingredient.quantity_on_hand <= Ingredient.reorder_level)
        .order_by(Ingredient.quantity_on_hand.asc())
        .all()
    )
    result: list[IngredientOut] = []
    for row in rows:
        if row is None or getattr(row, "id", None) in (None, ""):
            continue
        result.append(ingredient_to_schema(row, get_demo_date(), db))
    return result


@app.get("/inventory/expiring", response_model=List[IngredientOut])
def read_expiring_inventory(
    increment_type: str = Query(default="days", pattern="^(days|months)$"),
    increment_value: int = Query(default=14, ge=1, le=24),
    demo_clock: bool = Query(default=True),
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Rep")),
):
    # Show ingredients expiring by days or months, with optional fast demo clock.
    repair_null_ingredient_ids(db)
    ref_date = get_demo_date() if demo_clock else date.today()
    days = increment_value if increment_type == "days" else increment_value * 30
    cutoff = ref_date + timedelta(days=days)

    rows = (
        db.query(Ingredient)
        .filter(Ingredient.id.isnot(None), Ingredient.expiration_date.isnot(None), Ingredient.expiration_date <= cutoff)
        .order_by(Ingredient.expiration_date.asc())
        .all()
    )
    result: list[IngredientOut] = []
    for row in rows:
        if row is None or getattr(row, "id", None) in (None, ""):
            continue
        result.append(ingredient_to_schema(row, ref_date, db))
    return result


@app.get("/meals", response_model=List[MealOut])
def read_meals(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # joinedload avoids many tiny queries when reading nested ingredient lines.
    migrate_meals_enforce_non_null_ids()
    meals = db.query(Meal).options(joinedload(Meal.ingredients).joinedload(MealIngredient.ingredient)).all()
    return [meal_to_schema(meal) for meal in meals]


@app.post("/meals", response_model=MealOut)
def create_meal(
    payload: MealCreate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    migrate_meals_enforce_non_null_ids()
    # Avoid duplicate meal names.
    if db.query(Meal).filter(Meal.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Meal name already exists")
    if not payload.ingredients:
        raise HTTPException(status_code=400, detail="At least one ingredient line is required")

    # Validate that all ingredient IDs exist.
    ingredient_ids = [line.ingredient_id for line in payload.ingredients]
    found_ingredients = db.query(Ingredient).filter(Ingredient.id.in_(ingredient_ids)).all()
    if len(found_ingredients) != len(set(ingredient_ids)):
        raise HTTPException(status_code=400, detail="One or more ingredient IDs are invalid")

    # Create meal header + lines using explicit IDs to avoid ORM/SQLite PK drift.
    restriction = normalize_meal_restriction_ids(payload.restriction, db)
    meal_id = next_lookup_id(db, Meal)
    db.execute(
        text(
            """
            INSERT INTO meals (id, name, restriction)
            VALUES (:id, :name, :restriction)
            """
        ),
        {"id": meal_id, "name": payload.name, "restriction": restriction},
    )
    for line in payload.ingredients:
        line_id = next_lookup_id(db, MealIngredient)
        db.execute(
            text(
                """
                INSERT INTO meal_ingredients (id, meal_id, ingredient_id, quantity_per_serving)
                VALUES (:id, :meal_id, :ingredient_id, :quantity_per_serving)
                """
            ),
            {
                "id": line_id,
                "meal_id": meal_id,
                "ingredient_id": f"{int(line.ingredient_id):02d}",
                "quantity_per_serving": line.quantity_per_serving,
            },
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Unable to save meal: {exc.orig}")

    # Re-read with relationships loaded for clean response.
    meal = (
        db.query(Meal)
        .options(joinedload(Meal.ingredients).joinedload(MealIngredient.ingredient))
        .filter(Meal.id == meal_id)
        .first()
    )
    return meal_to_schema(meal)


@app.get("/arrivals", response_model=List[FoodArrivalOut])
def read_arrivals(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Most recent scans first.
    rows = db.query(FoodArrival).options(joinedload(FoodArrival.ingredient)).order_by(FoodArrival.arrived_at.desc()).all()
    return [
        FoodArrivalOut(
            id=row.id,
            ingredient_id=row.ingredient_id,
            ingredient_name=row.ingredient.name,
            barcode=row.barcode,
            quantity_received=row.quantity_received,
            expiration_date=row.expiration_date,
            unit_cost=parse_currency_to_float(row.unit_cost),
            cost_unit=row.cost_unit,
            arrived_at=row.arrived_at,
        )
        for row in rows
    ]


@app.post("/arrivals/scan", response_model=FoodArrivalOut)
def scan_arrival(
    payload: FoodArrivalScan,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Find ingredient by scanned barcode.
    ingredient = db.query(Ingredient).filter(Ingredient.barcode == payload.barcode).first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Barcode not found")

    # Add received quantity to live inventory.
    ingredient.quantity_on_hand += payload.quantity_received

    # Keep the earliest (soonest) expiration date for safety.
    if payload.expiration_date:
        if ingredient.expiration_date is None or payload.expiration_date < ingredient.expiration_date:
            ingredient.expiration_date = payload.expiration_date

    # Save arrival log row for traceability.
    arrival = FoodArrival(
        ingredient_id=ingredient.id,
        barcode=payload.barcode,
        quantity_received=payload.quantity_received,
        expiration_date=payload.expiration_date,
        unit_cost=payload.unit_cost,
        cost_unit=payload.cost_unit or ingredient.cost_unit,
    )
    db.add(arrival)
    db.commit()
    db.refresh(arrival)

    return FoodArrivalOut(
        id=arrival.id,
        ingredient_id=arrival.ingredient_id,
        ingredient_name=ingredient.name,
        barcode=arrival.barcode,
        quantity_received=arrival.quantity_received,
        expiration_date=arrival.expiration_date,
        unit_cost=parse_currency_to_float(arrival.unit_cost),
        cost_unit=arrival.cost_unit,
        arrived_at=arrival.arrived_at,
    )


@app.get("/meal-productions", response_model=List[MealProductionOut])
def read_meal_productions(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # List production batches newest first.
    rows = db.query(MealProduction).options(joinedload(MealProduction.meal)).order_by(MealProduction.produced_at.desc()).all()
    return [
        MealProductionOut(
            id=row.id,
            meal_id=row.meal_id,
            meal_name=row.meal.name,
            servings=row.servings,
            produced_at=row.produced_at,
        )
        for row in rows
    ]


@app.post("/meal-productions", response_model=MealProductionOut)
def create_meal_production(
    payload: MealProductionCreate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Load meal and its ingredient recipe lines.
    meal = (
        db.query(Meal)
        .options(joinedload(Meal.ingredients).joinedload(MealIngredient.ingredient))
        .filter(Meal.id == payload.meal_id)
        .first()
    )
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    if not meal.ingredients:
        raise HTTPException(status_code=400, detail="Meal has no ingredient mapping")

    # Validate ingredient stock before deducting anything.
    for line in meal.ingredients:
        required = line.quantity_per_serving * payload.servings
        if line.ingredient.quantity_on_hand < required:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient inventory for {line.ingredient.name}. Required {required} {line.ingredient.unit}",
            )

    # Create one production header row.
    production = MealProduction(meal_id=meal.id, servings=payload.servings)
    db.add(production)
    db.flush()

    # Deduct inventory and log ingredient usage.
    for line in meal.ingredients:
        required = line.quantity_per_serving * payload.servings
        line.ingredient.quantity_on_hand -= required
        db.add(
            IngredientUsage(
                production_id=production.id,
                meal_id=meal.id,
                ingredient_id=line.ingredient_id,
                quantity_used=required,
            )
        )

    db.commit()
    db.refresh(production)

    return MealProductionOut(
        id=production.id,
        meal_id=production.meal_id,
        meal_name=meal.name,
        servings=production.servings,
        produced_at=production.produced_at,
    )


@app.get("/ingredient-usage", response_model=List[IngredientUsageOut])
def read_ingredient_usage(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Historical ingredient consumption report.
    rows = db.query(IngredientUsage).options(joinedload(IngredientUsage.ingredient)).order_by(IngredientUsage.used_at.desc()).all()
    return [
        IngredientUsageOut(
            id=row.id,
            production_id=row.production_id,
            meal_id=row.meal_id,
            ingredient_id=row.ingredient_id,
            ingredient_name=row.ingredient.name,
            quantity_used=row.quantity_used,
            used_at=row.used_at,
        )
        for row in rows
    ]


@app.get("/purchase-orders", response_model=List[PurchaseOrderOut])
def read_purchase_orders(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Return all POs with their line items.
    rows = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.ingredient))
        .order_by(PurchaseOrder.created_at.desc())
        .all()
    )
    return [purchase_order_to_schema(po) for po in rows]


@app.post("/purchase-orders", response_model=PurchaseOrderOut)
def create_purchase_order(
    payload: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Validate ingredient IDs in PO lines.
    ingredient_ids = [line.ingredient_id for line in payload.items]
    found_ingredients = db.query(Ingredient).filter(Ingredient.id.in_(ingredient_ids)).all()
    if len(found_ingredients) != len(set(ingredient_ids)):
        raise HTTPException(status_code=400, detail="One or more ingredient IDs are invalid")

    supplier_exists = db.query(Supplier).filter(Supplier.name == payload.supplier).first()
    if not supplier_exists:
        raise HTTPException(status_code=400, detail="Invalid supplier")

    # Validate/resolve status through po_status table (status stored as POStatus.id).
    status_row = (
        db.query(POStatus)
        .filter((POStatus.id == payload.po_status) | (POStatus.name == payload.po_status))
        .first()
    )
    if not status_row:
        raise HTTPException(status_code=400, detail="Invalid order status")

    # Create PO header.
    po = PurchaseOrder(supplier=payload.supplier, po_status=status_row.id)
    db.add(po)
    db.flush()

    # Create PO lines.
    for line in payload.items:
        db.add(
            PurchaseOrderItem(
                purchase_order_id=po.id,
                ingredient_id=line.ingredient_id,
                quantity_ordered=line.quantity_ordered,
                unit_cost=line.unit_cost,
                cost_unit=line.cost_unit,
            )
        )

    db.commit()

    # Re-read for full nested response.
    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.ingredient))
        .filter(PurchaseOrder.id == po.id)
        .first()
    )
    return purchase_order_to_schema(po)


@app.post("/purchase-orders/{purchase_order_id}/status", response_model=PurchaseOrderOut)
def set_purchase_order_status(
    purchase_order_id: int,
    po_status: str = Query(...),
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Find existing PO and update status.
    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.ingredient))
        .filter(PurchaseOrder.id == purchase_order_id)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    status_row = db.query(POStatus).filter((POStatus.id == po_status) | (POStatus.name == po_status)).first()
    if not status_row:
        raise HTTPException(status_code=400, detail="Invalid order status")

    po.po_status = status_row.id
    db.commit()
    db.refresh(po)
    return purchase_order_to_schema(po)


@app.get("/deliveries", response_model=List[MealDeliveryOut])
def read_deliveries(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Return all delivery records with site/client/meal names.
    rows = (
        db.query(MealDelivery)
        .options(joinedload(MealDelivery.meal), joinedload(MealDelivery.site), joinedload(MealDelivery.client))
        .order_by(MealDelivery.delivered_at.desc())
        .all()
    )
    return [
        MealDeliveryOut(
            id=row.id,
            meal_id=row.meal_id,
            meal_name=row.meal.name,
            site_id=row.site_id,
            site_name=row.site.name,
            client_id=row.client_id,
            client_name=f"[{row.client.client_code}] {row.client.last_name}, {row.client.first_name}",
            quantity=row.quantity,
            delivered_at=row.delivered_at,
        )
        for row in rows
    ]


@app.post("/deliveries", response_model=MealDeliveryOut)
def create_delivery(
    payload: MealDeliveryCreate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Rep")),
):
    # Validate referenced meal/site/client rows.
    meal = db.query(Meal).filter(Meal.id == payload.meal_id).first()
    site = db.query(Site).filter(Site.id == payload.site_id).first()
    client = db.query(Client).filter(Client.id == payload.client_id).first()

    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    # Extra data integrity rule: client must belong to chosen site.
    if client.site_id != site.id:
        raise HTTPException(status_code=400, detail="Client is not in selected site")

    # Save delivery event.
    delivery = MealDelivery(
        meal_id=payload.meal_id,
        site_id=payload.site_id,
        client_id=payload.client_id,
        quantity=payload.quantity,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)

    return MealDeliveryOut(
        id=delivery.id,
        meal_id=meal.id,
        meal_name=meal.name,
        site_id=site.id,
        site_name=site.name,
        client_id=client.id,
        client_name=f"[{client.client_code}] {client.last_name}, {client.first_name}",
        quantity=delivery.quantity,
        delivered_at=delivery.delivered_at,
    )


@app.get("/reports/dashboard", response_model=DashboardReport)
def read_dashboard_report(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Aggregated count cards for frontend dashboard.
    return DashboardReport(
        total_ingredients=db.query(func.count(Ingredient.id)).scalar() or 0,
        total_meals=db.query(func.count(Meal.id)).scalar() or 0,
        total_clients=db.query(func.count(Client.id)).scalar() or 0,
        total_sites=db.query(func.count(Site.id)).scalar() or 0,
        open_purchase_orders=db.query(func.count(PurchaseOrder.id)).filter(PurchaseOrder.po_status != "06").scalar() or 0,
        total_deliveries=db.query(func.count(MealDelivery.id)).scalar() or 0,
        low_stock_count=db.query(func.count(Ingredient.id)).filter(Ingredient.quantity_on_hand <= Ingredient.reorder_level).scalar() or 0,
    )


@app.get("/reports/site-deliveries", response_model=List[SiteDeliveryReport])
def read_site_delivery_report(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Group deliveries by site for reporting table.
    rows = (
        db.query(
            Site.id.label("site_id"),
            Site.name.label("site_name"),
            func.coalesce(func.sum(MealDelivery.quantity), 0).label("meals_delivered"),
            func.count(func.distinct(MealDelivery.client_id)).label("clients_served"),
        )
        .outerjoin(MealDelivery, MealDelivery.site_id == Site.id)
        .group_by(Site.id)
        .order_by(Site.id)
        .all()
    )

    # Convert SQL row objects into API schema rows.
    return [
        SiteDeliveryReport(
            site_id=row.site_id,
            site_name=row.site_name,
            meals_delivered=int(row.meals_delivered or 0),
            clients_served=int(row.clients_served or 0),
        )
        for row in rows
    ]


@app.get("/reports/client-meal-history/{client_id}")
def read_client_meal_history(
    client_id: int,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Rep")),
):
    # Client-level meal history report.
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    rows = (
        db.query(MealDelivery)
        .options(joinedload(MealDelivery.meal))
        .filter(MealDelivery.client_id == client_id)
        .order_by(MealDelivery.delivered_at.desc())
        .all()
    )

    return {
        "client": f"[{client.client_code}] {client.last_name}, {client.first_name}",
        "history": [
            {
                "meal": row.meal.name,
                "quantity": row.quantity,
                "delivered_at": row.delivered_at,
            }
            for row in rows
        ],
    }
