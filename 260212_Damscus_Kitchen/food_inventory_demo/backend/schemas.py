# date and datetime are used for expiration dates and timestamps.
from datetime import date, datetime
# Typing helps us declare clear list/optional field types.
from typing import List, Optional

# Pydantic validates request/response data for FastAPI.
from pydantic import BaseModel, Field


# Output schema for one site.
class SiteOut(BaseModel):
    id: int
    name: str
    address: str

    class Config:
        # orm_mode lets Pydantic read SQLAlchemy objects directly.
        orm_mode = True


# Output schema for one client.
class ClientOut(BaseModel):
    id: int
    site_id: int
    name: str

    class Config:
        orm_mode = True


# Shared ingredient fields used by create/output schemas.
class IngredientBase(BaseModel):
    name: str
    barcode: str
    unit: str
    quantity_on_hand: float = Field(ge=0)  # ge means "greater than or equal to".
    reorder_level: float = Field(ge=0)
    shelf_life_days: int = Field(ge=1)
    expiration_date: Optional[date] = None


# Request body schema for creating ingredients.
class IngredientCreate(IngredientBase):
    pass


# Request body schema for partial updates (PATCH).
class IngredientUpdate(BaseModel):
    quantity_on_hand: Optional[float] = Field(default=None, ge=0)
    reorder_level: Optional[float] = Field(default=None, ge=0)
    expiration_date: Optional[date] = None


# Response schema for ingredients.
class IngredientOut(IngredientBase):
    id: int

    class Config:
        orm_mode = True


# One ingredient line in a meal recipe.
class MealIngredientInput(BaseModel):
    ingredient_id: int
    quantity_per_serving: float = Field(gt=0)  # gt means "greater than".


# Output version of meal ingredient line with extra display fields.
class MealIngredientOut(MealIngredientInput):
    id: int
    ingredient_name: str
    unit: str


# Request schema for creating a meal and its ingredient lines.
class MealCreate(BaseModel):
    name: str
    ingredients: List[MealIngredientInput]


# Response schema for a meal.
class MealOut(BaseModel):
    id: int
    name: str
    ingredients: List[MealIngredientOut]


# Request schema for barcode-based arrival scanning.
class FoodArrivalScan(BaseModel):
    barcode: str
    quantity_received: float = Field(gt=0)
    expiration_date: Optional[date] = None
    unit_cost: Optional[float] = Field(default=None, ge=0)


# Response schema for one arrival record.
class FoodArrivalOut(BaseModel):
    id: int
    ingredient_id: int
    ingredient_name: str
    barcode: str
    quantity_received: float
    expiration_date: Optional[date]
    unit_cost: Optional[float]
    arrived_at: datetime


# Request schema for producing a meal batch.
class MealProductionCreate(BaseModel):
    meal_id: int
    servings: int = Field(gt=0)


# Response schema for meal production.
class MealProductionOut(BaseModel):
    id: int
    meal_id: int
    meal_name: str
    servings: int
    produced_at: datetime


# Response schema for ingredient usage logs.
class IngredientUsageOut(BaseModel):
    id: int
    production_id: int
    meal_id: int
    ingredient_id: int
    ingredient_name: str
    quantity_used: float
    used_at: datetime


# One PO line in a create request.
class PurchaseOrderItemInput(BaseModel):
    ingredient_id: int
    quantity_ordered: float = Field(gt=0)
    unit_cost: Optional[float] = Field(default=None, ge=0)


# PO create request schema.
class PurchaseOrderCreate(BaseModel):
    supplier: str
    items: List[PurchaseOrderItemInput]


# PO line output schema.
class PurchaseOrderItemOut(BaseModel):
    id: int
    ingredient_id: int
    ingredient_name: str
    quantity_ordered: float
    unit_cost: Optional[float]


# Purchase order output schema.
class PurchaseOrderOut(BaseModel):
    id: int
    supplier: str
    status: str
    created_at: datetime
    items: List[PurchaseOrderItemOut]


# Delivery creation request schema.
class MealDeliveryCreate(BaseModel):
    meal_id: int
    site_id: int
    client_id: int
    quantity: int = Field(gt=0)


# Delivery output schema.
class MealDeliveryOut(BaseModel):
    id: int
    meal_id: int
    meal_name: str
    site_id: int
    site_name: str
    client_id: int
    client_name: str
    quantity: int
    delivered_at: datetime


# Dashboard totals used by the main summary cards.
class DashboardReport(BaseModel):
    total_ingredients: int
    total_meals: int
    total_clients: int
    total_sites: int
    open_purchase_orders: int
    total_deliveries: int
    low_stock_count: int


# Reporting row for delivery totals per site.
class SiteDeliveryReport(BaseModel):
    site_id: int
    site_name: str
    meals_delivered: int
    clients_served: int
