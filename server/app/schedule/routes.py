from fastapi import APIRouter, Response

from app.schedule.services import get_schedule, get_event, get_event_detailed, get_circuit_info, get_podium, get_results
from app.schedule.schemas import (
    Schedule,
    Event,
    EventDetailed,
    ResultRow,
    PodiumEntry,
    CircuitInfo,
)
from app.caching import cache_control_for, cache_control_for_year
from .services import SessionDetailConfig


router = APIRouter()


@router.get("/{year}", response_model=Schedule)
def schedule(year: int, response: Response):
    data = get_schedule(year)
    response.headers["Cache-Control"] = cache_control_for_year(year)
    return data


@router.get("/{year}/{event_id}", response_model=Event)
def event_detail(year: int, event_id: str, response: Response):
    data = get_event(year, event_id)
    response.headers["Cache-Control"] = cache_control_for(year, event_id, "R")
    return data


@router.get("/{year}/{event_id}/detailed", response_model=EventDetailed)
def event_detail_detailed(year: int, event_id: str, response: Response, weather: bool = True, laps: bool = True):
    config = SessionDetailConfig(weather, laps)
    data = get_event_detailed(year, event_id, config)
    response.headers["Cache-Control"] = cache_control_for(year, event_id, "R")
    return data


@router.get("/{year}/{event_id}/{identifier}/results", response_model=list[ResultRow])
def results(year: int, event_id: str, identifier: str, response: Response):
    data = get_results(year, event_id, identifier)
    response.headers["Cache-Control"] = cache_control_for(year, event_id, identifier)
    return data


@router.get("/{year}/{event_id}/podium", response_model=list[PodiumEntry])
def podium(year: int, event_id: str, response: Response):
    data = get_podium(year, event_id)
    response.headers["Cache-Control"] = cache_control_for(year, event_id, "R")
    return data


@router.get("/{year}/{event_id}/circuit", response_model=CircuitInfo)
def circuit(year: int, event_id: str, response: Response):
    data = get_circuit_info(year, event_id)
    response.headers["Cache-Control"] = cache_control_for(year, event_id, "FP1")
    return data
