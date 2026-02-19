# datetime is used for automatic timestamps like "arrived_at" and "delivered_at".
from datetime import datetime

# SQLAlchemy column types and relationship helpers.
from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

# Base class shared by all table models.
from backend.database import Base


# Stores users who log in with one of three roles: Root, Mgmt, Rep.
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    role = Column(String, nullable=False, index=True)


# A site is one residential location served by the kitchen.
class Site(Base):
    __tablename__ = "sites"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    address = Column(String, nullable=False)

    # One site can have many clients.
    clients = relationship("Client", back_populates="site", cascade="all,delete")


# A client is one person who receives meals at a site.
class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False, index=True)
    name = Column(String, nullable=False)

    # Many clients belong to one site.
    site = relationship("Site", back_populates="clients")


# Ingredient inventory table.
class Ingredient(Base):
    __tablename__ = "ingredients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    barcode = Column(String, unique=True, index=True, nullable=False)
    unit = Column(String, nullable=False)  # Example: lb, oz, count.
    quantity_on_hand = Column(Float, default=0, nullable=False)
    reorder_level = Column(Float, default=0, nullable=False)
    shelf_life_days = Column(Integer, default=30, nullable=False)
    expiration_date = Column(Date, nullable=True)


# A meal recipe (for example: Chicken and Rice Bowl).
class Meal(Base):
    __tablename__ = "meals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)

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
    status = Column(String, default="open", nullable=False, index=True)
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
