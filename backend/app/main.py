from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.data import router as data_router
from app.api.routes.gmail_auth import router as gmail_auth_router
from app.api.routes.ingestion import router as ingestion_router
from app.api.routes.onboarding import router as onboarding_router
from app.core.config import settings as app_settings
from app.services.ingestion.scheduler import setup_scheduler, shutdown_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_scheduler()
    yield
    shutdown_scheduler()


app = FastAPI(
    title="CashLens",
    description="LLM-powered personal finance tracker",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[app_settings.frontend_url],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(ingestion_router, prefix="/api")
app.include_router(data_router, prefix="/api")
app.include_router(onboarding_router, prefix="/api")
app.include_router(gmail_auth_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
