from pydantic import BaseModel


class ScheduleEvent(BaseModel):
    round: int
    identifier: str
    country: str
    location: str
    official_event_name: str
    event_name: str
    event_date_start: str
    event_date_end: str
    event_format: str
    status: str


class Schedule(BaseModel):
    year: int
    events: list[ScheduleEvent]


class EventSession(BaseModel):
    name: str
    identifier: str
    date: str
    start_time: str
    end_time: str | None
    status: str


class Event(BaseModel):
    round: int
    year: int
    name: str
    country: str
    location: str
    date: str
    format: str
    sessions: list[EventSession]


class Weather(BaseModel):
    air_temp: float | None
    track_temp: float | None
    humidity: float | None
    wind_speed: float | None
    rainfall: bool


class DetailedSession(BaseModel):
    name: str
    identifier: str
    date: str
    start_time: str
    end_time: str | None
    status: str
    weather: Weather | None
    fastest_lap: str | None


class EventDetailed(BaseModel):
    round: int
    year: int
    name: str
    country: str
    location: str
    date: str
    format: str
    sessions: list[DetailedSession]


class ResultRow(BaseModel):
    position: int
    code: str
    full_name: str
    team: str
    team_color: str
    grid: int | None
    laps: int | None
    time: str | None
    q1: str | None
    q2: str | None
    q3: str | None
    status: str | None
    points: float


class PodiumEntry(BaseModel):
    position: int
    code: str
    time: str


class CornerPoint(BaseModel):
    x: float
    y: float
    number: int
    letter: str = ""
    angle: float
    distance: float


class CircuitInfo(BaseModel):
    rotation: float
    corners: list[CornerPoint]
    marshal_sectors: list[CornerPoint]
    sector_distances: list[float]
