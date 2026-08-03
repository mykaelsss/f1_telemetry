import logging
from datetime import datetime, timezone

import pandas as pd
import pytest
from freezegun import freeze_time

from app import caching
from app.caching import (
    LIVE,
    PAST_SEASON,
    SETTLING,
    cache_control_for,
    cache_control_for_year,
)


SESSION_END = datetime(2025, 6, 15, 15, 0, tzinfo=timezone.utc)


@pytest.fixture
def fixed_session_end(monkeypatch):
    monkeypatch.setattr(caching, "_session_end", lambda *_: SESSION_END)


@freeze_time("2025-06-15 14:30:00")
def test_cache_control_live_before_session_end(fixed_session_end):
    assert cache_control_for(2025, "r5", "R") == LIVE


@freeze_time("2025-06-15 15:30:00")
def test_cache_control_settling_just_after_end(fixed_session_end):
    assert cache_control_for(2025, "r5", "R") == SETTLING


@freeze_time("2025-06-17 14:59:00")
def test_cache_control_settling_inside_buffer(fixed_session_end):
    assert cache_control_for(2025, "r5", "R") == SETTLING


@freeze_time("2025-06-17 15:01:00")
def test_cache_control_past_season_after_buffer(fixed_session_end):
    assert cache_control_for(2025, "r5", "R") == PAST_SEASON


def test_cache_control_falls_back_when_session_end_raises(monkeypatch):
    def boom(*_):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(caching, "_session_end", boom)
    assert cache_control_for(2025, "r5", "R") == SETTLING


def test_cache_control_falls_back_when_session_end_returns_none(monkeypatch):
    monkeypatch.setattr(caching, "_session_end", lambda *_: None)
    assert cache_control_for(2025, "r5", "R") == SETTLING


@freeze_time("2026-06-21 00:00:00")
def test_cache_control_for_year_past():
    assert cache_control_for_year(2024) == PAST_SEASON


@freeze_time("2026-06-21 00:00:00")
def test_cache_control_for_year_current():
    assert cache_control_for_year(2026) == SETTLING


@freeze_time("2026-06-21 00:00:00")
def test_cache_control_for_year_future():
    assert cache_control_for_year(2027) == SETTLING


WEEKEND = {
    "Session1": "Practice 1",
    "Session1DateUtc": pd.Timestamp("2024-05-03 11:30:00"),
    "Session2": "Practice 2",
    "Session2DateUtc": pd.Timestamp("2024-05-03 15:00:00"),
    "Session3": "Practice 3",
    "Session3DateUtc": pd.Timestamp("2024-05-04 10:30:00"),
    "Session4": "Qualifying",
    "Session4DateUtc": pd.Timestamp("2024-05-04 14:00:00"),
    "Session5": "Race",
    "Session5DateUtc": pd.Timestamp("2024-05-05 13:00:00"),
}


@pytest.fixture
def stub_event(monkeypatch):
    def _stub(event=WEEKEND):
        monkeypatch.setattr(caching, "resolve_event", lambda *_: event)

    return _stub


def test_session_end_resolves_practice(stub_event):
    stub_event()
    assert caching._session_end(2024, "r5", "FP1") == datetime(
        2024, 5, 3, 12, 30, tzinfo=timezone.utc
    )


def test_session_end_uses_per_session_duration(stub_event):
    stub_event()
    assert caching._session_end(2024, "r5", "R") == datetime(
        2024, 5, 5, 15, 0, tzinfo=timezone.utc
    )


def test_session_end_identifier_is_case_insensitive(stub_event):
    stub_event()
    assert caching._session_end(2024, "r5", "fp1") == caching._session_end(
        2024, "r5", "FP1"
    )


def test_session_end_attaches_utc_to_naive_timestamp(stub_event):
    stub_event()
    assert caching._session_end(2024, "r5", "Q").tzinfo == timezone.utc


def test_session_end_preserves_aware_timestamp(stub_event):
    stub_event(
        {
            "Session1": "Practice 1",
            "Session1DateUtc": pd.Timestamp("2024-05-03 11:30:00", tz="UTC"),
        }
    )
    assert caching._session_end(2024, "r5", "FP1") == datetime(
        2024, 5, 3, 12, 30, tzinfo=timezone.utc
    )


def test_session_end_none_when_session_not_in_event(stub_event):
    stub_event()
    assert caching._session_end(2024, "r5", "SQ") is None


def test_session_end_none_when_date_is_nat(stub_event):
    stub_event({"Session1": "Practice 1", "Session1DateUtc": pd.NaT})
    assert caching._session_end(2024, "r5", "FP1") is None


def test_session_end_none_when_date_is_missing(stub_event):
    stub_event({"Session1": "Practice 1"})
    assert caching._session_end(2024, "r5", "FP1") is None


def test_session_end_none_for_unknown_identifier(stub_event):
    stub_event()
    assert caching._session_end(2024, "r5", "XYZ") is None


@freeze_time("2026-06-21 12:00:00")
def test_cache_control_for_past_event_through_real_session_end(stub_event):
    stub_event()
    assert cache_control_for(2024, "r5", "FP1") == PAST_SEASON


def test_cache_control_for_logs_when_identifier_is_not_a_string(stub_event, caplog):
    stub_event()
    with caplog.at_level(logging.ERROR, logger="uvicorn.error"):
        assert cache_control_for(2024, "r5", 1) == SETTLING
    assert "falling back to SETTLING" in caplog.text


@pytest.mark.parametrize("directive", [LIVE, SETTLING, PAST_SEASON])
def test_no_directive_grants_browsers_a_ttl(directive):
    assert "max-age=0" in directive or "no-cache" in directive


def test_directives_match_policy():
    assert LIVE == "public, no-cache"
    assert SETTLING == "public, max-age=0, s-maxage=3600"
    assert PAST_SEASON == "public, max-age=0, s-maxage=604800"
