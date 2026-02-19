# Core date helpers for expiration math and seeded demo data.
from datetime import date, timedelta
# Typing for response lists.
from typing import List

# FastAPI gives API routing/dependencies; CORS allows frontend-backend communication.
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
# SQL helpers for aggregate reports and schema inspection.
from sqlalchemy import func, inspect
from sqlalchemy.orm import Session, joinedload

# Database session/engine objects.
from backend.database import SessionLocal, engine
# SQLAlchemy table classes.
from backend.models import (
    Client,
    FoodArrival,
    Ingredient,
    IngredientUsage,
    Meal,
    MealDelivery,
    MealIngredient,
    MealProduction,
    PurchaseOrder,
    PurchaseOrderItem,
    Site,
    User,
)
from backend.schemas import (
    ClientOut,
    DashboardReport,
    FoodArrivalOut,
    FoodArrivalScan,
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    IngredientUsageOut,
    MealCreate,
    MealDeliveryCreate,
    MealDeliveryOut,
    MealOut,
    MealProductionCreate,
    MealProductionOut,
    MealIngredientOut,
    PurchaseOrderCreate,
    PurchaseOrderItemOut,
    PurchaseOrderOut,
    SiteDeliveryReport,
    SiteOut,
)

from backend.database import Base


def ensure_schema():
    # Look at current database tables.
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    # These are the tables our current app version needs.
    required_tables = {
        "users",
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
    if not recreate and "ingredients" in existing_tables:
        # Extra check: old ingredient tables may exist but without new columns.
        ingredient_columns = {col["name"] for col in inspector.get_columns("ingredients")}
        recreate = "barcode" not in ingredient_columns or "reorder_level" not in ingredient_columns

    if recreate:
        # Drop old tables so we can rebuild to the latest schema.
        Base.metadata.drop_all(bind=engine)
    # Create tables if they do not already exist.
    Base.metadata.create_all(bind=engine)


# Run schema check once when module starts.
ensure_schema()

# Create FastAPI app instance with API docs title.
app = FastAPI(title="Kitchen Food Inventory API")

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


def meal_to_schema(meal: Meal) -> MealOut:
    # Convert SQLAlchemy Meal object into API response object.
    return MealOut(
        id=meal.id,
        name=meal.name,
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


def purchase_order_to_schema(po: PurchaseOrder) -> PurchaseOrderOut:
    # Convert PO DB object into nested response format.
    return PurchaseOrderOut(
        id=po.id,
        supplier=po.supplier,
        status=po.status,
        created_at=po.created_at,
        items=[
            PurchaseOrderItemOut(
                id=item.id,
                ingredient_id=item.ingredient_id,
                ingredient_name=item.ingredient.name,
                quantity_ordered=item.quantity_ordered,
                unit_cost=item.unit_cost,
            )
            for item in po.items
        ],
    )


def seed_if_empty(db: Session):
    # Seed 10 sites x 20 clients if first run.
    if db.query(Site).count() == 0:
        for i in range(1, 11):
            site = Site(name=f"Site {i}", address=f"{100 + i} Community Lane")
            db.add(site)
            db.flush()
            for j in range(1, 21):
                db.add(Client(site_id=site.id, name=f"Client {i}-{j}"))

    # Seed demo users/roles.
    if db.query(User).count() == 0:
        db.add_all(
            [
                User(username="root.admin", role="Root"),
                User(username="ops.manager", role="Mgmt"),
                User(username="field.rep", role="Rep"),
            ]
        )

    # Seed starter ingredients with barcodes and stock.
    if db.query(Ingredient).count() == 0:
        db.add_all(
            [
                Ingredient(
                    name="Chicken Breast",
                    barcode="CHICK-001",
                    unit="lb",
                    quantity_on_hand=250,
                    reorder_level=60,
                    shelf_life_days=5,
                    expiration_date=date.today() + timedelta(days=5),
                ),
                Ingredient(
                    name="Rice",
                    barcode="RICE-001",
                    unit="lb",
                    quantity_on_hand=400,
                    reorder_level=100,
                    shelf_life_days=180,
                    expiration_date=date.today() + timedelta(days=120),
                ),
                Ingredient(
                    name="Broccoli",
                    barcode="BROCC-001",
                    unit="lb",
                    quantity_on_hand=160,
                    reorder_level=40,
                    shelf_life_days=7,
                    expiration_date=date.today() + timedelta(days=6),
                ),
            ]
        )

    # Save seed data.
    db.commit()


@app.on_event("startup")
def startup_seed():
    # Startup hook: seed database once when server boots.
    db = SessionLocal()
    try:
        seed_if_empty(db)
    finally:
        db.close()


@app.get("/")
def read_root():
    # Health endpoint for quick sanity checks.
    return {"status": "ok", "app": "Kitchen Food Inventory"}


@app.get("/roles")
def read_roles():
    # UI can use this list to show role options.
    return ["Root", "Mgmt", "Rep"]


@app.get("/sites", response_model=List[SiteOut])
def read_sites(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # List all sites for dropdowns and reports.
    return db.query(Site).order_by(Site.id).all()


@app.get("/clients", response_model=List[ClientOut])
def read_clients(
    site_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Rep")),
):
    # Optional filter: only clients in one site.
    query = db.query(Client)
    if site_id is not None:
        query = query.filter(Client.site_id == site_id)
    return query.order_by(Client.id).all()


@app.get("/ingredients", response_model=List[IngredientOut])
def read_ingredients(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Full inventory list.
    return db.query(Ingredient).order_by(Ingredient.name).all()


@app.post("/ingredients", response_model=IngredientOut)
def create_ingredient(
    payload: IngredientCreate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Prevent duplicate names and barcodes.
    if db.query(Ingredient).filter(Ingredient.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Ingredient name already exists")
    if db.query(Ingredient).filter(Ingredient.barcode == payload.barcode).first():
        raise HTTPException(status_code=400, detail="Barcode already exists")

    # Build and save new ingredient.
    ingredient = Ingredient(**payload.dict())
    db.add(ingredient)
    db.commit()
    db.refresh(ingredient)
    return ingredient


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
    for key, value in updates.items():
        setattr(ingredient, key, value)

    db.commit()
    db.refresh(ingredient)
    return ingredient


@app.get("/inventory/low", response_model=List[IngredientOut])
def read_low_inventory(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # Ingredients at or below reorder threshold.
    return (
        db.query(Ingredient)
        .filter(Ingredient.quantity_on_hand <= Ingredient.reorder_level)
        .order_by(Ingredient.quantity_on_hand.asc())
        .all()
    )


@app.get("/inventory/expiring", response_model=List[IngredientOut])
def read_expiring_inventory(
    days: int = Query(default=7, ge=1, le=365),
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Rep")),
):
    # Show ingredients expiring within N days.
    cutoff = date.today() + timedelta(days=days)
    return (
        db.query(Ingredient)
        .filter(Ingredient.expiration_date.isnot(None), Ingredient.expiration_date <= cutoff)
        .order_by(Ingredient.expiration_date.asc())
        .all()
    )


@app.get("/meals", response_model=List[MealOut])
def read_meals(db: Session = Depends(get_db), _: str = Depends(authorize("Rep"))):
    # joinedload avoids many tiny queries when reading nested ingredient lines.
    meals = db.query(Meal).options(joinedload(Meal.ingredients).joinedload(MealIngredient.ingredient)).all()
    return [meal_to_schema(meal) for meal in meals]


@app.post("/meals", response_model=MealOut)
def create_meal(
    payload: MealCreate,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Avoid duplicate meal names.
    if db.query(Meal).filter(Meal.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Meal name already exists")

    # Validate that all ingredient IDs exist.
    ingredient_ids = [line.ingredient_id for line in payload.ingredients]
    found_ingredients = db.query(Ingredient).filter(Ingredient.id.in_(ingredient_ids)).all()
    if len(found_ingredients) != len(set(ingredient_ids)):
        raise HTTPException(status_code=400, detail="One or more ingredient IDs are invalid")

    # Create meal header first.
    meal = Meal(name=payload.name)
    db.add(meal)
    db.flush()

    # Then create each recipe line.
    for line in payload.ingredients:
        db.add(
            MealIngredient(
                meal_id=meal.id,
                ingredient_id=line.ingredient_id,
                quantity_per_serving=line.quantity_per_serving,
            )
        )

    db.commit()
    # Re-read with relationships loaded for clean response.
    meal = (
        db.query(Meal)
        .options(joinedload(Meal.ingredients).joinedload(MealIngredient.ingredient))
        .filter(Meal.id == meal.id)
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
            unit_cost=row.unit_cost,
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
    )
    db.add(arrival)
    db.commit()
    db.refresh(arrival)
    db.refresh(ingredient)

    return FoodArrivalOut(
        id=arrival.id,
        ingredient_id=arrival.ingredient_id,
        ingredient_name=ingredient.name,
        barcode=arrival.barcode,
        quantity_received=arrival.quantity_received,
        expiration_date=arrival.expiration_date,
        unit_cost=arrival.unit_cost,
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

    # Create PO header.
    po = PurchaseOrder(supplier=payload.supplier, status="open")
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


@app.post("/purchase-orders/{purchase_order_id}/close", response_model=PurchaseOrderOut)
def close_purchase_order(
    purchase_order_id: int,
    db: Session = Depends(get_db),
    _: str = Depends(authorize("Mgmt")),
):
    # Find existing PO and set status closed.
    po = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.items).joinedload(PurchaseOrderItem.ingredient))
        .filter(PurchaseOrder.id == purchase_order_id)
        .first()
    )
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    po.status = "closed"
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
            client_name=row.client.name,
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
        client_name=client.name,
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
        open_purchase_orders=db.query(func.count(PurchaseOrder.id)).filter(PurchaseOrder.status == "open").scalar() or 0,
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
