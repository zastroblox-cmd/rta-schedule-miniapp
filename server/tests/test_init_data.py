import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest
from fastapi import HTTPException

from app import main


TOKEN = "test-token-not-a-real-secret"


def signed_init_data(*, auth_date=None, user=None):
    values = {
        "auth_date": str(auth_date if auth_date is not None else int(time.time())),
        "query_id": "test-query",
        "user": json.dumps(
            user or {"id": 123456, "first_name": "Test", "username": "test_user"},
            separators=(",", ":"),
        ),
    }
    check_string = "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
    secret_key = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    values["hash"] = hmac.new(
        secret_key, check_string.encode(), hashlib.sha256
    ).hexdigest()
    return urlencode(values)


@pytest.fixture(autouse=True)
def configure_token(monkeypatch):
    monkeypatch.setattr(main, "BOT_TOKEN", TOKEN)
    monkeypatch.setattr(main, "INIT_DATA_MAX_AGE", 86400)


def test_accepts_valid_telegram_init_data():
    result = main.validate_telegram_init_data(signed_init_data())
    assert result["telegram_id"] == 123456
    assert result["user"]["username"] == "test_user"


def test_rejects_tampered_init_data():
    init_data = signed_init_data().replace("test_user", "other_user")
    with pytest.raises(HTTPException) as error:
        main.validate_telegram_init_data(init_data)
    assert error.value.status_code == 401


def test_rejects_expired_init_data():
    init_data = signed_init_data(auth_date=int(time.time()) - 90000)
    with pytest.raises(HTTPException) as error:
        main.validate_telegram_init_data(init_data)
    assert error.value.status_code == 401


def test_rejects_missing_init_data():
    with pytest.raises(HTTPException) as error:
        main.validate_telegram_init_data("")
    assert error.value.status_code == 401


def test_rejects_invalid_signature():
    init_data = signed_init_data().replace("hash=", "hash=bad")
    with pytest.raises(HTTPException) as error:
        main.validate_telegram_init_data(init_data)
    assert error.value.status_code == 401
