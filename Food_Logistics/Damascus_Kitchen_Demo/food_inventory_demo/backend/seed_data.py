from datetime import date, datetime, timedelta

from backend.database import Base, SessionLocal, engine
from backend.models import (
    Client,
    FoodArrival,
    FoodRestriction,
    Ingredient,
    IngredientCategory,
    IngredientUsage,
    Meal,
    MealDelivery,
    MealIngredient,
    MealProduction,
    PurchaseOrder,
    PurchaseOrderItem,
    Site,
    Supplier,
    Unit,
    POStatus,
    User,
)


DEFAULT_DATASETS = {
    "measurement_units": [
        "count",
        "oz",
        "lb",
        "g",
        "kg",
        "ml",
        "liter",
        "cup",
        "tbsp",
        "tsp",
        "gallon",
    ],
    "cost_units": ["USD / count", "USD / oz", "USD / lb", "USD / kg", "USD / liter", "USD / gallon"],
    "unit_cost_options": ["0.25", "0.50", "0.75", "1.00", "1.50", "2.00", "2.50", "3.00", "4.50", "5.00"],
    "suppliers": ["FreshFields Produce", "Metro Protein Supply", "Golden Grain Foods", "Luna Dairy Co.", "Harbor Wholesale"],
    "order_statuses": ["Draft", "Submitted", "Approved", "In Transit", "Delivered", "Closed"],
    "food_restrictions": ["None", "Low Sodium", "Diabetic", "Gluten Free", "Dairy Free", "Nut Allergy", "Halal", "Vegetarian"],
    "meal_types": ["Breakfast", "Lunch", "Dinner", "Snack", "Diabetic", "Low Sodium", "Vegetarian"],
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


def next_lookup_id(db, model):
    rows = db.query(model.id).all()
    max_id = 0
    for (raw_id,) in rows:
        try:
            max_id = max(max_id, int(raw_id))
        except (TypeError, ValueError):
            continue
    return f"{max_id + 1:02d}"


def seed_units(db):
    existing = {row.name for row in db.query(Unit).all()}
    for name in DEFAULT_DATASETS["measurement_units"]:
        if name not in existing:
            db.add(Unit(id=next_lookup_id(db, Unit), name=name))
            db.flush()
            existing.add(name)


def seed_order_statuses(db):
    existing = {row.name for row in db.query(POStatus).all()}
    for name in DEFAULT_DATASETS["order_statuses"]:
        if name not in existing:
            db.add(POStatus(id=next_lookup_id(db, POStatus), name=name))
            db.flush()
            existing.add(name)


def seed_suppliers(db):
    if db.query(Supplier).count() > 0:
        return
    seed = [
        ("01", "TX", "Dallas", "800 Trinity Mills Rd, Dallas, TX 75287", "Sysco Corporation"),
        ("02", "VA", "Arlington", "3033 Wilson Blvd, Arlington, VA 22201", "US Foods Holding Corp."),
        ("03", "PA", "Philadelphia", "1701 Market St, Philadelphia, PA 19103", "WebstaurantStore"),
    ]
    for row in seed:
        db.add(Supplier(id=row[0], st=row[1], city=row[2], address=row[3], name=row[4]))


def seed_ingredient_categories(db):
    existing = {row.name for row in db.query(IngredientCategory).all()}
    rows = db.query(IngredientCategory.id).all()
    max_id = 0
    for (raw_id,) in rows:
        try:
            max_id = max(max_id, int(raw_id))
        except (TypeError, ValueError):
            continue

    for name in DEFAULT_INGREDIENT_CATEGORIES:
        if name not in existing:
            max_id += 1
            db.add(IngredientCategory(id=f"{max_id:02d}", name=name))


def seed_users(db):
    if db.query(User).count() > 0:
        return
    db.add_all(
        [
            User(username="root.admin", role="Root"),
            User(username="ops.manager", role="Mgmt"),
            User(username="field.rep", role="Rep"),
        ]
    )


def seed_food_restrictions(db):
    existing = {row.name for row in db.query(FoodRestriction).all()}
    rows = db.query(FoodRestriction.id).all()
    max_id = 0
    for (raw_id,) in rows:
        try:
            max_id = max(max_id, int(raw_id))
        except (TypeError, ValueError):
            continue

    for name in DEFAULT_DATASETS["food_restrictions"]:
        if name not in existing:
            max_id += 1
            db.add(FoodRestriction(id=f"{max_id:02d}", name=name))
            existing.add(name)


def next_site_id(db):
    rows = db.query(Site.id).all()
    max_id = 0
    for (raw_id,) in rows:
        try:
            max_id = max(max_id, int(raw_id))
        except (TypeError, ValueError):
            continue
    return f"{max_id + 1:02d}"


def derive_site_fields(db, state_code, city):
    state = (state_code or "").strip().upper()
    clean_city = (city or "").strip()
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
    return f"{state}-{seq:02d}", f"{state} - {clean_city} {seq:02d}"


def seed_sites_and_clients(db):
    if db.query(Site).count() > 0:
        return

    site_seed = [
        ("CA", "San Diego"),
        ("CA", "Los Angeles"),
        ("AZ", "Phoenix"),
        ("NV", "Las Vegas"),
        ("TX", "Dallas"),
    ]

    first_names = ["Avery", "Jordan", "Taylor", "Morgan", "Riley", "Casey", "Cameron", "Parker"]
    last_names = ["Johnson", "Williams", "Brown", "Davis", "Miller", "Wilson", "Moore", "Thomas"]
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

        for j in range(8):
            first_name = first_names[(client_counter + j) % len(first_names)]
            last_name = last_names[(client_counter + j * 2) % len(last_names)]
            client_code = f"{int(client_counter):02d}{int(site.id):02d} {last_name} {first_name[:2]}"
            db.add(
                Client(
                    site_id=site.id,
                    restriction_id=restriction_map.get(restrictions[(client_counter + j) % len(restrictions)], default_restriction_id),
                    client_code=client_code,
                    first_name=first_name,
                    last_name=last_name,
                    special_notes="Prefers afternoon delivery" if j % 3 == 0 else "",
                )
            )
            client_counter += 1


def seed_ingredients(db):
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
                category=category,
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


def seed_meals(db):
    if db.query(Meal).count() > 0:
        return

    ingredient_map = {ingredient.name: ingredient for ingredient in db.query(Ingredient).all()}
    meal_recipes = [
        ("Grilled Chicken Bowl", "01", [("Chicken Breast", 0.55), ("Brown Rice", 0.35), ("Broccoli", 0.2)]),
        ("Turkey & Spinach Plate", "02", [("Ground Turkey", 0.5), ("Spinach", 0.18), ("Carrots", 0.2)]),
        ("Veggie Rice Plate", "08", [("Brown Rice", 0.4), ("Broccoli", 0.22), ("Carrots", 0.15), ("Black Beans", 0.2)]),
        ("Breakfast Egg Scramble", "01", [("Eggs", 2.0), ("Spinach", 0.08), ("Cheddar Cheese", 0.05)]),
        ("Apple Snack Cup", "03,08", [("Apples", 0.25), ("Whole Milk", 0.1), ("Granulated Sugar", 0.03)]),
    ]

    for meal_name, restriction, lines in meal_recipes:
        meal = Meal(name=meal_name, restriction=restriction)
        db.add(meal)
        db.flush()
        for ingredient_name, per_serving in lines:
            ingredient = ingredient_map[ingredient_name]
            db.add(
                MealIngredient(
                    meal_id=meal.id,
                    ingredient_id=ingredient.id,
                    quantity_per_serving=per_serving,
                )
            )


def seed_food_arrivals(db):
    if db.query(FoodArrival).count() > 0:
        return

    for ingredient in db.query(Ingredient).limit(8).all():
        db.add(
            FoodArrival(
                ingredient_id=ingredient.id,
                barcode=ingredient.barcode,
                quantity_received=round(max(ingredient.reorder_level * 0.4, 10), 2),
                expiration_date=date.today() + timedelta(days=max(ingredient.shelf_life_days - 1, 2)),
                unit_cost=ingredient.default_unit_cost,
                cost_unit=ingredient.cost_unit,
                arrived_at=datetime.utcnow() - timedelta(days=1),
            )
        )


def seed_meal_production_and_usage(db):
    if db.query(MealProduction).count() > 0:
        return

    meals = db.query(Meal).all()
    for idx, meal in enumerate(meals, start=1):
        servings = 24 + idx * 6
        production = MealProduction(
            meal_id=meal.id,
            servings=servings,
            produced_at=datetime.utcnow() - timedelta(hours=idx * 2),
        )
        db.add(production)
        db.flush()

        lines = db.query(MealIngredient).filter(MealIngredient.meal_id == meal.id).all()
        for line in lines:
            db.add(
                IngredientUsage(
                    production_id=production.id,
                    meal_id=meal.id,
                    ingredient_id=line.ingredient_id,
                    quantity_used=round(line.quantity_per_serving * servings, 2),
                    used_at=production.produced_at,
                )
            )


def seed_purchase_orders(db):
    if db.query(PurchaseOrder).count() > 0:
        return

    suppliers = [row.name for row in db.query(Supplier).order_by(Supplier.id.asc()).all()]
    if not suppliers:
        suppliers = ["Sysco Corporation", "US Foods Holding Corp.", "WebstaurantStore"]
    statuses = ["01", "02", "05"]
    ingredients = db.query(Ingredient).order_by(Ingredient.id.asc()).all()

    for idx in range(3):
        po = PurchaseOrder(
            supplier=suppliers[idx],
            po_status=statuses[idx],
            created_at=datetime.utcnow() - timedelta(days=idx + 1),
        )
        db.add(po)
        db.flush()

        for ingredient in ingredients[idx * 3 : idx * 3 + 3]:
            db.add(
                PurchaseOrderItem(
                    purchase_order_id=po.id,
                    ingredient_id=ingredient.id,
                    quantity_ordered=round(max(ingredient.reorder_level * 0.8, 12), 2),
                    unit_cost=ingredient.default_unit_cost,
                    cost_unit=ingredient.cost_unit,
                )
            )


def seed_meal_deliveries(db):
    if db.query(MealDelivery).count() > 0:
        return

    meals = db.query(Meal).order_by(Meal.id.asc()).all()
    clients = db.query(Client).order_by(Client.id.asc()).limit(15).all()

    for idx, client in enumerate(clients):
        meal = meals[idx % len(meals)]
        db.add(
            MealDelivery(
                meal_id=meal.id,
                site_id=client.site_id,
                client_id=client.id,
                quantity=1 if idx % 5 else 2,
                delivered_at=datetime.utcnow() - timedelta(hours=idx),
            )
        )


def seed_all():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_units(db)
        db.flush()
        seed_order_statuses(db)
        db.flush()
        seed_suppliers(db)
        db.flush()
        seed_ingredient_categories(db)
        db.flush()
        seed_users(db)
        db.flush()
        seed_food_restrictions(db)
        db.flush()
        seed_sites_and_clients(db)
        db.flush()
        seed_ingredients(db)
        db.flush()
        seed_meals(db)
        db.flush()
        seed_food_arrivals(db)
        db.flush()
        seed_meal_production_and_usage(db)
        db.flush()
        seed_purchase_orders(db)
        db.flush()
        seed_meal_deliveries(db)
        db.flush()
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_all()
    print("Seed complete.")
