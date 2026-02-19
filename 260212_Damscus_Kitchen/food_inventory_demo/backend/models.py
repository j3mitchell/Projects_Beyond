# datetime is used for automatic timestamps like "arrived_at" and "delivered_at".
from datetime import datetime

# SQLAlchemy column types and relationship helpers.
from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

# Base class shared by all table models.
from backend.database import Base


# Stores users who log in with one of three roles: Root, Mgmt, Rep.
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    role = Column(String, nullable=False, index=True)


class Unit(Base):
    __tablename__ = "units"

    id = Column(String(2), primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)


class CostUnit(Base):
    __tablename__ = "cost_units"

    id = Column(String(2), primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)


class UnitCostOption(Base):
    __tablename__ = "unit_cost_options"

    id = Column(String(2), primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(String(2), primary_key=True, index=True)
    st = Column(String(2), nullable=False, index=True)
    city = Column(String, nullable=False, index=True)
    address = Column(String, nullable=False)
    name = Column(String, unique=True, nullable=False, index=True)


class POStatus(Base):
    __tablename__ = "po_status"

    id = Column(String(2), primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)


class MealType(Base):
    __tablename__ = "meal_types"

    id = Column(String(2), primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)


# Dedicated ingredient category table used by Add Ingredient dropdown.
class IngredientCategory(Base):
    __tablename__ = "ingredient_categories"

    # Two-digit string IDs, e.g. "01", "02".
    id = Column(String(2), primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)


# Food restriction master list (for example: Low Sodium, Gluten Free).
class FoodRestriction(Base):
    __tablename__ = "food_restrictions"

    id = Column(String(2), primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)

    clients = relationship("Client", back_populates="food_restriction")


# A site is one residential location served by the kitchen.
class Site(Base):
    __tablename__ = "sites"

    id = Column(Integer, primary_key=True, index=True)
    state_code = Column(String, nullable=False, index=True)
    city = Column(String, nullable=False, index=True)
    site_code = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    address = Column(String, nullable=False)

    # One site can have many clients.
    clients = relationship("Client", back_populates="site", cascade="all,delete")


# A client is one person who receives meals at a site.
class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False, index=True)
    restriction_id = Column(String(2), ForeignKey("food_restrictions.id"), nullable=False, index=True)
    client_code = Column(String, nullable=False, unique=True, index=True)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    special_notes = Column(Text, nullable=True)

    # Many clients belong to one site.
    site = relationship("Site", back_populates="clients")
    food_restriction = relationship("FoodRestriction", back_populates="clients")


# Ingredient inventory table.
class Ingredient(Base):
    __tablename__ = "ingredients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    category = Column(String, nullable=False, index=True)
    barcode = Column(String, unique=True, index=True, nullable=False)
    unit = Column(String, nullable=False)  # Example: lb, oz, count.
    quantity_on_hand = Column(Float, default=0, nullable=False)
    reorder_level = Column(Float, default=0, nullable=False)
    shelf_life_days = Column(Integer, default=30, nullable=False)
    expiration_date = Column(Date, nullable=True)
    default_unit_cost = Column(Float, nullable=True)
    cost_unit = Column(String, nullable=True)


# A meal recipe (for example: Chicken and Rice Bowl).
class Meal(Base):
    __tablename__ = "meals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    # Comma-separated food_restrictions IDs that apply to this meal, e.g. "04,07,08".
    restriction = Column(String, nullable=False, default="01")

    # A meal has many ingredient lines in the meal_ingredients table.
    ingredients = relationship("MealIngredient", back_populates="meal", cascade="all,delete")


# Join table that says how much of each ingredient is needed per meal serving.
class MealIngredient(Base):
    __tablename__ = "meal_ingredients"

    id = Column(Integer, primary_key=True)
    meal_id = Column(Integer, ForeignKey("meals.id"), nullable=False, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False, index=True)
    quantity_per_serving = Column(Float, nullable=False)

    meal = relationship("Meal", back_populates="ingredients")
    ingredient = relationship("Ingredient")


# Logs each incoming delivery scan (barcode + quantity + cost + date).
class FoodArrival(Base):
    __tablename__ = "food_arrivals"

    id = Column(Integer, primary_key=True, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False, index=True)
    barcode = Column(String, nullable=False, index=True)
    quantity_received = Column(Float, nullable=False)
    expiration_date = Column(Date, nullable=True)
    unit_cost = Column(Float, nullable=True)
    cost_unit = Column(String, nullable=True)
    arrived_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    ingredient = relationship("Ingredient")


# Logs when a kitchen batch of a meal is produced (number of servings).
class MealProduction(Base):
    __tablename__ = "meal_productions"

    id = Column(Integer, primary_key=True, index=True)
    meal_id = Column(Integer, ForeignKey("meals.id"), nullable=False, index=True)
    servings = Column(Integer, nullable=False)
    produced_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    meal = relationship("Meal")


# Stores actual ingredient usage per production batch.
class IngredientUsage(Base):
    __tablename__ = "ingredient_usage"

    id = Column(Integer, primary_key=True, index=True)
    production_id = Column(Integer, ForeignKey("meal_productions.id"), nullable=False, index=True)
    meal_id = Column(Integer, ForeignKey("meals.id"), nullable=False, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False, index=True)
    quantity_used = Column(Float, nullable=False)
    used_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    ingredient = relationship("Ingredient")


# Purchase order header (supplier + open/closed status).
class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    supplier = Column(String, nullable=False)
    # Stores PO status ID from po_status.id
    po_status = Column("po_status", String, ForeignKey("po_status.id"), default="01", nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # One PO can have many line items.
    items = relationship("PurchaseOrderItem", back_populates="purchase_order", cascade="all,delete")


# Purchase order line item for one ingredient.
class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False, index=True)
    quantity_ordered = Column(Float, nullable=False)
    unit_cost = Column(Float, nullable=True)
    cost_unit = Column(String, nullable=True)

    purchase_order = relationship("PurchaseOrder", back_populates="items")
    ingredient = relationship("Ingredient")


# Final delivery record: which meal went to which site/client and how much.
class MealDelivery(Base):
    __tablename__ = "meal_deliveries"

    id = Column(Integer, primary_key=True, index=True)
    meal_id = Column(Integer, ForeignKey("meals.id"), nullable=False, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    delivered_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    meal = relationship("Meal")
    site = relationship("Site")
    client = relationship("Client")
