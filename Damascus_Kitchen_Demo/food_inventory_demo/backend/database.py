# SQLAlchemy gives us tools to talk to a SQL database using Python classes.
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# This points to a local SQLite file in the project folder.
SQLALCHEMY_DATABASE_URL = "sqlite:///./food_inventory.db"

# The engine is the main connection manager for the database.
# check_same_thread=False is required for SQLite when FastAPI uses multiple threads.
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

# SessionLocal creates one database "session" per request.
# A session is like a temporary workspace to read/write data safely.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base is the parent class for all database tables in models.py.
Base = declarative_base()
