import pytest
from fastapi.testclient import TestClient

from app.etag import compute_etag, if_none_match_hit
from app.main import app
from tests.test_routes import SCHEDULE, STUB_CACHE_CONTROL, cache_calls, client


__all__ = ["cache_calls", "client"]


@pytest.fixture
def schedule(monkeypatch):
    monkeypatch.setattr("app.schedule.routes.get_schedule", lambda *a, **kw: SCHEDULE)


def test_etag_is_strong_and_stable():
    tag = compute_etag(b"payload")
    assert tag.startswith('"') and not tag.startswith('W/"')
    assert compute_etag(b"payload") == compute_etag(b"payload")
    assert compute_etag(b"payload") != compute_etag(b"other")


@pytest.mark.parametrize(
    "header, expected",
    [
        (None, False),
        ("", False),
        ("*", True),
        ('W/"abc"', True),
        ('"abc"', True),
        ('W/"zzz", W/"abc"', True),
        ('W/"zzz"', False),
    ],
)
def test_if_none_match_comparison(header, expected):
    assert if_none_match_hit(header, '"abc"') is expected


def test_response_carries_an_etag(client, cache_calls, schedule):
    resp = client.get("/schedule/2024")

    assert resp.status_code == 200
    assert resp.headers["ETag"].startswith('"') and not resp.headers["ETag"].startswith('W/"')


def test_matching_etag_returns_304_with_no_body(client, cache_calls, schedule):
    first = client.get("/schedule/2024")

    second = client.get(
        "/schedule/2024", headers={"If-None-Match": first.headers["ETag"]}
    )

    assert second.status_code == 304
    assert second.content == b""


def test_304_still_carries_cache_control(client, cache_calls, schedule):
    first = client.get("/schedule/2024")

    second = client.get(
        "/schedule/2024", headers={"If-None-Match": first.headers["ETag"]}
    )

    assert second.headers["Cache-Control"] == STUB_CACHE_CONTROL
    assert second.headers["ETag"] == first.headers["ETag"]


def test_304_still_carries_cors_headers(client, cache_calls, schedule):
    origin = "http://localhost:3000"
    first = client.get("/schedule/2024", headers={"Origin": origin})

    second = client.get(
        "/schedule/2024",
        headers={"Origin": origin, "If-None-Match": first.headers["ETag"]},
    )

    assert second.status_code == 304
    assert second.headers["access-control-allow-origin"] == origin


def test_304_drops_content_type(client, cache_calls, schedule):
    first = client.get("/schedule/2024")

    second = client.get(
        "/schedule/2024", headers={"If-None-Match": first.headers["ETag"]}
    )

    assert "content-type" not in second.headers


def test_stale_etag_returns_full_body(client, cache_calls, schedule):
    resp = client.get("/schedule/2024", headers={"If-None-Match": 'W/"stale"'})

    assert resp.status_code == 200
    assert resp.json() == SCHEDULE


def test_wildcard_if_none_match_returns_304(client, cache_calls, schedule):
    resp = client.get("/schedule/2024", headers={"If-None-Match": "*"})

    assert resp.status_code == 304


def test_changed_payload_changes_the_etag(client, cache_calls, monkeypatch):
    monkeypatch.setattr("app.schedule.routes.get_schedule", lambda *a, **kw: SCHEDULE)
    first = client.get("/schedule/2024").headers["ETag"]

    changed = {**SCHEDULE, "events": []}
    monkeypatch.setattr("app.schedule.routes.get_schedule", lambda *a, **kw: changed)
    second = client.get("/schedule/2024").headers["ETag"]

    assert first != second


def test_error_responses_are_not_tagged(client, cache_calls, monkeypatch):
    def _raise(*a, **kw):
        raise ValueError("bad round")

    monkeypatch.setattr("app.sessions.routes.get_session", _raise)

    resp = client.get("/sessions/2024/r5/R")

    assert resp.status_code == 404
    assert "etag" not in resp.headers


def test_health_is_tagged(client):
    resp = client.get("/health")

    assert resp.status_code == 200
    assert "etag" in resp.headers
