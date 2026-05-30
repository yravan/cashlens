from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cash_lens_api.core.config import get_settings
from cash_lens_api.db import Base, SessionLocal, engine
from cash_lens_api.routers import accounts, dashboard, health, notifications, plaid, transactions, users
from cash_lens_api.services.demo_seed import seed_demo_workspace


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    Base.metadata.create_all(bind=engine)
    if settings.seed_demo_data:
        with SessionLocal() as session:
            seed_demo_workspace(
                session,
                email=settings.default_demo_user_email,
                full_name=settings.default_demo_user_name,
            )
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    docs_enabled = settings.environment != "production"
    app = FastAPI(
        title=settings.app_name,
        version="0.0.0",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(users.router)
    app.include_router(dashboard.router)
    app.include_router(accounts.router)
    app.include_router(transactions.router)
    app.include_router(notifications.router)
    app.include_router(plaid.router)
    return app


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run("cash_lens_api.main:app", host="0.0.0.0", port=8000, reload=True)
