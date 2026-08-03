import pytest
from fastapi.testclient import TestClient
from fastf1.exceptions import (
    DataNotLoadedError,
    ErgastError,
    FastF1CriticalError,
    InvalidSessionError,
    NoLapDataError,
    RateLimitExceededError,
)

from app.main import app
from app.schedule.services import SessionDetailConfig


STUB_CACHE_CONTROL = "public, max-age=1"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def cache_calls(monkeypatch):
    calls = []

    def _record(*args):
        calls.append(args)
        return STUB_CACHE_CONTROL

    for target in (
        "app.schedule.routes.cache_control_for",
        "app.schedule.routes.cache_control_for_year",
        "app.sessions.routes.cache_control_for",
    ):
        monkeypatch.setattr(target, _record)
    return calls


SCHEDULE = {
    "year": 2024,
    "events": [
        {
            "round": 5,
            "identifier": "r5",
            "country": "China",
            "location": "Shanghai",
            "official_event_name": "FORMULA 1 CHINESE GRAND PRIX 2024",
            "event_name": "Chinese Grand Prix",
            "event_date_start": "2024-04-19",
            "event_date_end": "2024-04-21",
            "event_format": "sprint_qualifying",
            "status": "completed",
        }
    ],
}

EVENT = {
    "round": 5,
    "year": 2024,
    "name": "Chinese Grand Prix",
    "country": "China",
    "location": "Shanghai",
    "date": "2024-04-21",
    "format": "sprint_qualifying",
    "sessions": [
        {
            "name": "Race",
            "identifier": "R",
            "date": "2024-04-21",
            "start_time": "07:00:00",
            "end_time": "09:00:00",
            "status": "completed",
        }
    ],
}

EVENT_DETAILED = {
    **EVENT,
    "sessions": [
        {
            "name": "Race",
            "identifier": "R",
            "date": "2024-04-21",
            "start_time": "07:00:00",
            "end_time": "09:00:00",
            "status": "completed",
            "weather": {
                "air_temp": 21.4,
                "track_temp": 35.2,
                "humidity": 44.0,
                "wind_speed": 1.6,
                "rainfall": False,
            },
            "fastest_lap": "1:37.810",
        }
    ],
}

RESULTS = [
    {
        "position": 1,
        "code": "VER",
        "full_name": "Max Verstappen",
        "team": "Red Bull Racing",
        "team_color": "3671C6",
        "grid": 1,
        "laps": 56,
        "time": "1:40:52.554",
        "q1": "1:34.020",
        "q2": "1:33.303",
        "q3": "1:33.660",
        "status": "Finished",
        "points": 25.0,
    }
]

PODIUM = [
    {"position": 1, "code": "VER", "time": "1:40:52.554"},
    {"position": 2, "code": "NOR", "time": "+13.773"},
    {"position": 3, "code": "PER", "time": "+19.160"},
]

CIRCUIT = {
    "rotation": 313.0,
    "corners": [
        {"x": 1234.0, "y": -560.0, "number": 1, "angle": 91.5, "distance": 480.2}
    ],
    "marshal_sectors": [
        {"x": 900.0, "y": -120.0, "number": 1, "angle": 12.0, "distance": 0.0}
    ],
    "sector_distances": [1520.4, 3980.7],
}

SESSION_INFO = {
    "event_name": "Chinese Grand Prix",
    "name": "Race",
    "date": "2024-04-21",
    "country": "China",
    "location": "Shanghai",
    "drivers": [
        {
            "number": "1",
            "abbreviation": "VER",
            "full_name": "Max Verstappen",
            "team_name": "Red Bull Racing",
            "team_color": "3671C6",
            "status": "Finished",
            "classified_position": "1",
            "position": 1,
            "grid_position": 1,
            "participated": True,
        }
    ],
}

DRIVER_LAPS = [
    {
        "abbreviation": "VER",
        "segments": [
            {
                "name": "Q1",
                "laps": [
                    {
                        "lap_number": 1,
                        "lap_time": "1:34.020",
                        "sector1": "24.501",
                        "sector2": "39.220",
                        "sector3": "30.299",
                        "compound": "SOFT",
                        "is_personal_best": True,
                    }
                ],
            }
        ],
    }
]

LAP_TELEMETRY = [
    {
        "driver": "VER",
        "lap_number": 32,
        "lap_time": 97.81,
        "compound": "HARD",
        "tyre_life": 14,
        "channels": {
            "time": [0.0, 0.25],
            "speed": [281.0, 288.0],
            "throttle": [100.0, 100.0],
            "brake": [False, False],
            "gear": [7, 8],
            "drs": [0, 12],
            "distance": [0.0, 19.8],
            "rpm": [11200.0, 11450.0],
            "x": [1234.0, 1250.0],
            "y": [-560.0, -548.0],
        },
    }
]


ROUTE_CASES = [
    ("schedule", "/schedule/2024", "app.schedule.routes.get_schedule", SCHEDULE, (2024,)),
    ("event", "/schedule/2024/r5", "app.schedule.routes.get_event", EVENT, (2024, "r5", "R")),
    (
        "detailed",
        "/schedule/2024/r5/detailed",
        "app.schedule.routes.get_event_detailed",
        EVENT_DETAILED,
        (2024, "r5", "R"),
    ),
    (
        "results",
        "/schedule/2024/r5/Q/results",
        "app.schedule.routes.get_results",
        RESULTS,
        (2024, "r5", "Q"),
    ),
    ("podium", "/schedule/2024/r5/podium", "app.schedule.routes.get_podium", PODIUM, (2024, "r5", "R")),
    (
        "circuit",
        "/schedule/2024/r5/circuit",
        "app.schedule.routes.get_circuit_info",
        CIRCUIT,
        (2024, "r5", "FP1"),
    ),
    (
        "session_info",
        "/sessions/2024/r5/R",
        "app.sessions.routes.get_session",
        SESSION_INFO,
        (2024, "r5", "R"),
    ),
    (
        "laps",
        "/sessions/2024/r5/Q/laps",
        "app.sessions.routes.get_driver_laps",
        DRIVER_LAPS,
        (2024, "r5", "Q"),
    ),
    (
        "telemetry",
        "/sessions/2024/r5/R/laps/telemetry?selected_laps=VER:32",
        "app.sessions.routes.get_lap_telemetry",
        LAP_TELEMETRY,
        (2024, "r5", "R"),
    ),
]


@pytest.mark.parametrize(
    "path, service, payload, cache_args",
    [case[1:] for case in ROUTE_CASES],
    ids=[case[0] for case in ROUTE_CASES],
)
def test_route_serializes_payload_and_sets_cache_control(
    client, cache_calls, monkeypatch, path, service, payload, cache_args
):
    monkeypatch.setattr(service, lambda *a, **kw: payload)

    resp = client.get(path)

    assert resp.status_code == 200
    assert resp.json() == payload
    assert resp.headers["Cache-Control"] == STUB_CACHE_CONTROL
    assert cache_calls == [cache_args]


SESSION_INFO_WITH_NULLS = {
    **SESSION_INFO,
    "drivers": [
        {
            "number": "38",
            "abbreviation": "LAW",
            "full_name": "Liam Lawson",
            "team_name": "RB",
            "team_color": "6692FF",
            "status": None,
            "classified_position": None,
            "position": None,
            "grid_position": None,
            "participated": False,
        }
    ],
}

DRIVER_LAPS_WITH_NULLS = [
    {
        "abbreviation": "HUL",
        "segments": [
            {
                "name": "Q1",
                "laps": [
                    {
                        "lap_number": None,
                        "lap_time": None,
                        "sector1": None,
                        "sector2": None,
                        "sector3": None,
                        "compound": None,
                        "is_personal_best": False,
                    }
                ],
            }
        ],
    }
]

LAP_TELEMETRY_WITH_NULLS = [
    {
        **LAP_TELEMETRY[0],
        "lap_time": None,
        "compound": None,
        "tyre_life": None,
    }
]

RESULTS_WITH_NULLS = [
    {
        **RESULTS[0],
        "grid": None,
        "laps": None,
        "time": None,
        "q1": None,
        "q2": None,
        "q3": None,
        "status": None,
    }
]

EVENT_DETAILED_WITH_NULLS = {
    **EVENT_DETAILED,
    "sessions": [
        {
            **EVENT_DETAILED["sessions"][0],
            "end_time": None,
            "weather": None,
            "fastest_lap": None,
        }
    ],
}

NULLABLE_CASES = [
    (
        "session_info",
        "/sessions/2024/r5/R",
        "app.sessions.routes.get_session",
        SESSION_INFO_WITH_NULLS,
    ),
    (
        "laps",
        "/sessions/2024/r5/Q/laps",
        "app.sessions.routes.get_driver_laps",
        DRIVER_LAPS_WITH_NULLS,
    ),
    (
        "telemetry",
        "/sessions/2024/r5/R/laps/telemetry?selected_laps=VER:32",
        "app.sessions.routes.get_lap_telemetry",
        LAP_TELEMETRY_WITH_NULLS,
    ),
    (
        "results",
        "/schedule/2024/r5/Q/results",
        "app.schedule.routes.get_results",
        RESULTS_WITH_NULLS,
    ),
    (
        "detailed",
        "/schedule/2024/r5/detailed",
        "app.schedule.routes.get_event_detailed",
        EVENT_DETAILED_WITH_NULLS,
    ),
]


@pytest.mark.parametrize(
    "path, service, payload",
    [case[1:] for case in NULLABLE_CASES],
    ids=[case[0] for case in NULLABLE_CASES],
)
def test_route_accepts_nulls_services_can_emit(
    client, cache_calls, monkeypatch, path, service, payload
):
    monkeypatch.setattr(service, lambda *a, **kw: payload)

    resp = client.get(path)

    assert resp.status_code == 200
    assert resp.json() == payload


def test_route_rejects_payload_missing_a_required_field(client, cache_calls, monkeypatch):
    broken = {**SESSION_INFO}
    del broken["location"]
    monkeypatch.setattr("app.sessions.routes.get_session", lambda *a, **kw: broken)

    with pytest.raises(Exception):
        client.get("/sessions/2024/r5/R")


def test_health_returns_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_detailed_defaults_weather_and_laps_on(client, cache_calls, monkeypatch):
    seen = {}

    def _fake(year, event_id, config):
        seen["config"] = config
        return EVENT_DETAILED

    monkeypatch.setattr("app.schedule.routes.get_event_detailed", _fake)
    assert client.get("/schedule/2024/r5/detailed").status_code == 200
    assert seen["config"] == SessionDetailConfig(True, True)


def test_detailed_forwards_query_params(client, cache_calls, monkeypatch):
    seen = {}

    def _fake(year, event_id, config):
        seen["config"] = config
        return EVENT_DETAILED

    monkeypatch.setattr("app.schedule.routes.get_event_detailed", _fake)
    resp = client.get("/schedule/2024/r5/detailed?weather=false&laps=0")
    assert resp.status_code == 200
    assert seen["config"] == SessionDetailConfig(False, False)


def test_laps_defaults_drivers_to_empty_string(client, cache_calls, monkeypatch):
    seen = {}

    def _fake(year, event_id, identifier, drivers):
        seen["drivers"] = drivers
        return DRIVER_LAPS

    monkeypatch.setattr("app.sessions.routes.get_driver_laps", _fake)
    assert client.get("/sessions/2024/r5/Q/laps").status_code == 200
    assert seen["drivers"] == ""


def test_telemetry_requires_selected_laps(client):
    resp = client.get("/sessions/2024/r5/R/laps/telemetry")
    assert resp.status_code == 422


def test_year_must_be_an_integer(client):
    assert client.get("/schedule/not-a-year").status_code == 422


@pytest.mark.parametrize(
    "exc, status",
    [
        (ValueError("bad round"), 404),
        (InvalidSessionError("no such session"), 404),
        (NoLapDataError("no laps"), 404),
        (DataNotLoadedError("not loaded"), 404),
        (FastF1CriticalError("upstream exploded"), 502),
        (ErgastError("ergast down"), 502),
        (RateLimitExceededError("slow down"), 503),
    ],
    ids=lambda v: type(v).__name__ if isinstance(v, Exception) else str(v),
)
def test_service_exceptions_map_to_status(client, cache_calls, monkeypatch, exc, status):
    def _raise(*a, **kw):
        raise exc

    monkeypatch.setattr("app.sessions.routes.get_session", _raise)

    resp = client.get("/sessions/2024/r5/R")

    assert resp.status_code == status
    assert "detail" in resp.json()


def test_rate_limit_beats_critical_error_handler(client, cache_calls, monkeypatch):
    def _raise(*a, **kw):
        raise RateLimitExceededError("slow down")

    monkeypatch.setattr("app.sessions.routes.get_session", _raise)

    resp = client.get("/sessions/2024/r5/R")

    assert resp.status_code == 503
    assert resp.headers["Retry-After"] == "60"


def test_http_exception_from_service_is_preserved(client, cache_calls, monkeypatch):
    from fastapi import HTTPException

    def _raise(*a, **kw):
        raise HTTPException(400, "No laps selected.")

    monkeypatch.setattr("app.sessions.routes.get_lap_telemetry", _raise)

    resp = client.get("/sessions/2024/r5/R/laps/telemetry?selected_laps=junk")

    assert resp.status_code == 400
    assert resp.json()["detail"] == "No laps selected."


def test_cors_allows_configured_origin(client, cache_calls, monkeypatch):
    monkeypatch.setattr("app.schedule.routes.get_schedule", lambda *a, **kw: SCHEDULE)

    resp = client.get("/schedule/2024", headers={"Origin": "http://localhost:3000"})

    assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_cors_rejects_non_get_methods(client):
    resp = client.options(
        "/schedule/2024",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert resp.status_code == 400
    assert resp.headers["access-control-allow-methods"] == "GET"


def test_cors_allows_get_preflight(client):
    resp = client.options(
        "/schedule/2024",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"
