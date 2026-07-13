import collections

import fastf1
import pandas as pd
from fastf1.core import Laps
import numpy as np
from fastapi import HTTPException
from app.utils import KeyLockRegistry, format_lap_time, resolve_event, resolve_session

from app.fastf1_loader import cached_locked_load

_LAP_TELEMETRY_CACHE_MAX = 1024
_lap_telemetry_cache: "collections.OrderedDict[tuple, dict]" = collections.OrderedDict()
_lap_telemetry_locks = KeyLockRegistry()

_LAPS_CACHE_MAX = 256
_laps_cache: "collections.OrderedDict[tuple, list]" = collections.OrderedDict()
_laps_locks = KeyLockRegistry()

IDENTIFIER_MAP = {
    "FP1": "Practice 1",
    "FP2": "Practice 2",
    "FP3": "Practice 3",
    "Q": "Qualifying",
    "S": "Sprint",
    "SQ": "Sprint Qualifying",
    "R": "Race",
}

def _get_session_date(event, identifier: str):
    session_name = IDENTIFIER_MAP.get(identifier.upper(), identifier)
    for i in range(1, 6):
        if event.get(f"Session{i}") == session_name:
            return str(event.get(f"Session{i}DateUtc"))
    return None

def get_session(year: int, event_id: str, identifier: str):
    event = resolve_event(year, event_id)
    session = resolve_session(year, event_id, identifier)
    session = cached_locked_load(session, year, event_id, identifier, laps=True, telemetry=False, weather=False, messages=True)
    
    is_practice = session.name in ["Practice 1", "Practice 2", "Practice 3", "Practice 4"]
    
    drivers = [
        {
            "number": d["DriverNumber"],
            "abbreviation": d["Abbreviation"],
            "full_name": d["FullName"],
            "team_name": d["TeamName"],
            "team_color": d["TeamColor"],
            "status": d["Status"],
            "classified_position": d["ClassifiedPosition"],
            "position": None if pd.isna(d["Position"]) else int(d["Position"]),
            "grid_position": None if pd.isna(d["GridPosition"]) else int(d["GridPosition"]),
            "participated": True if is_practice else not pd.isna(d["GridPosition"]) or not pd.isna(d["Position"])
        }
        for d in session.results[[
            "DriverNumber", "Abbreviation", "FullName", "TeamName",
            "TeamColor", "Status", "ClassifiedPosition", "Position", "GridPosition"
        ]].to_dict("records")
    ]
    
    return {
        "event_name": event["EventName"],
        "name": session.name,
        "date": str(event["EventDate"].date()),
        "country": event["Country"],
        "location": event["Location"],
        "drivers": drivers
    }

def _format_laps(driver_laps: Laps | None) -> list:
    if driver_laps is None or driver_laps.empty:
        return []
    laps = []
    for _, lap in driver_laps.iterlaps():
        laps.append({
            "lap_number": int(lap["LapNumber"]) if not pd.isna(lap.get("LapNumber")) else None,
            "lap_time": format_lap_time(lap.get("LapTime")),
            "sector1": format_lap_time(lap.get("Sector1Time")),
            "sector2": format_lap_time(lap.get("Sector2Time")),
            "sector3": format_lap_time(lap.get("Sector3Time")),
            "compound": str(lap.get("Compound", "")) or None,
            "is_personal_best": bool(lap.get("IsPersonalBest", False)),
        })
    return laps

def get_driver_laps(year: int, event_id: str, identifier: str, drivers: str):
    identifier = identifier.upper()
    key = (year, event_id, identifier, drivers)
    with _laps_locks.get(key):
        cached = _laps_cache.get(key)
        if cached is not None:
            _laps_cache.move_to_end(key)
            return cached
        abbreviations = [d.strip() for d in drivers.split(',')]
        session = resolve_session(year, event_id, identifier)
        session = cached_locked_load(session, year, event_id, identifier, laps=True, telemetry=False, weather=False, messages=False)
        driver_laps = session.laps.pick_drivers(abbreviations)
        grouped = driver_laps.groupby("Driver")
        result = []
        
        for abbreviation in abbreviations:
            if abbreviation not in grouped.groups:
                continue
            group = grouped.get_group(abbreviation)
            if identifier in ("Q", "SQ"):
                q1, q2, q3 = group.split_qualifying_sessions()
                segments = [
                    {
                        "name": "Q1",
                        "laps": _format_laps(q1)
                    },
                    {
                        "name": "Q2",
                        "laps": _format_laps(q2)
                    },
                    {
                        "name": "Q3",
                        "laps": _format_laps(q3)
                    },
                ]
            else:
                segments = [{
                    "name": identifier,
                    "laps": _format_laps(group)
                    }]
            result.append({
                "abbreviation": abbreviation,
                "segments": segments
            })
        _laps_cache[key] = result
        while len(_laps_cache) > _LAPS_CACHE_MAX:
            _laps_cache.popitem(last=False)
        return result

def load_session(year: int, round: int, identifier: str):
    session = fastf1.get_session(year, round, identifier)
    session.load(telemetry=False, weather=False, messages=False)

    session_date = _get_session_date(session.event, identifier)

    drivers = []
    for _, row in session.results.iterrows():
        driver_num = str(row.name)
        driver_laps = session.laps.pick_drivers(driver_num)

        laps = []
        for _, lap in driver_laps.iterrows():
            laps.append({
                "lap_number": int(lap["LapNumber"]) if not pd.isna(lap.get("LapNumber")) else None,
                "lap_time": format_lap_time(lap.get("LapTime")),
                "sector1": format_lap_time(lap.get("Sector1Time")),
                "sector2": format_lap_time(lap.get("Sector2Time")),
                "sector3": format_lap_time(lap.get("Sector3Time")),
                "compound": str(lap.get("Compound", "")) or None,
                "is_personal_best": bool(lap.get("IsPersonalBest", False)),
            })

        drivers.append({
            "code": str(row.get("Abbreviation", driver_num)),
            "full_name": str(row.get("FullName", "")),
            "team": {
                "name": str(row.get("TeamName", "")),
                "color": str(row.get("TeamColor", "")),
            },
            "laps": laps,
        })

    return {
        "event": session.event["EventName"],
        "country": session.event["Country"],
        "location": session.event["Location"],
        "round": int(session.event["RoundNumber"]),
        "session": session.name,
        "date": session_date,
        "drivers": drivers,
    }

def _parse_selected_laps(selected_laps: str) -> list[tuple[str, list[int]]]:
    """Parse 'DRIVER:lap[,lap...]|DRIVER:lap...' into (driver, [laps]) pairs.

    Raises HTTPException(400) on malformed input so a bad client query param
    doesn't surface as a 404/500.
    """
    selections: list[tuple[str, list[int]]] = []
    for entry in selected_laps.split("|"):
        entry = entry.strip()
        if not entry:
            continue
        driver, sep, lap_str = entry.partition(":")
        driver = driver.strip()
        if not sep or not driver:
            raise HTTPException(
                400,
                f"Malformed lap selection '{entry}'; expected 'DRIVER:lap[,lap...]'.",
            )
        laps: list[int] = []
        for token in lap_str.split(","):
            token = token.strip()
            if not token:
                continue
            try:
                laps.append(int(token))
            except ValueError:
                raise HTTPException(
                    400, f"Invalid lap number '{token}' for driver '{driver}'."
                )
        if not laps:
            raise HTTPException(400, f"No lap numbers given for driver '{driver}'.")
        selections.append((driver, laps))

    if not selections:
        raise HTTPException(400, "No laps selected.")
    return selections


def _build_lap_telemetry(session, driver: str, lap_number: int) -> dict | None:
    driver_laps = session.laps.pick_drivers(driver)
    lap_rows = driver_laps[driver_laps["LapNumber"] == float(lap_number)]
    if lap_rows.empty:
        return None
    lap_row = lap_rows.iloc[0]
    car_data = lap_row.get_car_data().add_distance()
    pos_data = lap_row.get_pos_data()
    lap_time = pd.Timedelta(lap_row["LapTime"]).total_seconds() if pd.notna(lap_row["LapTime"]) else None
    return {
        "driver": driver,
        "lap_number": lap_number,
        "lap_time": lap_time,
        "compound": str(lap_row.get("Compound", "")) or None,
        "tyre_life": int(lap_row["TyreLife"]) if pd.notna(lap_row.get("TyreLife")) else None,
        "channels": {
            "time": car_data["Time"].dt.total_seconds().tolist(),
            "speed": car_data["Speed"].tolist(),
            "throttle": car_data["Throttle"].tolist(),
            "brake": car_data["Brake"].tolist(),
            "gear": car_data["nGear"].tolist(),
            "drs": car_data["DRS"].tolist(),
            "distance": car_data["Distance"].tolist(),
            "rpm": car_data["RPM"].tolist(),
            "x": pos_data["X"].tolist(),
            "y": pos_data["Y"].tolist(),
        }
    }


def _get_or_build_lap(session, year: int, event_id: str, identifier: str, driver: str, lap_number: int) -> dict | None:
    key = (year, event_id, str(identifier).upper(), driver, lap_number)
    with _lap_telemetry_locks.get(key):
        cached = _lap_telemetry_cache.get(key)
        if cached is not None:
            _lap_telemetry_cache.move_to_end(key)
            return cached
        lap = _build_lap_telemetry(session, driver, lap_number)
        if lap is None:
            return None
        _lap_telemetry_cache[key] = lap
        while len(_lap_telemetry_cache) > _LAP_TELEMETRY_CACHE_MAX:
            _lap_telemetry_cache.popitem(last=False)
        return lap


def get_lap_telemetry(year: int, event_id: str, identifier: str, selected_laps: str):
    selections = _parse_selected_laps(selected_laps)
    session = resolve_session(year, event_id, identifier)
    session = cached_locked_load(session, year, event_id, identifier, laps=True, telemetry=True, weather=False, messages=False)
    result = []
    for driver, lap_numbers in selections:
        for lap_number in lap_numbers:
            lap = _get_or_build_lap(session, year, event_id, identifier, driver, lap_number)
            if lap is not None:
                result.append(lap)
    return result
