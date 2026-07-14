import pandas as pd
import pytest
from fastapi import HTTPException
from fastf1.core import Laps

from app.sessions.services import _format_laps, _parse_selected_laps
from app.utils import format_lap_time


@pytest.mark.parametrize("td", [None, pd.NaT])
def testformat_lap_time_missing(td):
    assert format_lap_time(td) is None


@pytest.mark.parametrize(
    "td, expected",
    [
        (pd.Timedelta(minutes=1, seconds=23, milliseconds=456), "1:23.456"),
        (pd.Timedelta(seconds=5, milliseconds=100), "0:05.100"),
        (pd.Timedelta(minutes=2), "2:00.000"),
        (pd.Timedelta(seconds=59, milliseconds=999), "0:59.999"),
        (pd.Timedelta(minutes=1, seconds=0, milliseconds=1), "1:00.001"),
    ],
)
def testformat_lap_time_formats(td, expected):
    assert format_lap_time(td) == expected


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("VER:1", [("VER", [1])]),
        ("VER:1,2,3", [("VER", [1, 2, 3])]),
        ("VER:1|HAM:2", [("VER", [1]), ("HAM", [2])]),
        ("VER:1|", [("VER", [1])]),
        ("|VER:1", [("VER", [1])]),
        (" VER : 1 , 2 ", [("VER", [1, 2])]),
        ("VER:1,,2", [("VER", [1, 2])]),
    ],
)
def test_parse_selected_laps_valid(raw, expected):
    assert _parse_selected_laps(raw) == expected


@pytest.mark.parametrize("raw", ["", "   ", "|", " | "])
def test_parse_selected_laps_empty(raw):
    with pytest.raises(HTTPException) as exc:
        _parse_selected_laps(raw)
    assert exc.value.status_code == 400
    assert "No laps selected" in exc.value.detail


@pytest.mark.parametrize("raw", ["VER1", "VER1|HAM:2"])
def test_parse_selected_laps_missing_colon(raw):
    with pytest.raises(HTTPException) as exc:
        _parse_selected_laps(raw)
    assert exc.value.status_code == 400
    assert "Malformed" in exc.value.detail


def test_parse_selected_laps_empty_driver():
    with pytest.raises(HTTPException) as exc:
        _parse_selected_laps(":1")
    assert exc.value.status_code == 400
    assert "Malformed" in exc.value.detail


def test_parse_selected_laps_no_lap_numbers():
    with pytest.raises(HTTPException) as exc:
        _parse_selected_laps("VER:")
    assert exc.value.status_code == 400
    assert "No lap numbers given" in exc.value.detail


@pytest.mark.parametrize("raw", ["VER:abc", "VER:1,abc", "VER:1.5"])
def test_parse_selected_laps_non_integer_lap(raw):
    with pytest.raises(HTTPException) as exc:
        _parse_selected_laps(raw)
    assert exc.value.status_code == 400
    assert "Invalid lap number" in exc.value.detail


def _make_laps(**columns) -> Laps:
    return Laps(pd.DataFrame(columns))


def test_format_laps_none():
    assert _format_laps(None) == []


def test_format_laps_empty():
    assert _format_laps(_make_laps()) == []


def test_format_laps_valid():
    laps = _make_laps(
        LapNumber=[1, 2],
        LapTime=[
            pd.Timedelta(minutes=1, seconds=23, milliseconds=456),
            pd.Timedelta(minutes=1, seconds=25, milliseconds=100),
        ],
        Sector1Time=[
            pd.Timedelta(seconds=30, milliseconds=123),
            pd.Timedelta(seconds=31, milliseconds=200),
        ],
        Sector2Time=[
            pd.Timedelta(seconds=28, milliseconds=789),
            pd.Timedelta(seconds=29, milliseconds=500),
        ],
        Sector3Time=[
            pd.Timedelta(seconds=24, milliseconds=544),
            pd.Timedelta(seconds=24, milliseconds=400),
        ],
        Compound=["SOFT", "MEDIUM"],
        IsPersonalBest=[True, False],
        Driver=["VER", "VER"],
    )
    result = _format_laps(laps)
    assert len(result) == 2
    assert result[0] == {
        "lap_number": 1,
        "lap_time": "1:23.456",
        "sector1": "0:30.123",
        "sector2": "0:28.789",
        "sector3": "0:24.544",
        "compound": "SOFT",
        "is_personal_best": True,
    }
    assert result[1]["lap_number"] == 2
    assert result[1]["compound"] == "MEDIUM"
    assert result[1]["is_personal_best"] is False


def test_format_laps_missing_values():
    laps = _make_laps(
        LapNumber=[float("nan")],
        LapTime=[pd.NaT],
        Sector1Time=[pd.NaT],
        Sector2Time=[pd.NaT],
        Sector3Time=[pd.NaT],
        Compound=[""],
        IsPersonalBest=[False],
        Driver=["VER"],
    )
    result = _format_laps(laps)
    assert len(result) == 1
    assert result[0]["lap_number"] is None
    assert result[0]["lap_time"] is None
    assert result[0]["sector1"] is None
    assert result[0]["compound"] is None
