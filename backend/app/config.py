import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB = (BASE_DIR / "data" / "zoom.db").as_posix()
(BASE_DIR / "data").mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB}")
PUBLIC_FRONTEND_URL = os.getenv("PUBLIC_FRONTEND_URL", "http://localhost:3000").rstrip("/")
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
