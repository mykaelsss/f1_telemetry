import { VALID_QUALI_SESSIONS } from "./constants";

export type PodiumEntry = {
  position: number;
  code: string;
  time: string;
}

export type ScheduleEvent = {
  country: string,
  identifier: string,
  event_date_start: string,
  event_date_end: string,
  event_format: string,
  official_event_name: string,
  event_name: string,
  round: number,
  status: string,
  location: string,
  podium: PodiumEntry[] | null,
}

export type Schedule = {
  year: number,
  events: ScheduleEvent[]
}

export type Weather = {
  air_temp: number | null;
  track_temp: number | null;
  humidity: number | null;
  wind_speed: number | null;
  rainfall: boolean;
}

export type Session = {
  name: string;
  identifier: string;
  date: string; 
  start_time: string | null;
  end_time: string | null;
  status: string;
  weather: Weather | null;
  fastest_lap: string | null;
}

export type EventSchedule = {
  round: number;
  identifier: string;
  year: number;
  name: string;
  country: string;
  location: string;
  date: string;
  format: string;
  sessions: Session[];
}

type SessionSegment = { 
  name: string; 
  laps: Lap[] 
}

export type Lap = {
    lap_number: number | null
    lap_time: string | null
    sector1: string | null
    sector2: string | null
    sector3: string | null
    compound: string | null
    is_personal_best: boolean
}

export type LapChannels = {
  time: number[]
  speed: number[]
  throttle: number[]
  brake: boolean[]
  gear: number[]
  distance: number[]
  rpm: number[]
  x: number[]
  y: number[]
}

export type LapTelemetry = {
  driver: string,
  lap_number: number,
  lap_time: number | null,
  compound?: string | null,
  tyre_life?: number | null,
  channels: LapChannels
}

export type LapTelemetryWithSession = LapTelemetry & {
  year: string
  event: string
  session: string
}

export type SelectedLap = {
  year: string
  event: string
  session: string
  driver: string
  lap: number
}

export type Team = {
    name: string;
    color: string;
    drivers: Driver[]
}

export type Driver = {
    number: number
    abbreviation: string
    full_name: string
    team_name: string
    team_color: string
    status: string | null
    classified_position: string | null
    position: number | null
    grid_position: number | null
    participated: boolean
}

export type DriverLaps = {
      abbreviation: string
      segments: SessionSegment[]
  }

export type TelemetrySession = {
    event_name: string
    name: string
    date: string
    country: string
    location: string
    drivers: Driver[]
}

export type Corner = {
  x: number,
  y: number,
  number: number,
  angle: number,
  distance: number,
}

export type MarshalSector = Corner;

export type CircuitInfo = {
  rotation: number;
  corners: Corner[];
  marshal_sectors: MarshalSector[];
  sector_distances: number[];
}

export type Compound =
  | "HYPERSOFT"
  | "ULTRASOFT"
  | "SUPERSOFT"
  | "SOFT"
  | "MEDIUM"
  | "HARD"
  | "SUPERHARD"
  | "INTERMEDIATE"
  | "WET";

export type PointSymbol = 'circle' | 'rect' | 'roundRect' | 'triangle' | 'diamond' | 'pin' | 'arrow'
export type LineStyle = 'solid' | 'dashed' | 'dotted'

export type TelemetryChannelSettings = {
  smooth: boolean
  showSymbol: boolean
  symbol: PointSymbol
  symbolSize: number
  lineWidth: number
}

export type TelemetrySettings = {
  useGlobalSettings: boolean
  global: TelemetryChannelSettings
  channels: Record<string, TelemetryChannelSettings>
}

export interface ChartSettings {
    outlierThreshold: number
    smooth: boolean
    showSymbol: boolean
    symbol: PointSymbol
    symbolSize: number
    lineWidth: number
    firstDriverLineStyle: LineStyle
    secondDriverLineStyle: LineStyle
    zoomMode: 'scroll' | 'slider'
    showPitLaps: boolean
    showSafetyCar: boolean
}

export type QualiSession = typeof VALID_QUALI_SESSIONS[number]
