from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import date, time as day_time
from typing import Any
from urllib.parse import parse_qsl

import asyncpg
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
INIT_DATA_MAX_AGE = int(os.getenv("TELEGRAM_INIT_DATA_MAX_AGE", "86400"))
ALLOWED_ORIGINS = [
    item.strip()
    for item in os.getenv(
        "ALLOWED_ORIGINS",
        "https://zastroblox-cmd.github.io,http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if item.strip()
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_pool = None
    if DATABASE_URL:
        app.state.db_pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=1,
            max_size=5,
            command_timeout=10,
        )
    yield
    if app.state.db_pool is not None:
        await app.state.db_pool.close()


app = FastAPI(
    title="RTA Schedule API",
    version="0.1.0",
    description="Private API for the RTA Telegram Mini App.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Telegram-Init-Data"],
)


def validate_telegram_init_data(init_data: str) -> dict[str, Any]:
    """Verify Telegram Web App initData using the official HMAC scheme."""
    if not BOT_TOKEN:
        raise HTTPException(status_code=503, detail="Telegram authentication is not configured")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing Telegram initData")

    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
        data = dict(pairs)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Malformed Telegram initData") from exc

    received_hash = data.pop("hash", None)
    if not received_hash or "user" not in data or "auth_date" not in data:
        raise HTTPException(status_code=401, detail="Incomplete Telegram initData")

    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(data.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256).digest()
    calculated_hash = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise HTTPException(status_code=401, detail="Invalid Telegram initData signature")

    try:
        auth_timestamp = int(data["auth_date"])
        user = json.loads(data["user"])
        telegram_id = int(user["id"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid Telegram user data") from exc

    age = int(time.time()) - auth_timestamp
    if age < -60 or age > INIT_DATA_MAX_AGE:
        raise HTTPException(status_code=401, detail="Telegram initData has expired")

    return {"telegram_id": telegram_id, "user": user, "auth_date": auth_timestamp}


async def current_telegram_user(
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
) -> dict[str, Any]:
    return validate_telegram_init_data(x_telegram_init_data or "")


def get_pool(request: Request) -> asyncpg.Pool:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    return pool


def time_text(value: day_time | None) -> str | None:
    return value.strftime("%H:%M") if value else None


@app.get("/health")
async def health(request: Request) -> dict[str, str]:
    """Basic health endpoint; does not expose credentials or user data."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is None:
        return {"status": "ok", "database": "not_configured"}
    try:
        async with pool.acquire() as connection:
            await connection.fetchval("select 1")
        return {"status": "ok", "database": "connected"}
    except Exception:
        return {"status": "degraded", "database": "unavailable"}


@app.get("/api/groups")
async def list_groups(
    _: dict[str, Any] = Depends(current_telegram_user),
    pool: asyncpg.Pool = Depends(get_pool),
) -> dict[str, Any]:
    async with pool.acquire() as connection:
        rows = await connection.fetch(
            """
            select code, display_name, faculty, course
            from public.schedule_groups
            where is_active = true
            order by display_name
            """
        )
    return {"groups": [dict(row) for row in rows]}


@app.get("/api/schedule/{group_code}")
async def get_schedule(
    group_code: str,
    lesson_date: date = Query(..., description="Date in YYYY-MM-DD format"),
    week_code: str = Query(..., pattern="^[AB]$"),
    _: dict[str, Any] = Depends(current_telegram_user),
    pool: asyncpg.Pool = Depends(get_pool),
) -> dict[str, Any]:
    if not group_code.isdigit() or len(group_code) > 8:
        raise HTTPException(status_code=400, detail="Invalid group code")

    weekday = lesson_date.isoweekday() - 1
    async with pool.acquire() as connection:
        group = await connection.fetchrow(
            "select id, code, display_name from public.schedule_groups where code=$1 and is_active=true",
            group_code,
        )
        if group is None:
            raise HTTPException(status_code=404, detail="Group not found")

        rows = await connection.fetch(
            """
            select start_time, end_time, subject, lesson_type, room, teacher, sort_order
            from public.schedule_lessons
            where group_id=$1 and week_code=$2 and weekday=$3
            order by start_time, sort_order, id
            """,
            group["id"], week_code, weekday,
        )
        overrides = await connection.fetch(
            """
            select action, match_start_time, match_subject, start_time, end_time,
                   subject, lesson_type, room, teacher, note
            from public.schedule_date_overrides
            where group_id=$1 and lesson_date=$2
            order by start_time nulls first, id
            """,
            group["id"], lesson_date,
        )

    lessons: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["start_time"] = time_text(item["start_time"])
        item["end_time"] = time_text(item["end_time"])
        lessons.append(item)

    for override in overrides:
        item = dict(override)
        if item["action"] == "remove":
            start = time_text(item["match_start_time"])
            lessons = [
                lesson for lesson in lessons
                if not (
                    lesson["start_time"] == start
                    and lesson["subject"] == item["match_subject"]
                )
            ]
        elif item["action"] == "add":
            lessons.append({
                "start_time": time_text(item["start_time"]),
                "end_time": time_text(item["end_time"]),
                "subject": item["subject"],
                "lesson_type": item["lesson_type"],
                "room": item["room"],
                "teacher": item["teacher"],
                "sort_order": 0,
            })

    lessons.sort(key=lambda lesson: (lesson["start_time"] or "", lesson["sort_order"]))
    return {
        "group": {"code": group["code"], "display_name": group["display_name"]},
        "date": lesson_date.isoformat(),
        "week_code": week_code,
        "weekday": weekday,
        "lessons": lessons,
    }


@app.get("/api/me")
async def me(user: dict[str, Any] = Depends(current_telegram_user)) -> dict[str, Any]:
    """Return only the authenticated Telegram identity needed by the client."""
    raw = user["user"]
    return {
        "telegram_id": user["telegram_id"],
        "username": raw.get("username"),
        "first_name": raw.get("first_name", ""),
        "last_name": raw.get("last_name", ""),
    }
