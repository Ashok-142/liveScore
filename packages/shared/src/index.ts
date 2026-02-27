export const EXTRA_TYPES = ["NONE", "WIDE", "NO_BALL", "BYE", "LEG_BYE"] as const;
export type ExtraType = (typeof EXTRA_TYPES)[number];

export const WICKET_TYPES = [
  "BOWLED",
  "CAUGHT",
  "LBW",
  "RUN_OUT",
  "STUMPED",
  "HIT_WICKET",
  "NONE"
] as const;
export type WicketType = (typeof WICKET_TYPES)[number];

export type MatchStatus = "SCHEDULED" | "LIVE" | "COMPLETED";

export interface TeamDTO {
  id: string;
  name: string;
  shortCode: string;
}

export interface PlayerDTO {
  id: string;
  teamId: string;
  name: string;
  role: string;
}

export interface MatchSummaryDTO {
  id: string;
  status: MatchStatus;
  homeTeamId: string;
  awayTeamId: string;
  currentInnings: number;
  oversLimit: number;
  innings: {
    id: string;
    number: number;
    battingTeamId: string;
    bowlingTeamId: string;
    runs: number;
    wickets: number;
    balls: number;
    overDisplay: string;
  }[];
}

export interface BallEventInput {
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  runsOffBat: number;
  extraType: ExtraType;
  extraRuns: number;
  isWicket: boolean;
  wicketType: WicketType;
  commentary?: string;
}
