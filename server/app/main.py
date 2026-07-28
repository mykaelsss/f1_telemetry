from functools import lru_cache

import logging
import os
from contextlib import asynccontextmanager

import fastf1
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from fastf1.exceptions import (
    DataNotLoadedError,
    ErgastError,
    FastF1CriticalError,
    InvalidSessionError,
    NoLapDataError,
    RateLimitExceededError,
)

from . import config
from app.fastf1_loader import set_cache_dir, start_pruner
from app.sessions.routes import router as session_router
from app.schedule.routes import router as schedule_router

logger = logging.getLogger("uvicorn.error")

try:
    # Private module; raised by session.load() when live timing has no data.
    from fastf1._api import SessionNotAvailableError
except Exception:  # tolerate an upstream rename without breaking startup
    class SessionNotAvailableError(Exception):
        pass

@lru_cache
def get_settings(): 
    return config.Settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    os.makedirs(settings.fastf1_cache_dir, exist_ok=True)
    fastf1.Cache.enable_cache(settings.fastf1_cache_dir)
    set_cache_dir(settings.fastf1_cache_dir)
    stop_pruner = start_pruner(
        settings.fastf1_cache_dir,
        settings.cache_high_water,
        settings.cache_low_water,
        settings.cache_prune_interval_seconds,
    )
    try:
        yield
    finally:
        stop_pruner.set()

app = FastAPI(lifespan=lifespan)


def _error(status: int, detail: str, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail}, headers=headers)


async def _not_found(request: Request, exc: Exception) -> JSONResponse:
    # Invalid year/round/session or a session the API has no usable data for.
    logger.info("404 for %s: %s", request.url.path, exc)
    return _error(404, str(exc) or "The requested session data is not available.")


async def _rate_limited(request: Request, exc: Exception) -> JSONResponse:
    logger.warning("Upstream rate limit for %s: %s", request.url.path, exc)
    return _error(
        503,
        "The upstream data provider is rate limiting requests. Please try again shortly.",
        headers={"Retry-After": "60"},
    )


async def _upstream_error(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Upstream data error for %s: %s", request.url.path, exc)
    return _error(502, "Failed to retrieve data from the upstream provider.")


for _exc in (ValueError, InvalidSessionError, NoLapDataError, SessionNotAvailableError, DataNotLoadedError):
    app.add_exception_handler(_exc, _not_found)
app.add_exception_handler(RateLimitExceededError, _rate_limited)
app.add_exception_handler(FastF1CriticalError, _upstream_error)
app.add_exception_handler(ErgastError, _upstream_error)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins_list,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(schedule_router, prefix='/schedule')
app.include_router(session_router, prefix='/sessions')

class Health(BaseModel):
    status: str


@app.get("/health", response_model=Health)
def health(response: Response):
    response.headers["Cache-Control"] = "public, max-age=0, s-maxage=300"
    response.headers["Cache-Tag"] = "health-probe"
    return {"status": "ok"}