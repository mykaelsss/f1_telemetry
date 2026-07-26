from pydantic import BaseModel

class SessionDriver(BaseModel):
    number: str | None
    abbreviation: str | None
    full_name: str | None
    team_name: str | None
    team_color: str | None
    status: str | None
    classified_position: str | None
    position: int | None
    grid_position: int | None
    participated: bool


class SessionInfo(BaseModel):
    event_name: str
    name: str
    date: str
    country: str
    location: str
    drivers: list[SessionDriver]

class Lap(BaseModel):
    lap_number: int | None
    lap_time: str | None
    sector1: str | None
    sector2: str | None
    sector3: str | None
    compound: str | None
    is_personal_best: bool

class Segment(BaseModel):
    name: str
    laps: list[Lap]

class DriverLaps(BaseModel):
    abbreviation: str
    segments: list[Segment]


class TelemetryChannels(BaseModel):
    time: list[float]
    speed: list[float]
    throttle: list[float]
    brake: list[bool]
    gear: list[int]
    drs: list[int]
    distance: list[float]
    rpm: list[float]
    pos_time: list[float]
    x: list[float]
    y: list[float]


class LapTelemetry(BaseModel):
    driver: str
    lap_number: int
    lap_time: float | None
    sector1: float | None = None
    sector2: float | None = None
    sector3: float | None = None
    compound: str | None
    tyre_life: int | None
    channels: TelemetryChannels
