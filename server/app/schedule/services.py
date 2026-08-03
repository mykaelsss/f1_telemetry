import collections
import logging

import fastf1
import pandas as pd
from datetime import datetime, timezone, timedelta
from fastf1.core import Session
from dataclasses import dataclass
from app.utils import KeyLockRegistry, format_lap_time, resolve_event, resolve_session

from app.fastf1_loader import cached_locked_load

logger = logging.getLogger("uvicorn.error")

_CIRCUIT_CACHE_MAX = 64
_circuit_cache: "collections.OrderedDict[tuple, dict]" = collections.OrderedDict()
_circuit_locks = KeyLockRegistry()

@dataclass
class SessionDetailConfig:
    weather: bool = True
    laps: bool = True

SESSION_NAME_TO_IDENTIFIER = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Qualifying": "Q",
    "Sprint": "S",
    "Sprint Qualifying": "SQ",
    "Race": "R",
}

SESSION_DURATION_MINUTES = {
    "FP1": 60, "FP2": 60, "FP3": 60,
    "Q": 60,
    "SQ": 60,
    "S": 30,
    "R": 120,
}

def get_schedule(year: int):
    schedule = fastf1.get_event_schedule(year)
    events = []
    test_events = 1

    for _, event in schedule.iterrows():
        status = _event_status(event["EventDate"], start_date=event.get("Session1DateUtc"))
        round_num = int(event["RoundNumber"])
        event_format = event["EventFormat"]
        identifier = ''
        if event_format == "testing":
            identifier = f"t{test_events}"
            test_events += 1
        else:
            identifier = f"r{round_num}"

        events.append({
            "round": round_num,
            "identifier": identifier,
            "country": event["Country"],
            "location": event["Location"],
            "official_event_name": event['OfficialEventName'],
            "event_name": event["EventName"],
            "event_date_start": str(event["Session1DateUtc"].date()) if event.get("Session1DateUtc") is not None else str(event["EventDate"].date()),
            "event_date_end": str(event["EventDate"].date()),
            "event_format": event["EventFormat"],
            "status": status,
        })

    return {"year": year, "events": events}

def get_results(year: int, event_id: str, identifier: str):
    session = resolve_session(year, event_id, identifier)
    uid = identifier.upper()
    if uid in {"FP1", "FP2", "FP3"}:
        session = cached_locked_load(session, year, event_id, identifier, laps=True, telemetry=False, weather=False, messages=False)
        return _practice_results(session)
    elif uid in {"Q", "SQ"}:
        session = cached_locked_load(session, year, event_id, identifier, laps=True, telemetry=False, weather=False, messages=False)
        return _qualifying_results(session)
    else:
        session = cached_locked_load(session, year, event_id, identifier, laps=False, telemetry=False, weather=False, messages=False)
        return _race_results(session)


def _race_results(session: Session):
    results = session.results.copy()
    results['Position'] = pd.to_numeric(results['Position'], errors='coerce')
    results = results.dropna(subset=['Position']).sort_values('Position')

    rows = []
    for _, row in results.iterrows():
        position = int(row['Position'])
        time_val = row.get('Time')
        if time_val is not None and not pd.isna(time_val):
            secs = pd.Timedelta(time_val).total_seconds()
            if position == 1:
                h = int(secs // 3600)
                m = int((secs % 3600) // 60)
                s = secs % 60
                time_str = f"{h}:{m:02d}:{s:06.3f}"
            else:
                time_str = f"+{secs:.3f}s"
        else:
            time_str = None

        rows.append({
            "position": position,
            "code": str(row.get('Abbreviation', '')),
            "full_name": str(row.get('FullName', '')),
            "team": str(row.get('TeamName', '')),
            "team_color": str(row.get('TeamColor', '')),
            "grid": int(row['GridPosition']) if not pd.isna(row.get('GridPosition')) else None,
            "laps": int(row['Laps']) if not pd.isna(row.get('Laps')) else None,
            "time": time_str,
            "q1": None, "q2": None, "q3": None,
            "status": str(row.get('Status', '')),
            "points": float(row['Points']) if not pd.isna(row.get('Points')) else 0.0,
        })
    return rows


def _qualifying_results(session: Session):
    results = session.results.copy()
    results['Position'] = pd.to_numeric(results['Position'], errors='coerce')
    ranked = results.dropna(subset=['Position']).sort_values('Position')

    # Fall back to lap times if results has no positions (e.g. SQ or incomplete cache)
    if ranked.empty:
        fastest = (
            session.laps
            .dropna(subset=['LapTime'])
            .groupby('DriverNumber', as_index=False)['LapTime']
            .min()
            .sort_values('LapTime')
            .reset_index(drop=True)
        )
        rows = []
        for pos, row in fastest.iterrows():
            driver_num = str(row['DriverNumber'])
            info = results.loc[driver_num] if driver_num in results.index else None
            rows.append({
                "position": pos + 1,
                "code": str(info['Abbreviation']) if info is not None else driver_num,
                "full_name": str(info['FullName']) if info is not None else '',
                "team": str(info['TeamName']) if info is not None else '',
                "team_color": str(info['TeamColor']) if info is not None else '',
                "grid": None, "laps": None, "time": None,
                "q1": format_lap_time(row['LapTime']),
                "q2": None, "q3": None,
                "status": None, "points": 0.0,
            })
        return rows

    rows = []
    for _, row in ranked.iterrows():
        rows.append({
            "position": int(row['Position']),
            "code": str(row.get('Abbreviation', '')),
            "full_name": str(row.get('FullName', '')),
            "team": str(row.get('TeamName', '')),
            "team_color": str(row.get('TeamColor', '')),
            "grid": None, "laps": None, "time": None,
            "q1": format_lap_time(row.get('Q1')),
            "q2": format_lap_time(row.get('Q2')),
            "q3": format_lap_time(row.get('Q3')),
            "status": None, "points": 0.0,
        })
    return rows


def _practice_results(session: Session):
    results = session.results
    fastest = (
        session.laps
        .dropna(subset=['LapTime'])
        .groupby('DriverNumber', as_index=False)['LapTime']
        .min()
        .sort_values('LapTime')
        .reset_index(drop=True)
    )
    leader_time = fastest.iloc[0]['LapTime'] if not fastest.empty else None

    rows = []
    for pos, row in fastest.iterrows():
        driver_num = str(row['DriverNumber'])
        info = results.loc[driver_num] if driver_num in results.index else None
        position = pos + 1
        secs = pd.Timedelta(row['LapTime']).total_seconds()
        if position == 1:
            m = int(secs // 60)
            s = secs % 60
            time_str = f"{m}:{s:06.3f}"
        else:
            gap = (pd.Timedelta(row['LapTime']) - pd.Timedelta(leader_time)).total_seconds()
            time_str = f"+{gap:.3f}s"

        rows.append({
            "position": position,
            "code": str(info['Abbreviation']) if info is not None else driver_num,
            "full_name": str(info['FullName']) if info is not None else '',
            "team": str(info['TeamName']) if info is not None else '',
            "team_color": str(info['TeamColor']) if info is not None else '',
            "grid": None,
            "laps": None,
            "time": time_str,
            "q1": None, "q2": None, "q3": None,
            "status": None,
            "points": 0.0,
        })
    return rows

def get_podium(year: int, event_id: str):
    session = resolve_session(year, event_id, 'R')
    session = cached_locked_load(session, year, event_id, 'R', telemetry=False, weather=False, messages=False)
    results = session.results

    # Normalise Position to numeric — older years may have strings or floats
    results = results.copy()
    results['Position'] = pd.to_numeric(results['Position'], errors='coerce')
    results = results.dropna(subset=['Position'])
    results = results.sort_values('Position').head(3)

    podium = []
    for _, row in results.iterrows():
        position = int(row['Position'])

        # Driver code: prefer Abbreviation, fall back to BroadcastName initials or DriverNumber
        code = str(row.get('Abbreviation', '') or '').strip()
        if not code or code == 'nan':
            broadcast = str(row.get('BroadcastName', '') or '').strip()
            code = broadcast.split()[-1][:3].upper() if broadcast and broadcast != 'nan' else str(int(row.get('DriverNumber', position)))

        # Time: winner gets total race time, others get gap
        time_val = row.get('Time')
        if time_val is not None and not (isinstance(time_val, float) and pd.isna(time_val)):
            try:
                secs = pd.Timedelta(time_val).total_seconds()
                if position == 1:
                    h = int(secs // 3600)
                    m = int((secs % 3600) // 60)
                    s = secs % 60
                    time_str = f"{h}:{m:02d}:{s:06.3f}"
                else:
                    time_str = f"+{secs:.3f}s"
            except Exception:
                time_str = str(row.get('Status', ''))
        else:
            time_str = str(row.get('Status', ''))

        podium.append({"position": position, "code": code, "time": time_str})

    return podium


def get_circuit_info(year: int, event_id: str):
    key = (year, event_id)
    with _circuit_locks.get(key):
        cached = _circuit_cache.get(key)
        if cached is not None:
            _circuit_cache.move_to_end(key)
            return cached
        identifier = 1
        session = resolve_session(year, event_id, identifier)
        session = cached_locked_load(session, year, event_id, identifier, laps=True, telemetry=True, weather=False, messages=False)
        circuit_info = session.get_circuit_info()

        sector_distances = []
        try:
            fastest_lap = session.laps.pick_fastest()
            if fastest_lap is not None:
                s1 = fastest_lap.get("Sector1Time")
                s2 = fastest_lap.get("Sector2Time")
                if s1 is not None and s2 is not None and not pd.isna(s1) and not pd.isna(s2):
                    tel = fastest_lap.get_telemetry()
                    if tel is not None and not tel.empty:
                        tel_time = tel["Time"].dt.total_seconds()
                        s1_secs = pd.Timedelta(s1).total_seconds()
                        s2_secs = s1_secs + pd.Timedelta(s2).total_seconds()
                        for t in [s1_secs, s2_secs]:
                            mask = tel_time >= t
                            if mask.any():
                                sector_distances.append(float(tel.loc[mask.idxmax(), "Distance"]))
        except Exception:
            logger.exception("Error computing sector distances")

        result = {
            "rotation": circuit_info.rotation,
            "corners": circuit_info.corners[["X", "Y", "Number", "Letter", "Angle", "Distance"]].rename(columns=str.lower).to_dict("records"),
            "marshal_sectors": circuit_info.marshal_sectors[["X", "Y", "Number", "Letter", "Angle", "Distance"]].rename(columns=str.lower).to_dict("records"),
            "sector_distances": sector_distances,
        }
        _circuit_cache[key] = result
        while len(_circuit_cache) > _CIRCUIT_CACHE_MAX:
            _circuit_cache.popitem(last=False)
        return result

def get_event(year: int, event_id: str):
    event = resolve_event(year, event_id)
    sessions = _get_event_sessions(event)

    return {
        "round": int(event["RoundNumber"]),
        "year": year,
        "name": event["EventName"],
        "country": event["Country"],
        "location": event["Location"],
        "date": str(event["EventDate"].date()),
        "format": event["EventFormat"],
        "sessions": sessions,
    }

def get_event_detailed(year: int, event_id: str, config: SessionDetailConfig = SessionDetailConfig()):
    event = resolve_event(year, event_id)
    round_num = int(event["RoundNumber"])
    sessions = _get_event_sessions_detailed(event, year, event_id, config)

    return {
        "round": round_num,
        "year": year,
        "name": event["EventName"],
        "country": event["Country"],
        "location": event["Location"],
        "date": str(event["EventDate"].date()),
        "format": event["EventFormat"],
        "sessions": sessions,
    }

def _get_event_sessions(event):
    sessions = []
    for i in range(1, 6):
        name = event.get(f"Session{i}")
        date = event.get(f"Session{i}Date")
        if not name or str(name).strip() == "":
            continue
        if pd.isna(date):
            continue
        identifier = SESSION_NAME_TO_IDENTIFIER.get(name, name)
        start_time = str(date.time())[:5]
        duration = SESSION_DURATION_MINUTES.get(identifier, 60)
        end_dt = date + timedelta(minutes=duration)
        end_time = str(end_dt.time())[:5] if end_dt else None
        status = _event_status(end_dt, start_date=date)

        sessions.append({
            "name": name,
            "identifier": identifier,
            "date": str(date.date()),
            "start_time": start_time,
            "end_time": end_time,
            "status": status,
        })
    return sessions

def _get_event_sessions_detailed(event, year: int, event_id: str, config: SessionDetailConfig):
    sessions = []
    for i in range(1, 6):
        name = event.get(f"Session{i}")
        date = event.get(f"Session{i}Date")
        if not name or str(name).strip() == "":
            continue
        if pd.isna(date):
            continue
        identifier = SESSION_NAME_TO_IDENTIFIER.get(name, name)
        start_time = str(date.time())[:5]
        duration = SESSION_DURATION_MINUTES.get(identifier, 60)
        end_dt = date + timedelta(minutes=duration)
        end_time = str(end_dt.time())[:5] if end_dt else None
        status = _event_status(end_dt, start_date=date)
        weather = None
        fastest_lap = None
        if status == "completed" and (config.weather or config.laps):
            weather, fastest_lap = _get_session_data(year, event_id, identifier, config)

        sessions.append({
            "name": name,
            "identifier": identifier,
            "date": str(date.date()),
            "start_time": start_time,
            "end_time": end_time,
            "status": status,
            "weather": weather,
            "fastest_lap": fastest_lap,
        })
    return sessions


def _get_session_data(year: int, event_id: str, identifier: str, config: SessionDetailConfig):
    try:
        session = resolve_session(year, event_id, identifier)
        session = cached_locked_load(session, year, event_id, identifier, laps=config.laps, telemetry=False, messages=False, weather=config.weather)

        weather = None
        w = session.weather_data if config.weather else None
        if w is not None and not w.empty:
            weather = {
                "air_temp": round_val(w["AirTemp"].mean()),
                "track_temp": round_val(w["TrackTemp"].mean()),
                "humidity": round_val(w["Humidity"].mean()),
                "wind_speed": round_val(w["WindSpeed"].mean()),
                "rainfall": bool(w["Rainfall"].any()),
            }

        fastest_lap = None
        if config.laps and session.laps is not None:
            lap = session.laps.pick_fastest()
            try:
                if lap is not None:
                    fastest_lap = format_lap_time(lap.get("LapTime"))
            except Exception:
                logger.exception("Error in _get_session_data trying to format lap time")

        return weather, fastest_lap
    except Exception:
        logger.exception("Error in _get_session_data")
        return None, None

def _event_status(date, start_date=None):
    if date is None:
        return "unknown"
    now = datetime.now(timezone.utc)
    event_date = date if isinstance(date, datetime) else datetime.combine(date, datetime.min.time(), tzinfo=timezone.utc)
    if event_date.tzinfo is None:
        event_date = event_date.replace(tzinfo=timezone.utc)
    if event_date <= now:
        return "completed"
    if start_date is not None:
        start = start_date if isinstance(start_date, datetime) else datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if start <= now:
            return "in_progress"
    return "upcoming"

def round_val(val):
    try:
        return round(float(val), 1)
    except Exception:
        return None


def _check_data_availability(year: int, round: int, identifier: str):
    try:
        session = fastf1.get_session(year, round, identifier)
        session.load(telemetry=False, weather=False, messages=False)
        laps = session.laps
        has_laps = laps is not None and not laps.empty
        has_telemetry = False
        if has_laps:
            try:
                tel = laps.iloc[0].get_telemetry()
                has_telemetry = tel is not None and not tel.empty
            except Exception:
                pass
        return {"telemetry_available": has_telemetry, "replay_available": has_telemetry}
    except Exception:
        return {"telemetry_available": False, "replay_available": False}
