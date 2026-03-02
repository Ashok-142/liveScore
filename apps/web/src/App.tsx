import {
  TOSS_DECISIONS,
  WICKET_TYPES,
  type BallEventInput,
  type MatchSummaryDTO,
  type TossDecision
} from "@culbcric/shared";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

type Team = {
  id: string;
  name: string;
  shortCode: string;
  adminUserId?: string | null;
  adminUser?: {
    id: string;
    name: string;
    playerId: string;
  } | null;
  players: Player[];
  teamCareerStat?: {
    matchesPlayed: number;
    wins: number;
    losses: number;
    totalRunsScored: number;
    totalRunsConceded: number;
    totalWicketsTaken: number;
    totalWicketsLost: number;
  } | null;
};

type Player = {
  id: string;
  teamId: string;
  userId?: string | null;
  playerId?: string | null;
  name: string;
  role: string;
  careerStat?: {
    runsScored: number;
    ballsFaced: number;
    dismissals: number;
    fours: number;
    sixes: number;
    wicketsTaken: number;
    ballsBowled: number;
    runsConceded: number;
    dotBalls: number;
    catches: number;
    stumpings: number;
    runOuts: number;
  } | null;
};

type MatchListItem = {
  id: string;
  status: "SCHEDULED" | "LIVE" | "COMPLETED";
  homeTeamId: string;
  awayTeamId: string;
  winnerTeamId: string | null;
  tossWinnerTeamId: string | null;
  tossDecision: TossDecision | null;
  firstBattingTeamId: string | null;
  firstBowlingTeamId: string | null;
  oversLimit: number;
  currentInnings: number;
  innings: {
    number: number;
    runs: number;
    wickets: number;
    balls: number;
  }[];
};

type MatchDetail = {
  summary: MatchSummaryDTO;
  recentEvents: {
    id: string;
    overNumber: number;
    ballInOver: number;
    runsOffBat: number;
    extraType: string;
    extraRuns: number;
    isWicket: boolean;
    wicketType: string;
    commentary?: string;
    striker: { name: string };
    bowler: { name: string };
  }[];
  homePlayingXI: Player[];
  awayPlayingXI: Player[];
  homeCaptainPlayerId: string | null;
  homeViceCaptainPlayerId: string | null;
  awayCaptainPlayerId: string | null;
  awayViceCaptainPlayerId: string | null;
};

type RecentBallEvent = MatchDetail["recentEvents"][number];

type SetupForm = {
  tossWinnerTeamId: string;
  tossDecision: TossDecision;
  homePlayingXIPlayerIds: string[];
  awayPlayingXIPlayerIds: string[];
  homeCaptainPlayerId: string;
  homeViceCaptainPlayerId: string;
  awayCaptainPlayerId: string;
  awayViceCaptainPlayerId: string;
};

type DismissedBatter = "STRIKER" | "NON_STRIKER";

type ScoreInput = {
  runsOffBat: number;
  extraType: BallEventInput["extraType"];
  extraRuns: number;
  isWicket: boolean;
  wicketType: BallEventInput["wicketType"];
  dismissedBatter?: DismissedBatter;
  incomingBatterId?: string;
  crossedBeforeDismissal?: boolean;
  fielderId?: string;
};

type PlayerStatsRow = {
  teamId: string;
  teamName: string;
  teamShortCode: string;
  playerId: string;
  playerName: string;
  role: string;
  runsScored: number;
  ballsFaced: number;
  dismissals: number;
  fours: number;
  sixes: number;
  battingStrikeRate: number | null;
  battingAverage: number | null;
  oversBowled: string;
  ballsBowled: number;
  wicketsTaken: number;
  runsConceded: number;
  dotBalls: number;
  economy: number | null;
  bowlingAverage: number | null;
  bowlingStrikeRate: number | null;
  catches: number;
  stumpings: number;
  runOuts: number;
};

type AuthUser = {
  id: string;
  name: string;
  email: string;
  playerId: string;
};

type ProfileSetupData = {
  name: string;
  role: string;
  age: string;
  battingStyle: string;
  bowlingStyle: string;
  teams: string[];
  profileComplete: boolean;
};

type Tournament = {
  id: string;
  name: string;
  createdAt: string;
  createdBy: {
    id: string;
    name: string;
    playerId: string;
  };
  teams: {
    id: string;
    team: {
      id: string;
      name: string;
      shortCode: string;
    };
  }[];
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token =
    typeof window !== "undefined"
      ? window.localStorage.getItem("culbcric_token")
      : null;

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...options
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Request failed");
  }

  return (await response.json()) as T;
}

function oversFromBalls(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function inningsLabel(number: number): string {
  if (number === 1) {
    return "1st Innings";
  }

  if (number === 2) {
    return "2nd Innings";
  }

  if (number === 3) {
    return "3rd Innings";
  }

  return `${number}th Innings`;
}

function getDefaultXI(players: Player[]): string[] {
  return players.slice(0, 11).map((player) => player.id);
}

function sanitizeXI(selected: string[], players: Player[]): string[] {
  const allowed = new Set(players.map((player) => player.id));
  const filtered = selected.filter((id, index, arr) => allowed.has(id) && arr.indexOf(id) === index);

  if (filtered.length === 11) {
    return filtered;
  }

  return getDefaultXI(players);
}

function isLegalDelivery(extraType: BallEventInput["extraType"]): boolean {
  return extraType !== "WIDE" && extraType !== "NO_BALL";
}

function formatMetric(value: number | null): string {
  if (value === null || Number.isNaN(value) || !Number.isFinite(value)) {
    return "-";
  }

  return value.toFixed(2);
}

function runRateFrom(runs: number, balls: number): string {
  if (balls <= 0) {
    return "0.00";
  }

  return ((runs * 6) / balls).toFixed(2);
}

function ballEventLabel(event: RecentBallEvent): string {
  if (event.isWicket) {
    return "W";
  }

  if (event.extraType === "WIDE") {
    return "Wd";
  }

  if (event.extraType === "NO_BALL") {
    return "Nb";
  }

  if (event.extraType === "BYE") {
    return event.extraRuns > 1 ? `B${event.extraRuns}` : "B";
  }

  if (event.extraType === "LEG_BYE") {
    return event.extraRuns > 1 ? `Lb${event.extraRuns}` : "Lb";
  }

  return `${event.runsOffBat}`;
}

function resolveLeadership(
  selectedXI: string[],
  previousCaptainId: string,
  previousViceCaptainId: string
): { captainId: string; viceCaptainId: string } {
  if (selectedXI.length === 0) {
    return { captainId: "", viceCaptainId: "" };
  }

  const captainId = selectedXI.includes(previousCaptainId) ? previousCaptainId : selectedXI[0];
  const viceCaptainId =
    selectedXI.includes(previousViceCaptainId) && previousViceCaptainId !== captainId
      ? previousViceCaptainId
      : selectedXI.find((playerId) => playerId !== captainId) ?? captainId;

  return { captainId, viceCaptainId };
}

export default function App(): JSX.Element {
  const authLoadVersionRef = useRef(0);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [activeMatchId, setActiveMatchId] = useState<string>("");
  const [activeMatch, setActiveMatch] = useState<MatchDetail | null>(null);
  const [setupMatchId, setSetupMatchId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeTopTab, setActiveTopTab] = useState<
    "home" | "tournaments" | "matchSetup" | "live" | "stats"
  >("home");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authAccountType, setAuthAccountType] = useState<"personal" | "team">("personal");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [profileSetup, setProfileSetup] = useState<ProfileSetupData>({
    name: "",
    role: "",
    age: "",
    battingStyle: "",
    bowlingStyle: "",
    teams: [],
    profileComplete: false
  });
  const [profileTeamInput, setProfileTeamInput] = useState("");
  const [homeSelectedTeamId, setHomeSelectedTeamId] = useState<string>("ALL");
  const [homeStatsTab, setHomeStatsTab] = useState<"bat" | "bowl" | "field">("bat");
  const [selectedStatsTeamId, setSelectedStatsTeamId] = useState<string>("");
  const [selectedStatsPlayerId, setSelectedStatsPlayerId] = useState<string>("");

  const [setupTab, setSetupTab] = useState<"create" | "playingXI">("create");

  const [teamForm, setTeamForm] = useState({ name: "", shortCode: "" });
  const [playerForm, setPlayerForm] = useState({ teamId: "", name: "", role: "Batsman" });
  const [matchForm, setMatchForm] = useState({ homeTeamId: "", awayTeamId: "", oversLimit: 20 });
  const [adminTransferForm, setAdminTransferForm] = useState({ teamId: "", newAdminPlayerId: "" });
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentForm, setTournamentForm] = useState({ name: "", teamIds: [] as string[] });
  const [showTournamentCreate, setShowTournamentCreate] = useState(false);
  const [selectedTournamentIdForMatch, setSelectedTournamentIdForMatch] = useState("");

  const [setupForm, setSetupForm] = useState<SetupForm>({
    tossWinnerTeamId: "",
    tossDecision: "BAT",
    homePlayingXIPlayerIds: [],
    awayPlayingXIPlayerIds: [],
    homeCaptainPlayerId: "",
    homeViceCaptainPlayerId: "",
    awayCaptainPlayerId: "",
    awayViceCaptainPlayerId: ""
  });

  const [eventActors, setEventActors] = useState({ strikerId: "", nonStrikerId: "", bowlerId: "" });
  const [quickWicketType, setQuickWicketType] = useState<BallEventInput["wicketType"]>("BOWLED");
  const [quickDismissedBatter, setQuickDismissedBatter] = useState<DismissedBatter>("STRIKER");
  const [quickIncomingBatterId, setQuickIncomingBatterId] = useState("");
  const [quickFielderId, setQuickFielderId] = useState("");
  const [quickCrossedBeforeDismissal, setQuickCrossedBeforeDismissal] = useState(false);
  const [showBowlerPrompt, setShowBowlerPrompt] = useState(false);
  const [nextBowlerId, setNextBowlerId] = useState("");
  const [commentary, setCommentary] = useState("");

  const socket = useMemo(() => io(API_BASE, { transports: ["websocket", "polling"] }), []);

  useEffect(() => {
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    const onScoreUpdate = (summary: MatchSummaryDTO) => {
      setMatches((current) =>
        current.map((match) =>
          match.id === summary.id
            ? {
                ...match,
                status: summary.status,
                winnerTeamId: summary.winnerTeamId,
                tossWinnerTeamId: summary.tossWinnerTeamId,
                tossDecision: summary.tossDecision,
                firstBattingTeamId: summary.firstBattingTeamId,
                firstBowlingTeamId: summary.firstBowlingTeamId,
                currentInnings: summary.currentInnings,
                oversLimit: summary.oversLimit,
                innings: summary.innings.map((innings) => ({
                  number: innings.number,
                  runs: innings.runs,
                  wickets: innings.wickets,
                  balls: innings.balls
                }))
              }
            : match
        )
      );

      setActiveMatch((current) => {
        if (!current || current.summary.id !== summary.id) {
          return current;
        }

        return {
          ...current,
          summary
        };
      });
    };

    socket.on("score:update", onScoreUpdate);
    return () => {
      socket.off("score:update", onScoreUpdate);
    };
  }, [socket]);

  useEffect(() => {
    void loadAuthUser().catch((err: unknown) => {
      setError((err as Error).message);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!authChecked) {
      return;
    }

    authLoadVersionRef.current += 1;
    const currentVersion = authLoadVersionRef.current;

    if (!authUser) {
      setTeams([]);
      setMatches([]);
      setTournaments([]);
      setTournamentForm({ name: "", teamIds: [] });
      setShowTournamentCreate(false);
      setSelectedTournamentIdForMatch("");
      setActiveMatchId("");
      setActiveMatch(null);
      setSetupMatchId("");
      setActiveTopTab("home");
      return;
    }

    void Promise.all([loadTeams(authUser, currentVersion), loadMatches(currentVersion), loadTournaments(currentVersion)])
      .catch((err: unknown) => {
        if (currentVersion === authLoadVersionRef.current) {
          setError((err as Error).message);
        }
      });
  }, [authChecked, authUser]);

  useEffect(() => {
    setHomeSelectedTeamId("ALL");
    setHomeStatsTab("bat");
    setShowUserMenu(false);
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser) {
      setProfileSetup({
        name: "",
        role: "",
        age: "",
        battingStyle: "",
        bowlingStyle: "",
        teams: [],
        profileComplete: false
      });
      setProfileTeamInput("");
      return;
    }

    const baseProfile: ProfileSetupData = {
      name: authUser.name,
      role: "",
      age: "",
      battingStyle: "",
      bowlingStyle: "",
      teams: [],
      profileComplete: false
    };

    if (typeof window === "undefined") {
      setProfileSetup(baseProfile);
      return;
    }

    const key = `culbcric_profile_${authUser.id}`;
    const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem("playerProfile");
    if (!raw) {
      setProfileSetup(baseProfile);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<ProfileSetupData>;
      setProfileSetup({
        name: parsed.name?.trim() || authUser.name,
        role: parsed.role ?? "",
        age: parsed.age ?? "",
        battingStyle: parsed.battingStyle ?? "",
        bowlingStyle: parsed.bowlingStyle ?? "",
        teams: Array.isArray(parsed.teams) ? parsed.teams.filter((team) => typeof team === "string") : [],
        profileComplete: Boolean(parsed.profileComplete)
      });
    } catch {
      setProfileSetup(baseProfile);
    }
  }, [authUser?.id, authUser?.name]);

  useEffect(() => {
    if (!showUserMenu) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [showUserMenu]);

  useEffect(() => {
    if (!authUser || !activeMatchId) {
      setActiveMatch(null);
      return;
    }

    socket.emit("join:match", activeMatchId);
    void loadMatch(activeMatchId).catch((err: unknown) => setError((err as Error).message));

    return () => {
      socket.emit("leave:match", activeMatchId);
    };
  }, [activeMatchId, authUser, socket]);

  useEffect(() => {
    if (!setupMatchId && matches.length > 0) {
      const scheduled = matches.find((match) => match.status === "SCHEDULED");
      setSetupMatchId(scheduled?.id ?? matches[0].id);
      return;
    }

    if (setupMatchId && !matches.find((match) => match.id === setupMatchId)) {
      const scheduled = matches.find((match) => match.status === "SCHEDULED");
      setSetupMatchId(scheduled?.id ?? "");
    }
  }, [matches, setupMatchId]);

  useEffect(() => {
    if (tournaments.length === 0) {
      setSelectedTournamentIdForMatch("");
      return;
    }

    setSelectedTournamentIdForMatch((previous) =>
      tournaments.some((tournament) => tournament.id === previous) ? previous : tournaments[0].id
    );
  }, [tournaments]);

  useEffect(() => {
    const selectedTournament = tournaments.find((tournament) => tournament.id === selectedTournamentIdForMatch);
    const selectableTeams = selectedTournament?.teams.map((entry) => entry.team) ?? [];

    if (selectableTeams.length < 2) {
      setMatchForm((prev) => ({ ...prev, homeTeamId: "", awayTeamId: "" }));
      return;
    }

    setMatchForm((prev) => {
      const homeTeamId = selectableTeams.some((team) => team.id === prev.homeTeamId)
        ? prev.homeTeamId
        : selectableTeams[0].id;
      const awayTeamId =
        selectableTeams.some((team) => team.id === prev.awayTeamId && team.id !== homeTeamId)
          ? prev.awayTeamId
          : selectableTeams.find((team) => team.id !== homeTeamId)?.id ?? "";

      return {
        ...prev,
        homeTeamId,
        awayTeamId
      };
    });
  }, [selectedTournamentIdForMatch, tournaments]);

  const setupMatch = matches.find((match) => match.id === setupMatchId);
  const setupHomeTeam = teams.find((team) => team.id === setupMatch?.homeTeamId);
  const setupAwayTeam = teams.find((team) => team.id === setupMatch?.awayTeamId);
  const setupHomeSquad = setupHomeTeam?.players ?? [];
  const setupAwaySquad = setupAwayTeam?.players ?? [];
  const selectedHomeXIPlayers = setupForm.homePlayingXIPlayerIds
    .map((playerId) => setupHomeSquad.find((player) => player.id === playerId))
    .filter((player): player is Player => Boolean(player));
  const selectedAwayXIPlayers = setupForm.awayPlayingXIPlayerIds
    .map((playerId) => setupAwaySquad.find((player) => player.id === playerId))
    .filter((player): player is Player => Boolean(player));

  useEffect(() => {
    if (!setupMatch || !setupHomeTeam || !setupAwayTeam) {
      return;
    }

    setSetupForm((prev) => {
      const nextHomeXI = sanitizeXI(prev.homePlayingXIPlayerIds, setupHomeSquad);
      const nextAwayXI = sanitizeXI(prev.awayPlayingXIPlayerIds, setupAwaySquad);
      const homeLeadership = resolveLeadership(nextHomeXI, prev.homeCaptainPlayerId, prev.homeViceCaptainPlayerId);
      const awayLeadership = resolveLeadership(nextAwayXI, prev.awayCaptainPlayerId, prev.awayViceCaptainPlayerId);

      const tossWinnerTeamId =
        prev.tossWinnerTeamId === setupHomeTeam.id || prev.tossWinnerTeamId === setupAwayTeam.id
          ? prev.tossWinnerTeamId
          : setupHomeTeam.id;

      return {
        tossWinnerTeamId,
        tossDecision: prev.tossDecision,
        homePlayingXIPlayerIds: nextHomeXI,
        awayPlayingXIPlayerIds: nextAwayXI,
        homeCaptainPlayerId: homeLeadership.captainId,
        homeViceCaptainPlayerId: homeLeadership.viceCaptainId,
        awayCaptainPlayerId: awayLeadership.captainId,
        awayViceCaptainPlayerId: awayLeadership.viceCaptainId
      };
    });
  }, [setupMatch, setupHomeTeam, setupAwayTeam, setupHomeSquad, setupAwaySquad]);

  const lineupByTeam = useMemo(() => {
    if (!activeMatch) {
      return new Map<string, Player[]>();
    }

    return new Map<string, Player[]>([
      [activeMatch.summary.homeTeamId, activeMatch.homePlayingXI],
      [activeMatch.summary.awayTeamId, activeMatch.awayPlayingXI]
    ]);
  }, [activeMatch]);

  const currentInnings = activeMatch?.summary.innings.find(
    (innings) => innings.number === activeMatch.summary.currentInnings
  );

  const isLiveMatch = activeMatch?.summary.status === "LIVE";

  const battingTeamPlayers = currentInnings ? lineupByTeam.get(currentInnings.battingTeamId) ?? [] : [];
  const bowlingTeamPlayers = currentInnings ? lineupByTeam.get(currentInnings.bowlingTeamId) ?? [] : [];
  const nextBatterOptions = battingTeamPlayers.filter(
    (player) => player.id !== eventActors.strikerId && player.id !== eventActors.nonStrikerId
  );

  useEffect(() => {
    if (!battingTeamPlayers.length || !bowlingTeamPlayers.length) {
      return;
    }

    setEventActors((prev) => {
      const strikerId = battingTeamPlayers.some((player) => player.id === prev.strikerId)
        ? prev.strikerId
        : battingTeamPlayers[0].id;

      const nonStrikerCandidate = battingTeamPlayers.some((player) => player.id === prev.nonStrikerId)
        ? prev.nonStrikerId
        : battingTeamPlayers[Math.min(1, battingTeamPlayers.length - 1)].id;

      const nonStrikerId = nonStrikerCandidate === strikerId
        ? battingTeamPlayers.find((player) => player.id !== strikerId)?.id ?? strikerId
        : nonStrikerCandidate;

      const bowlerId = bowlingTeamPlayers.some((player) => player.id === prev.bowlerId)
        ? prev.bowlerId
        : bowlingTeamPlayers[0].id;

      return { strikerId, nonStrikerId, bowlerId };
    });
  }, [battingTeamPlayers, bowlingTeamPlayers]);

  useEffect(() => {
    if (quickWicketType !== "RUN_OUT") {
      setQuickDismissedBatter("STRIKER");
    }
  }, [quickWicketType]);

  useEffect(() => {
    const firstOption = nextBatterOptions[0]?.id ?? "";
    if (!firstOption) {
      setQuickIncomingBatterId("");
      return;
    }

    setQuickIncomingBatterId((prev) =>
      nextBatterOptions.some((player) => player.id === prev) ? prev : firstOption
    );
  }, [nextBatterOptions]);

  useEffect(() => {
    const firstFielder = bowlingTeamPlayers[0]?.id ?? "";
    if (!firstFielder) {
      setQuickFielderId("");
      return;
    }

    setQuickFielderId((prev) =>
      bowlingTeamPlayers.some((player) => player.id === prev) ? prev : firstFielder
    );
  }, [bowlingTeamPlayers]);

  useEffect(() => {
    if (!isLiveMatch) {
      setShowBowlerPrompt(false);
      setNextBowlerId("");
    }
  }, [isLiveMatch]);

  async function loadAuthUser(): Promise<void> {
    if (typeof window === "undefined") {
      setAuthChecked(true);
      return;
    }

    const token = window.localStorage.getItem("culbcric_token");
    if (!token) {
      setAuthUser(null);
      setAuthChecked(true);
      return;
    }

    try {
      const data = await api<{ user: AuthUser }>("/auth/me");
      setAuthUser(data.user);
    } catch {
      window.localStorage.removeItem("culbcric_token");
      setAuthUser(null);
    } finally {
      setAuthChecked(true);
    }
  }

  async function submitAuth(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const endpoint = authMode === "register" ? "/auth/register" : "/auth/login";
      const payload =
        authMode === "register"
          ? {
              name: authForm.name.trim(),
              email: authForm.email.trim(),
              password: authForm.password
            }
          : {
              email: authForm.email.trim(),
              password: authForm.password
            };

      const result = await api<{ token: string; user: AuthUser }>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (typeof window !== "undefined") {
        window.localStorage.setItem("culbcric_token", result.token);
      }

      setAuthUser(result.user);
      setActiveTopTab("home");
      setAuthChecked(true);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout(): Promise<void> {
    setBusy(true);
    setError("");

    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout failures and clear local session.
    } finally {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("culbcric_token");
      }
      setAuthUser(null);
      setAuthChecked(true);
      setBusy(false);
    }
  }

  function addProfileTeam(): void {
    const value = profileTeamInput.trim();
    if (!value) {
      return;
    }

    setProfileSetup((prev) => {
      if (prev.teams.some((team) => team.toLowerCase() === value.toLowerCase())) {
        return prev;
      }

      return {
        ...prev,
        teams: [...prev.teams, value]
      };
    });
    setProfileTeamInput("");
  }

  function removeProfileTeam(teamToRemove: string): void {
    setProfileSetup((prev) => ({
      ...prev,
      teams: prev.teams.filter((team) => team !== teamToRemove)
    }));
  }

  function saveProfileSetup(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();

    if (!authUser) {
      return;
    }

    const isValid =
      profileSetup.name.trim() &&
      profileSetup.role &&
      profileSetup.age &&
      profileSetup.battingStyle &&
      profileSetup.teams.length > 0;

    if (!isValid) {
      setError("Please complete all required profile fields.");
      return;
    }

    const nextProfile: ProfileSetupData = {
      ...profileSetup,
      name: profileSetup.name.trim(),
      profileComplete: true
    };

    if (typeof window !== "undefined") {
      const key = `culbcric_profile_${authUser.id}`;
      window.localStorage.setItem(key, JSON.stringify(nextProfile));
    }

    setError("");
    setProfileSetup(nextProfile);
    setActiveTopTab("home");
  }

  async function loadTeams(authUserOverride?: AuthUser | null, expectedVersion?: number): Promise<void> {
    const data = await api<Team[]>("/teams");
    if (expectedVersion !== undefined && expectedVersion !== authLoadVersionRef.current) {
      return;
    }

    setTeams(data);

    const currentAuthUser = authUserOverride === undefined ? authUser : authUserOverride;
    const manageable = currentAuthUser ? data.filter((team) => team.adminUserId === currentAuthUser.id) : [];
    if (!playerForm.teamId || !manageable.some((team) => team.id === playerForm.teamId)) {
      setPlayerForm((prev) => ({ ...prev, teamId: manageable[0]?.id ?? "" }));
    }

    if (!adminTransferForm.teamId || !manageable.some((team) => team.id === adminTransferForm.teamId)) {
      setAdminTransferForm((prev) => ({ ...prev, teamId: manageable[0]?.id ?? "" }));
    }
  }

  async function loadMatches(expectedVersion?: number): Promise<void> {
    const data = await api<MatchListItem[]>("/matches");
    if (expectedVersion !== undefined && expectedVersion !== authLoadVersionRef.current) {
      return;
    }

    setMatches(data);

    if (!activeMatchId) {
      const liveMatch = data.find((match) => match.status === "LIVE");
      const firstMatch = liveMatch ?? data[0];
      if (firstMatch) {
        setActiveMatchId(firstMatch.id);
      }
    }
  }

  async function loadTournaments(expectedVersion?: number): Promise<void> {
    const data = await api<Tournament[]>("/tournaments");
    if (expectedVersion !== undefined && expectedVersion !== authLoadVersionRef.current) {
      return;
    }

    setTournaments(data);
  }

  async function loadMatch(matchId: string): Promise<void> {
    const data = await api<MatchDetail>(`/matches/${matchId}`);
    setActiveMatch(data);
  }

  async function createTeam(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!authUser) {
      setError("Login required to create a team.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      await api("/teams", {
        method: "POST",
        body: JSON.stringify(teamForm)
      });
      setTeamForm({ name: "", shortCode: "" });
      await loadTeams();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createPlayer(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!authUser) {
      setError("Login required to add players.");
      return;
    }

    if (!playerForm.teamId) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await api(`/teams/${playerForm.teamId}/players`, {
        method: "POST",
        body: JSON.stringify({ name: playerForm.name, role: playerForm.role })
      });
      setPlayerForm((prev) => ({ ...prev, name: "", role: "Batsman" }));
      await loadTeams();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removePlayerFromTeam(teamId: string, playerId: string): Promise<void> {
    setBusy(true);
    setError("");

    try {
      await api(`/teams/${teamId}/players/${playerId}`, { method: "DELETE" });
      await loadTeams();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function transferTeamAdmin(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!adminTransferForm.teamId || !adminTransferForm.newAdminPlayerId.trim()) {
      setError("Select team and enter new admin player ID.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      await api(`/teams/${adminTransferForm.teamId}/admin`, {
        method: "POST",
        body: JSON.stringify({
          newAdminPlayerId: adminTransferForm.newAdminPlayerId.trim().toUpperCase()
        })
      });

      setAdminTransferForm((prev) => ({ ...prev, newAdminPlayerId: "" }));
      await loadTeams();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createMatch(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    const selectedTournament = tournaments.find((tournament) => tournament.id === selectedTournamentIdForMatch);
    if (!selectedTournament) {
      setError("Select a tournament first.");
      return;
    }

    const selectedTournamentTeamIds = new Set(selectedTournament.teams.map((entry) => entry.team.id));
    if (!selectedTournamentTeamIds.has(matchForm.homeTeamId) || !selectedTournamentTeamIds.has(matchForm.awayTeamId)) {
      setError("Match teams must belong to the selected tournament.");
      return;
    }

    if (matchForm.homeTeamId === matchForm.awayTeamId) {
      setError("Home and away teams must be different.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const match = await api<MatchListItem>("/matches", {
        method: "POST",
        body: JSON.stringify(matchForm)
      });

      await loadMatches();
      setActiveMatchId(match.id);
      setSetupMatchId(match.id);
      setSetupTab("playingXI");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleTournamentTeam(teamId: string): void {
    setTournamentForm((prev) => {
      if (prev.teamIds.includes(teamId)) {
        return {
          ...prev,
          teamIds: prev.teamIds.filter((id) => id !== teamId)
        };
      }

      return {
        ...prev,
        teamIds: [...prev.teamIds, teamId]
      };
    });
  }

  async function createTournament(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    if (!authUser) {
      setError("Login required to create tournaments.");
      return;
    }

    if (tournamentForm.teamIds.length < 2) {
      setError("Select at least two teams for the tournament.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      await api("/tournaments", {
        method: "POST",
        body: JSON.stringify({
          name: tournamentForm.name.trim(),
          teamIds: tournamentForm.teamIds
        })
      });

      setTournamentForm({ name: "", teamIds: [] });
      setShowTournamentCreate(false);
      await loadTournaments();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openMatchSetupFromTournament(tournamentId: string): void {
    setSelectedTournamentIdForMatch(tournamentId);
    setSetupTab("create");
    setActiveTopTab("matchSetup");
  }

  function togglePlayingXI(side: "home" | "away", playerId: string): void {
    const key = side === "home" ? "homePlayingXIPlayerIds" : "awayPlayingXIPlayerIds";

    setSetupForm((prev) => {
      const current = prev[key];
      const exists = current.includes(playerId);

      if (exists) {
        return {
          ...prev,
          [key]: current.filter((id) => id !== playerId)
        };
      }

      if (current.length >= 11) {
        return prev;
      }

      return {
        ...prev,
        [key]: [...current, playerId]
      };
    });
  }

  async function startMatchWithSetup(): Promise<void> {
    if (!setupMatch) {
      return;
    }

    if (setupForm.homePlayingXIPlayerIds.length !== 11 || setupForm.awayPlayingXIPlayerIds.length !== 11) {
      setError("Select exactly 11 players for both teams.");
      return;
    }

    if (
      !setupForm.homeCaptainPlayerId ||
      !setupForm.homeViceCaptainPlayerId ||
      !setupForm.awayCaptainPlayerId ||
      !setupForm.awayViceCaptainPlayerId
    ) {
      setError("Select captain and vice-captain for both teams.");
      return;
    }

    if (
      setupForm.homeCaptainPlayerId === setupForm.homeViceCaptainPlayerId ||
      setupForm.awayCaptainPlayerId === setupForm.awayViceCaptainPlayerId
    ) {
      setError("Captain and vice-captain must be different players.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      await api(`/matches/${setupMatch.id}/start`, {
        method: "POST",
        body: JSON.stringify(setupForm)
      });

      await Promise.all([loadMatches(), loadMatch(setupMatch.id)]);
      setActiveMatchId(setupMatch.id);
      setActiveTopTab("live");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function applyStrikeRotation(input: ScoreInput, previousBalls: number, shouldPromptNextBowler: boolean): void {
    let strikerEndPlayerId = eventActors.strikerId;
    let nonStrikerEndPlayerId = eventActors.nonStrikerId;

    const completedRuns = input.runsOffBat + input.extraRuns;
    const rotateForRuns = completedRuns % 2 === 1;
    const rotateForCrossing = Boolean(input.crossedBeforeDismissal) && completedRuns === 0;

    if (rotateForRuns || rotateForCrossing) {
      [strikerEndPlayerId, nonStrikerEndPlayerId] = [nonStrikerEndPlayerId, strikerEndPlayerId];
    }

    if (input.isWicket) {
      const dismissedPlayerId =
        input.dismissedBatter === "NON_STRIKER" ? eventActors.nonStrikerId : eventActors.strikerId;
      const incomingBatterId = input.incomingBatterId;

      if (!incomingBatterId) {
        throw new Error("Select the incoming batter for wicket.");
      }

      if (strikerEndPlayerId === dismissedPlayerId) {
        strikerEndPlayerId = incomingBatterId;
      } else if (nonStrikerEndPlayerId === dismissedPlayerId) {
        nonStrikerEndPlayerId = incomingBatterId;
      }
    }

    const overCompleted = isLegalDelivery(input.extraType) && (previousBalls + 1) % 6 === 0;

    if (overCompleted) {
      [strikerEndPlayerId, nonStrikerEndPlayerId] = [nonStrikerEndPlayerId, strikerEndPlayerId];
    }

    setEventActors((prev) => ({
      ...prev,
      strikerId: strikerEndPlayerId,
      nonStrikerId: nonStrikerEndPlayerId
    }));

    if (overCompleted && shouldPromptNextBowler) {
      const suggestedBowlerId =
        bowlingTeamPlayers.find((player) => player.id !== eventActors.bowlerId)?.id ??
        bowlingTeamPlayers[0]?.id ??
        "";
      setNextBowlerId(suggestedBowlerId);
      setShowBowlerPrompt(true);
    }
  }

  async function submitBallEvent(input: ScoreInput): Promise<void> {
    if (!activeMatchId) {
      return;
    }

    if (!eventActors.strikerId || !eventActors.nonStrikerId || !eventActors.bowlerId) {
      setError("Set striker, non-striker and bowler first.");
      return;
    }

    if (showBowlerPrompt) {
      setError("Select next over bowler to continue scoring.");
      return;
    }

    if (input.isWicket && !input.incomingBatterId) {
      setError("Select incoming batter before adding wicket.");
      return;
    }

    const dismissedPlayerId =
      input.isWicket && input.dismissedBatter === "NON_STRIKER" ? eventActors.nonStrikerId : eventActors.strikerId;
    const wicketNeedsFielder = input.isWicket && ["CAUGHT", "RUN_OUT", "STUMPED"].includes(input.wicketType);

    if (wicketNeedsFielder && !input.fielderId) {
      setError("Select fielder for this wicket.");
      return;
    }

    const previousBalls = currentInnings?.balls ?? 0;

    setBusy(true);
    setError("");

    try {
      const payload: BallEventInput = {
        strikerId: eventActors.strikerId,
        nonStrikerId: eventActors.nonStrikerId,
        bowlerId: eventActors.bowlerId,
        runsOffBat: input.runsOffBat,
        extraType: input.extraType,
        extraRuns: input.extraRuns,
        isWicket: input.isWicket,
        wicketType: input.isWicket ? input.wicketType : "NONE",
        dismissedPlayerId: input.isWicket ? dismissedPlayerId : undefined,
        fielderId: input.isWicket ? input.fielderId : undefined,
        commentary: commentary.trim() || undefined
      };

      const result = await api<{ summary: MatchSummaryDTO | null }>(`/matches/${activeMatchId}/events`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const inningsChanged =
        result.summary !== null && activeMatch !== null && result.summary.currentInnings !== activeMatch.summary.currentInnings;
      const matchCompleted = result.summary?.status === "COMPLETED";
      const shouldPromptNextBowler = !inningsChanged && !matchCompleted;

      applyStrikeRotation(input, previousBalls, shouldPromptNextBowler);
      if (inningsChanged || matchCompleted) {
        setShowBowlerPrompt(false);
        setNextBowlerId("");
      }

      await loadMatch(activeMatchId);
      await loadMatches();
      setCommentary("");
      setQuickCrossedBeforeDismissal(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function confirmNextOverBowler(): void {
    if (!nextBowlerId) {
      setError("Select a bowler for the new over.");
      return;
    }

    setEventActors((prev) => ({
      ...prev,
      bowlerId: nextBowlerId
    }));
    setShowBowlerPrompt(false);
  }

  function swapBatters(): void {
    setEventActors((prev) => ({
      ...prev,
      strikerId: prev.nonStrikerId,
      nonStrikerId: prev.strikerId
    }));
  }

  const activeMatchListItem = matches.find((match) => match.id === activeMatchId);
  const scoringLocked = busy || showBowlerPrompt;
  const firstInningsSummary = activeMatch?.summary.innings.find((innings) => innings.number === 1);
  const secondInningsSummary = activeMatch?.summary.innings.find((innings) => innings.number === 2);
  const winnerTeam = activeMatch?.summary.winnerTeamId
    ? teams.find((team) => team.id === activeMatch.summary.winnerTeamId)
    : null;
  const activeHomeTeam = activeMatch ? teams.find((team) => team.id === activeMatch.summary.homeTeamId) : null;
  const activeAwayTeam = activeMatch ? teams.find((team) => team.id === activeMatch.summary.awayTeamId) : null;
  const activeTossWinner = activeMatch?.summary.tossWinnerTeamId
    ? teams.find((team) => team.id === activeMatch.summary.tossWinnerTeamId)
    : null;
  const currentInningsTitle = currentInnings ? inningsLabel(currentInnings.number) : "";
  const chaseTarget = currentInnings?.number === 2 && firstInningsSummary ? firstInningsSummary.runs + 1 : null;
  const currentRunRate = currentInnings ? runRateFrom(currentInnings.runs, currentInnings.balls) : "0.00";
  const requiredRunRate = useMemo(() => {
    if (!currentInnings || currentInnings.number !== 2 || chaseTarget === null || !activeMatch) {
      return null;
    }

    const ballsRemaining = Math.max(0, activeMatch.summary.oversLimit * 6 - currentInnings.balls);
    const runsRequired = Math.max(0, chaseTarget - currentInnings.runs);

    if (ballsRemaining === 0) {
      return "0.00";
    }

    return runRateFrom(runsRequired, ballsRemaining);
  }, [activeMatch, chaseTarget, currentInnings]);
  const overGroups = useMemo(() => {
    if (!activeMatch) {
      return [] as { overNumber: number; balls: RecentBallEvent[] }[];
    }

    const grouped = new Map<number, RecentBallEvent[]>();
    activeMatch.recentEvents.forEach((event) => {
      const list = grouped.get(event.overNumber) ?? [];
      grouped.set(event.overNumber, [...list, event]);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([overNumber, balls]) => ({ overNumber, balls }));
  }, [activeMatch]);
  const currentOverBalls = overGroups[0]?.balls ?? [];
  const previousOverGroups = overGroups.slice(1);
  const activeLeadership = useMemo(() => {
    if (!activeMatch) {
      return new Map<string, string>();
    }

    const map = new Map<string, string>();
    if (activeMatch.homeCaptainPlayerId) {
      map.set(activeMatch.homeCaptainPlayerId, `${activeHomeTeam?.shortCode ?? "HOME"} C`);
    }
    if (activeMatch.homeViceCaptainPlayerId) {
      map.set(activeMatch.homeViceCaptainPlayerId, `${activeHomeTeam?.shortCode ?? "HOME"} VC`);
    }
    if (activeMatch.awayCaptainPlayerId) {
      map.set(activeMatch.awayCaptainPlayerId, `${activeAwayTeam?.shortCode ?? "AWAY"} C`);
    }
    if (activeMatch.awayViceCaptainPlayerId) {
      map.set(activeMatch.awayViceCaptainPlayerId, `${activeAwayTeam?.shortCode ?? "AWAY"} VC`);
    }
    return map;
  }, [activeAwayTeam?.shortCode, activeHomeTeam?.shortCode, activeMatch]);
  const manageableTeams = useMemo(
    () => (authUser ? teams.filter((team) => team.adminUserId === authUser.id) : []),
    [authUser, teams]
  );
  const selectedTournamentForMatch =
    tournaments.find((tournament) => tournament.id === selectedTournamentIdForMatch) ?? null;
  const selectedTournamentTeams = selectedTournamentForMatch?.teams.map((entry) => entry.team) ?? [];
  const tournamentStatusById = useMemo(() => {
    const status = new Map<string, "upcoming" | "ongoing" | "completed">();

    tournaments.forEach((tournament) => {
      const tournamentTeamIds = new Set(tournament.teams.map((entry) => entry.team.id));
      const tournamentMatches = matches.filter(
        (match) => tournamentTeamIds.has(match.homeTeamId) && tournamentTeamIds.has(match.awayTeamId)
      );

      if (tournamentMatches.some((match) => match.status === "LIVE")) {
        status.set(tournament.id, "ongoing");
        return;
      }

      if (tournamentMatches.length > 0 && tournamentMatches.every((match) => match.status === "COMPLETED")) {
        status.set(tournament.id, "completed");
        return;
      }

      status.set(tournament.id, "upcoming");
    });

    return status;
  }, [matches, tournaments]);
  const hasStartedMatch = matches.some((match) => match.status !== "SCHEDULED");

  const playerStatsRows = useMemo<PlayerStatsRow[]>(
    () =>
      teams.flatMap((team) =>
        team.players.map((player) => {
          const stat = player.careerStat;
          const runsScored = stat?.runsScored ?? 0;
          const ballsFaced = stat?.ballsFaced ?? 0;
          const dismissals = stat?.dismissals ?? 0;
          const ballsBowled = stat?.ballsBowled ?? 0;
          const runsConceded = stat?.runsConceded ?? 0;
          const wicketsTaken = stat?.wicketsTaken ?? 0;
          const battingStrikeRate = ballsFaced > 0 ? (runsScored * 100) / ballsFaced : null;
          const battingAverage = dismissals > 0 ? runsScored / dismissals : null;
          const economy = ballsBowled > 0 ? runsConceded / (ballsBowled / 6) : null;
          const bowlingAverage = wicketsTaken > 0 ? runsConceded / wicketsTaken : null;
          const bowlingStrikeRate = wicketsTaken > 0 ? ballsBowled / wicketsTaken : null;

          return {
            teamId: team.id,
            teamName: team.name,
            teamShortCode: team.shortCode,
            playerId: player.id,
            playerName: player.name,
            role: player.role,
            runsScored,
            ballsFaced,
            dismissals,
            fours: stat?.fours ?? 0,
            sixes: stat?.sixes ?? 0,
            battingStrikeRate,
            battingAverage,
            oversBowled: oversFromBalls(ballsBowled),
            ballsBowled,
            wicketsTaken,
            runsConceded,
            dotBalls: stat?.dotBalls ?? 0,
            economy,
            bowlingAverage,
            bowlingStrikeRate,
            catches: stat?.catches ?? 0,
            stumpings: stat?.stumpings ?? 0,
            runOuts: stat?.runOuts ?? 0
          };
        })
      ),
    [teams]
  );

  const linkedPlayerIds = useMemo(() => {
    if (!authUser) {
      return new Set<string>();
    }

    const normalizedName = authUser.name.trim().toLowerCase();
    const ids = new Set<string>();

    teams.forEach((team) => {
      team.players.forEach((player) => {
        const matchesUserId = player.userId === authUser.id;
        const matchesPlayerId = Boolean(player.playerId && player.playerId === authUser.playerId);
        const matchesName = player.name.trim().toLowerCase() === normalizedName;

        if (matchesUserId || matchesPlayerId || matchesName) {
          ids.add(player.id);
        }
      });
    });

    return ids;
  }, [authUser, teams]);

  const homePlayerRows = useMemo(() => {
    if (!authUser) {
      return [];
    }

    const normalizedName = authUser.name.trim().toLowerCase();
    const linkedRows = playerStatsRows.filter((row) => linkedPlayerIds.has(row.playerId));
    if (linkedRows.length > 0) {
      return linkedRows;
    }

    return playerStatsRows.filter((row) => row.playerName.trim().toLowerCase() === normalizedName);
  }, [authUser, linkedPlayerIds, playerStatsRows]);

  const homeTeamOptions = useMemo(() => {
    const unique = new Map<string, { teamId: string; teamName: string; teamShortCode: string }>();

    homePlayerRows.forEach((row) => {
      if (!unique.has(row.teamId)) {
        unique.set(row.teamId, {
          teamId: row.teamId,
          teamName: row.teamName,
          teamShortCode: row.teamShortCode
        });
      }
    });

    return Array.from(unique.values());
  }, [homePlayerRows]);

  useEffect(() => {
    if (homeSelectedTeamId === "ALL") {
      return;
    }

    if (!homeTeamOptions.some((team) => team.teamId === homeSelectedTeamId)) {
      setHomeSelectedTeamId("ALL");
    }
  }, [homeSelectedTeamId, homeTeamOptions]);

  const homeFilteredRows = useMemo(
    () =>
      homeSelectedTeamId === "ALL"
        ? homePlayerRows
        : homePlayerRows.filter((row) => row.teamId === homeSelectedTeamId),
    [homePlayerRows, homeSelectedTeamId]
  );

  const homeAggregatedStats = useMemo(() => {
    if (homeFilteredRows.length === 0) {
      return null;
    }

    const totals = homeFilteredRows.reduce(
      (acc, row) => {
        acc.runsScored += row.runsScored;
        acc.ballsFaced += row.ballsFaced;
        acc.dismissals += row.dismissals;
        acc.fours += row.fours;
        acc.sixes += row.sixes;
        acc.ballsBowled += row.ballsBowled;
        acc.wicketsTaken += row.wicketsTaken;
        acc.runsConceded += row.runsConceded;
        acc.dotBalls += row.dotBalls;
        acc.catches += row.catches;
        acc.stumpings += row.stumpings;
        acc.runOuts += row.runOuts;
        return acc;
      },
      {
        runsScored: 0,
        ballsFaced: 0,
        dismissals: 0,
        fours: 0,
        sixes: 0,
        ballsBowled: 0,
        wicketsTaken: 0,
        runsConceded: 0,
        dotBalls: 0,
        catches: 0,
        stumpings: 0,
        runOuts: 0
      }
    );

    return {
      ...totals,
      oversBowled: oversFromBalls(totals.ballsBowled),
      battingStrikeRate: totals.ballsFaced > 0 ? (totals.runsScored * 100) / totals.ballsFaced : null,
      battingAverage: totals.dismissals > 0 ? totals.runsScored / totals.dismissals : null,
      economy: totals.ballsBowled > 0 ? totals.runsConceded / (totals.ballsBowled / 6) : null,
      bowlingAverage: totals.wicketsTaken > 0 ? totals.runsConceded / totals.wicketsTaken : null,
      bowlingStrikeRate: totals.wicketsTaken > 0 ? totals.ballsBowled / totals.wicketsTaken : null
    };
  }, [homeFilteredRows]);

  const homeDisplayName =
    profileSetup.name.trim() || homeFilteredRows[0]?.playerName || homePlayerRows[0]?.playerName || authUser?.name || "Player";
  const homeDisplayRole = profileSetup.role || homeFilteredRows[0]?.role || homePlayerRows[0]?.role || "Cricketer";
  const homeDisplayTeams =
    profileSetup.profileComplete && profileSetup.teams.length > 0
      ? profileSetup.teams
      : homeTeamOptions.map((team) => team.teamName);
  const selectedHomeTeamLabel =
    homeSelectedTeamId === "ALL"
      ? "All Teams"
      : homeTeamOptions.find((team) => team.teamId === homeSelectedTeamId)?.teamName ?? "Team";

  const homeRecentMatches = useMemo(() => {
    if (homeTeamOptions.length === 0) {
      return [];
    }

    const teamIds = new Set(homeTeamOptions.map((team) => team.teamId));
    const recent = matches
      .filter((match) => teamIds.has(match.homeTeamId) || teamIds.has(match.awayTeamId))
      .slice()
      .reverse()
      .slice(0, 6);

    return recent.map((match) => {
      const home = teams.find((team) => team.id === match.homeTeamId);
      const away = teams.find((team) => team.id === match.awayTeamId);
      const score = match.innings[match.innings.length - 1];
      const winner = teams.find((team) => team.id === match.winnerTeamId);

      let result = "Scheduled";
      if (match.status === "LIVE") {
        result = "Live";
      } else if (match.status === "COMPLETED") {
        result = winner ? `${winner.shortCode} won` : "Tied";
      }

      return {
        id: match.id,
        fixture: `${home?.shortCode ?? "HOME"} vs ${away?.shortCode ?? "AWAY"}`,
        score: score ? `${score.runs}/${score.wickets} (${oversFromBalls(score.balls)})` : "-",
        status: match.status,
        result
      };
    });
  }, [homeTeamOptions, matches, teams]);

  const playerStatsByTeam = useMemo(
    () =>
      teams
        .map((team) => ({
          teamId: team.id,
          teamName: team.name,
          teamShortCode: team.shortCode,
          players: playerStatsRows.filter((row) => row.teamId === team.id)
        }))
        .filter((team) => team.players.length > 0),
    [teams, playerStatsRows]
  );

  useEffect(() => {
    if (playerStatsByTeam.length === 0) {
      setSelectedStatsTeamId("");
      return;
    }

    setSelectedStatsTeamId((previous) =>
      playerStatsByTeam.some((team) => team.teamId === previous) ? previous : ""
    );
  }, [playerStatsByTeam]);

  const selectedStatsTeam = playerStatsByTeam.find((team) => team.teamId === selectedStatsTeamId) ?? null;
  const selectedTeamPlayers = selectedStatsTeam?.players ?? [];

  useEffect(() => {
    if (selectedTeamPlayers.length === 0) {
      setSelectedStatsPlayerId("");
      return;
    }

    setSelectedStatsPlayerId((previous) =>
      selectedTeamPlayers.some((row) => row.playerId === previous) ? previous : ""
    );
  }, [selectedTeamPlayers]);

  const selectedStatsPlayer = selectedTeamPlayers.find((row) => row.playerId === selectedStatsPlayerId) ?? null;
  const selectedLeadership = selectedStatsPlayer ? activeLeadership.get(selectedStatsPlayer.playerId) ?? null : null;

  let matchResultText = "";
  if (activeMatch?.summary.status === "COMPLETED") {
    if (winnerTeam && firstInningsSummary && secondInningsSummary) {
      if (activeMatch.summary.winnerTeamId === firstInningsSummary.battingTeamId) {
        const runMargin = firstInningsSummary.runs - secondInningsSummary.runs;
        matchResultText = `${winnerTeam.name} won by ${runMargin} run${runMargin === 1 ? "" : "s"}.`;
      } else {
        const wicketsLeft = Math.max(0, 10 - secondInningsSummary.wickets);
        matchResultText = `${winnerTeam.name} won by ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}.`;
      }
    } else {
      matchResultText = "Match tied.";
    }
  }

  const authVisualPanel = (
    <aside className="auth-visual">
      <div className="auth-visual-content">
        <h2>Culbcric</h2>
        <p className="auth-visual-subtitle">Your ultimate cricket management platform</p>
        <p className="auth-visual-copy">
          Track live scores, manage teams and tournaments, and keep every player statistic in one place.
        </p>
      </div>
    </aside>
  );

  const authFormSection = (
    <section className="auth-screen">
      {authVisualPanel}
      <article className="auth-card">
        <div className="auth-card-inner">
          <div className="auth-card-head">
            <h2>{authMode === "register" ? "Create Your Account" : "Welcome to Culbcric"}</h2>
            <p>
              {authMode === "register" ? "Sign up to access your cricket world" : "Sign in to continue"}
            </p>
          </div>
          <div className="auth-account-tabs">
            <button
              type="button"
              className={authAccountType === "personal" ? "active" : ""}
              onClick={() => setAuthAccountType("personal")}
            >
              Personal
            </button>
            <button
              type="button"
              className={authAccountType === "team" ? "active" : ""}
              onClick={() => setAuthAccountType("team")}
            >
              Team
            </button>
          </div>
          <form className="auth-form auth-form-styled" onSubmit={submitAuth}>
            {authMode === "register" ? (
              <label>
                Name
                <div className="auth-input-wrap icon-user">
                  <input
                    value={authForm.name}
                    onChange={(e) => setAuthForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Your name"
                    required
                  />
                </div>
              </label>
            ) : null}
            <label>
              Email
              <div className="auth-input-wrap icon-mail">
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="name@example.com"
                  required
                />
              </div>
            </label>
            <label>
              Password
              <div className="auth-input-wrap icon-lock">
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Enter password"
                  required
                />
              </div>
            </label>
            {authMode === "login" ? (
              <button
                type="button"
                className="auth-inline-link"
                onClick={() => undefined}
              >
                Forgot Password?
              </button>
            ) : null}
            <button disabled={busy}>{authMode === "register" ? "Create Account" : "Sign In"}</button>
          </form>
          <div className="auth-switch-row">
            <span>{authMode === "register" ? "Already have an account?" : "Don't have an account?"}</span>
            <button
              type="button"
              className="auth-inline-link"
              onClick={() => setAuthMode((prev) => (prev === "login" ? "register" : "login"))}
            >
              {authMode === "register" ? "Sign in" : "Create account"}
            </button>
          </div>
        </div>
      </article>
    </section>
  );

  const profileSetupPanel = (
    <section className="profile-setup-page">
      <article className="panel profile-setup-card">
        <div className="profile-setup-head">
          <h2>Complete Your Cricket Profile</h2>
          <p>Set up your player information before entering the dashboard.</p>
        </div>
        <form className="profile-setup-form" onSubmit={saveProfileSetup}>
          <label>
            Full Name
            <input
              value={profileSetup.name}
              onChange={(e) => setProfileSetup((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Enter your full name"
              required
            />
          </label>

          <label>
            Playing Role
            <select
              value={profileSetup.role}
              onChange={(e) => setProfileSetup((prev) => ({ ...prev, role: e.target.value }))}
              required
            >
              <option value="">Select role</option>
              <option value="Batsman">Batsman</option>
              <option value="Bowler">Bowler</option>
              <option value="All-Rounder">All-Rounder</option>
              <option value="Wicket-Keeper">Wicket-Keeper</option>
            </select>
          </label>

          <label>
            Age
            <input
              type="number"
              min={10}
              max={100}
              value={profileSetup.age}
              onChange={(e) => setProfileSetup((prev) => ({ ...prev, age: e.target.value }))}
              placeholder="Enter your age"
              required
            />
          </label>

          <label>
            Batting Style
            <select
              value={profileSetup.battingStyle}
              onChange={(e) => setProfileSetup((prev) => ({ ...prev, battingStyle: e.target.value }))}
              required
            >
              <option value="">Select batting style</option>
              <option value="Right-Hand Bat">Right-Hand Bat</option>
              <option value="Left-Hand Bat">Left-Hand Bat</option>
            </select>
          </label>

          <label>
            Bowling Style
            <select
              value={profileSetup.bowlingStyle}
              onChange={(e) => setProfileSetup((prev) => ({ ...prev, bowlingStyle: e.target.value }))}
            >
              <option value="">Select bowling style (optional)</option>
              <option value="Right-Arm Fast">Right-Arm Fast</option>
              <option value="Left-Arm Fast">Left-Arm Fast</option>
              <option value="Right-Arm Medium">Right-Arm Medium</option>
              <option value="Left-Arm Medium">Left-Arm Medium</option>
              <option value="Right-Arm Off-Spin">Right-Arm Off-Spin</option>
              <option value="Right-Arm Leg-Spin">Right-Arm Leg-Spin</option>
              <option value="Left-Arm Orthodox">Left-Arm Orthodox</option>
              <option value="Left-Arm Chinaman">Left-Arm Chinaman</option>
              <option value="N/A">N/A</option>
            </select>
          </label>

          <div className="profile-team-picker">
            <label>
              Teams
              <div className="profile-team-input-row">
                <input
                  value={profileTeamInput}
                  onChange={(e) => setProfileTeamInput(e.target.value)}
                  placeholder="Add team name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addProfileTeam();
                    }
                  }}
                />
                <button type="button" className="secondary" onClick={addProfileTeam}>
                  Add
                </button>
              </div>
            </label>
            <div className="profile-team-chips">
              {profileSetup.teams.map((team) => (
                <span key={team} className="profile-team-chip">
                  {team}
                  <button type="button" onClick={() => removeProfileTeam(team)} aria-label={`Remove ${team}`}>
                    x
                  </button>
                </span>
              ))}
            </div>
            <p>Add at least one team you've played for.</p>
          </div>

          <button
            disabled={
              busy ||
              !profileSetup.name.trim() ||
              !profileSetup.role ||
              !profileSetup.age ||
              !profileSetup.battingStyle ||
              profileSetup.teams.length === 0
            }
          >
            Complete Profile
          </button>
        </form>
      </article>
    </section>
  );

  const playerHomePanel = (
    <section className="player-home">
      <article className="panel player-home-hero">
        <div className="player-home-banner" />
        <div className="player-home-hero-content">
          <div className="player-home-avatar">{homeDisplayName.charAt(0).toUpperCase()}</div>
          <div className="player-home-hero-meta">
            <h2>{homeDisplayName}</h2>
            <p>{homeDisplayTeams.length ? homeDisplayTeams.join(" • ") : "No teams linked yet"}</p>
            <div className="player-home-badges">
              <span className="player-home-badge">{homeDisplayRole}</span>
              <span className="player-home-badge subtle">{selectedHomeTeamLabel}</span>
            </div>
          </div>
        </div>
      </article>

      <div className="player-home-grid">
        <article className="panel player-home-info">
          <h3>Player Information</h3>
          <div className="player-home-info-list">
            <div>
              <small>Name</small>
              <strong>{profileSetup.name || authUser?.name || "-"}</strong>
            </div>
            <div>
              <small>Player ID</small>
              <strong>{authUser?.playerId ?? "-"}</strong>
            </div>
            <div>
              <small>Email</small>
              <strong>{authUser?.email ?? "-"}</strong>
            </div>
            <div>
              <small>Teams</small>
              <strong>{homeDisplayTeams.length}</strong>
            </div>
            <div>
              <small>Age</small>
              <strong>{profileSetup.age ? `${profileSetup.age} years` : "-"}</strong>
            </div>
            <div>
              <small>Batting Style</small>
              <strong>{profileSetup.battingStyle || "-"}</strong>
            </div>
            <div>
              <small>Bowling Style</small>
              <strong>{profileSetup.bowlingStyle || "-"}</strong>
            </div>
          </div>
          <label>
            Team Filter
            <select value={homeSelectedTeamId} onChange={(e) => setHomeSelectedTeamId(e.target.value)}>
              <option value="ALL">All Teams</option>
              {homeTeamOptions.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.teamName} ({team.teamShortCode})
                </option>
              ))}
            </select>
          </label>
        </article>

        <article className="panel player-home-stats">
          <div className="player-home-stats-head">
            <h3>Career Statistics</h3>
            <span>{selectedHomeTeamLabel}</span>
          </div>
          <div className="player-home-tabs">
            <button
              type="button"
              className={homeStatsTab === "bat" ? "active" : ""}
              onClick={() => setHomeStatsTab("bat")}
            >
              Bat
            </button>
            <button
              type="button"
              className={homeStatsTab === "bowl" ? "active" : ""}
              onClick={() => setHomeStatsTab("bowl")}
            >
              Bowl
            </button>
            <button
              type="button"
              className={homeStatsTab === "field" ? "active" : ""}
              onClick={() => setHomeStatsTab("field")}
            >
              Field
            </button>
          </div>

          {!homeAggregatedStats ? (
            <p className="player-home-empty">No player stats available yet. Create team/player data to populate this profile.</p>
          ) : null}

          {homeAggregatedStats && homeStatsTab === "bat" ? (
            <div className="player-home-metrics">
              <article><small>Runs</small><strong>{homeAggregatedStats.runsScored}</strong></article>
              <article><small>Balls</small><strong>{homeAggregatedStats.ballsFaced}</strong></article>
              <article><small>Strike Rate</small><strong>{formatMetric(homeAggregatedStats.battingStrikeRate)}</strong></article>
              <article><small>Average</small><strong>{formatMetric(homeAggregatedStats.battingAverage)}</strong></article>
              <article><small>4s</small><strong>{homeAggregatedStats.fours}</strong></article>
              <article><small>6s</small><strong>{homeAggregatedStats.sixes}</strong></article>
            </div>
          ) : null}

          {homeAggregatedStats && homeStatsTab === "bowl" ? (
            <div className="player-home-metrics">
              <article><small>Overs</small><strong>{homeAggregatedStats.oversBowled}</strong></article>
              <article><small>Wickets</small><strong>{homeAggregatedStats.wicketsTaken}</strong></article>
              <article><small>Runs Conceded</small><strong>{homeAggregatedStats.runsConceded}</strong></article>
              <article><small>Economy</small><strong>{formatMetric(homeAggregatedStats.economy)}</strong></article>
              <article><small>Bowling Avg</small><strong>{formatMetric(homeAggregatedStats.bowlingAverage)}</strong></article>
              <article><small>Strike Rate</small><strong>{formatMetric(homeAggregatedStats.bowlingStrikeRate)}</strong></article>
            </div>
          ) : null}

          {homeAggregatedStats && homeStatsTab === "field" ? (
            <div className="player-home-metrics">
              <article><small>Catches</small><strong>{homeAggregatedStats.catches}</strong></article>
              <article><small>Run Outs</small><strong>{homeAggregatedStats.runOuts}</strong></article>
              <article><small>Stumpings</small><strong>{homeAggregatedStats.stumpings}</strong></article>
              <article><small>Total Dismissals</small><strong>{homeAggregatedStats.catches + homeAggregatedStats.runOuts + homeAggregatedStats.stumpings}</strong></article>
            </div>
          ) : null}
        </article>
      </div>

      <article className="panel player-home-recent">
        <h3>Recent Match Activity</h3>
        {homeRecentMatches.length === 0 ? (
          <p className="player-home-empty">No match activity for linked teams yet.</p>
        ) : (
          <div className="player-home-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fixture</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {homeRecentMatches.map((item) => (
                  <tr key={item.id}>
                    <td>{item.fixture}</td>
                    <td>{item.score}</td>
                    <td>{item.status}</td>
                    <td>{item.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );

  const createTeamPanel = (
    <section className="panel setup-v4-card setup-v4-team-card">
      <h2>Create Team</h2>
      <form onSubmit={createTeam}>
        <label>
          Team Name
          <input
            value={teamForm.name}
            onChange={(e) => setTeamForm((prev) => ({ ...prev, name: e.target.value }))}
            required={Boolean(authUser)}
            disabled={!authUser}
            placeholder="Mumbai Titans"
          />
        </label>
        <label>
          Short Code
          <input
            value={teamForm.shortCode}
            onChange={(e) => setTeamForm((prev) => ({ ...prev, shortCode: e.target.value.toUpperCase() }))}
            required={Boolean(authUser)}
            disabled={!authUser}
            maxLength={5}
            placeholder="MT"
          />
        </label>
        <button disabled={busy || !authUser}>Save Team (You become Admin)</button>
      </form>

      <form onSubmit={createPlayer}>
        <label>
          Team
          <select
            value={playerForm.teamId}
            onChange={(e) => setPlayerForm((prev) => ({ ...prev, teamId: e.target.value }))}
            required={Boolean(authUser)}
            disabled={!authUser || manageableTeams.length === 0}
          >
            <option value="">Select team</option>
            {manageableTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} ({team.shortCode})
              </option>
            ))}
          </select>
        </label>
        <label>
          Player Name
          <input
            value={playerForm.name}
            onChange={(e) => setPlayerForm((prev) => ({ ...prev, name: e.target.value }))}
            required={Boolean(authUser)}
            disabled={!authUser}
            placeholder="Rahul Sharma"
          />
        </label>
        <label>
          Role
          <select
            value={playerForm.role}
            onChange={(e) => setPlayerForm((prev) => ({ ...prev, role: e.target.value }))}
            disabled={!authUser}
          >
            <option>Batsman</option>
            <option>Bowler</option>
            <option>All-Rounder</option>
            <option>Wicket-Keeper</option>
          </select>
        </label>
        <button disabled={busy || !authUser || manageableTeams.length === 0}>Save Player</button>
      </form>

      <div className="admin-section">
        <h3>Admin Controls</h3>
        {manageableTeams.length === 0 ? (
          <p>You are not admin of any team yet.</p>
        ) : (
          <>
            {manageableTeams.map((team) => (
              <div key={team.id} className="admin-team-card">
                <strong>
                  {team.name} ({team.shortCode})
                </strong>
                <small>Current Admin: {team.adminUser?.name ?? "Unknown"} ({team.adminUser?.playerId ?? "--"})</small>
                <ul className="list compact">
                  {team.players.map((player) => (
                    <li key={player.id} className="admin-player-row">
                      <span>
                        {player.name} ({player.role})
                      </span>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void removePlayerFromTeam(team.id, player.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <form onSubmit={transferTeamAdmin}>
              <label>
                Team
                <select
                  value={adminTransferForm.teamId}
                  onChange={(e) => setAdminTransferForm((prev) => ({ ...prev, teamId: e.target.value }))}
                  required
                >
                  <option value="">Select team</option>
                  {manageableTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.shortCode})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                New Admin Player ID
                <input
                  value={adminTransferForm.newAdminPlayerId}
                  onChange={(e) =>
                    setAdminTransferForm((prev) => ({ ...prev, newAdminPlayerId: e.target.value.toUpperCase() }))
                  }
                  placeholder="PCR-AB12CD34"
                  required
                />
              </label>
              <button disabled={busy}>Transfer Admin Rights</button>
            </form>
          </>
        )}
      </div>
    </section>
  );

  const tournamentPanel = (
    <section className="tournaments-v4">
      <article className="panel tournaments-v4-header">
        <div>
          <h2>Tournaments</h2>
          <p>Create and manage your cricket tournaments</p>
        </div>
        <button
          type="button"
          onClick={() => setShowTournamentCreate((prev) => !prev)}
          className={showTournamentCreate ? "secondary" : ""}
        >
          {showTournamentCreate ? "Close" : "Create Tournament"}
        </button>
      </article>

      {showTournamentCreate ? (
        <article className="panel tournaments-v4-create">
          <h3>Create New Tournament</h3>
          <form onSubmit={createTournament}>
            <label>
              Tournament Name
              <input
                value={tournamentForm.name}
                onChange={(e) => setTournamentForm((prev) => ({ ...prev, name: e.target.value }))}
                required
                placeholder="Summer Cricket League 2026"
              />
            </label>
            <div className="tournament-team-picker">
              <p>Select Teams ({tournamentForm.teamIds.length})</p>
              {teams.length < 2 ? <p className="warning">Create at least 2 teams before creating a tournament.</p> : null}
              <div className="tournament-team-chips">
                {teams.map((team) => {
                  const selected = tournamentForm.teamIds.includes(team.id);
                  return (
                    <button
                      type="button"
                      key={team.id}
                      className={selected ? "chip selected" : "chip"}
                      onClick={() => toggleTournamentTeam(team.id)}
                    >
                      {team.name} ({team.shortCode})
                    </button>
                  );
                })}
              </div>
            </div>
            <button disabled={busy || tournamentForm.teamIds.length < 2}>Create Tournament</button>
          </form>
        </article>
      ) : null}

      {tournaments.length === 0 ? (
        <article className="panel tournaments-v4-empty">
          <h3>No Tournaments Yet</h3>
          <p>Create your first tournament to get started.</p>
          <button type="button" onClick={() => setShowTournamentCreate(true)}>
            Create Tournament
          </button>
        </article>
      ) : (
        <div className="tournaments-v4-grid">
          {tournaments.map((tournament) => {
            const status = tournamentStatusById.get(tournament.id) ?? "upcoming";
            return (
              <article key={tournament.id} className="panel tournaments-v4-card">
                <div className="tournament-card-head">
                  <strong>{tournament.name}</strong>
                  <span className={`tournament-status ${status}`}>{status}</span>
                </div>
                <p>
                  By {tournament.createdBy.name} ({tournament.createdBy.playerId})
                </p>
                <small>Created on {new Date(tournament.createdAt).toLocaleDateString()}</small>
                <small>{tournament.teams.length} teams</small>
                <small>Format: T20</small>
                <div className="tournament-card-chips">
                  {tournament.teams.map((entry) => (
                    <span key={entry.id}>{entry.team.shortCode}</span>
                  ))}
                </div>
                <button type="button" onClick={() => openMatchSetupFromTournament(tournament.id)}>
                  Start Match
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );

  const matchSetupPanel = (
    <section className="panel tournament-panel setup-v4-card setup-v4-match-card match-setup-v4">
      <div className="match-setup-v4-top">
        <h2>Match Setup</h2>
        <button type="button" className="secondary" onClick={() => setActiveTopTab("tournaments")}>
          Back to Tournaments
        </button>
      </div>
      <p className="match-setup-v4-sub">Configure match details and launch live scoring.</p>

      <div className="tournament-list">
        <h3>Start Match (Tournament)</h3>
        <div className="tabs">
          <button type="button" className={setupTab === "create" ? "active" : ""} onClick={() => setSetupTab("create")}>
            Create Match
          </button>
          <button
            type="button"
            className={setupTab === "playingXI" ? "active" : ""}
            onClick={() => setSetupTab("playingXI")}
          >
            Playing XI + Toss
          </button>
        </div>

        {setupTab === "create" ? (
          <>
            <form onSubmit={createMatch}>
              <label>
                Tournament
                <select
                  value={selectedTournamentIdForMatch}
                  onChange={(e) => setSelectedTournamentIdForMatch(e.target.value)}
                  required
                >
                  <option value="">Select tournament</option>
                  {tournaments.map((tournament) => (
                    <option key={tournament.id} value={tournament.id}>
                      {tournament.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Team 1
                <select
                  value={matchForm.homeTeamId}
                  onChange={(e) => setMatchForm((prev) => ({ ...prev, homeTeamId: e.target.value }))}
                  required
                  disabled={selectedTournamentTeams.length < 2}
                >
                  <option value="">Select first team</option>
                  {selectedTournamentTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.shortCode})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Team 2
                <select
                  value={matchForm.awayTeamId}
                  onChange={(e) => setMatchForm((prev) => ({ ...prev, awayTeamId: e.target.value }))}
                  required
                  disabled={selectedTournamentTeams.length < 2}
                >
                  <option value="">Select second team</option>
                  {selectedTournamentTeams
                    .filter((team) => team.id !== matchForm.homeTeamId)
                    .map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} ({team.shortCode})
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Overs per innings
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={matchForm.oversLimit}
                  onChange={(e) => setMatchForm((prev) => ({ ...prev, oversLimit: Number(e.target.value) }))}
                />
              </label>
              <button disabled={busy || selectedTournamentTeams.length < 2}>Create Scheduled Match</button>
            </form>

            {matchForm.homeTeamId && matchForm.awayTeamId ? (
              <article className="match-setup-v4-summary">
                <h4>Match Summary</h4>
                <p>
                  <span>Match:</span>{" "}
                  {teams.find((team) => team.id === matchForm.homeTeamId)?.name ?? "Team 1"} vs{" "}
                  {teams.find((team) => team.id === matchForm.awayTeamId)?.name ?? "Team 2"}
                </p>
                <p>
                  <span>Format:</span> {matchForm.oversLimit} overs per side
                </p>
                <p>
                  <span>Tournament:</span> {selectedTournamentForMatch?.name ?? "-"}
                </p>
              </article>
            ) : null}
          </>
        ) : (
          <div className="setup-panel">
            <label>
              Scheduled Match
              <select value={setupMatchId} onChange={(e) => setSetupMatchId(e.target.value)}>
                <option value="">Select scheduled match</option>
                {matches
                  .filter((match) => match.status === "SCHEDULED")
                  .map((match) => {
                    const home = teams.find((team) => team.id === match.homeTeamId);
                    const away = teams.find((team) => team.id === match.awayTeamId);
                    return (
                      <option key={match.id} value={match.id}>
                        {home?.shortCode ?? "HOME"} vs {away?.shortCode ?? "AWAY"}
                      </option>
                    );
                  })}
              </select>
            </label>

            {!setupMatch ? <p>No scheduled match selected.</p> : null}
            {setupMatch && setupHomeTeam && setupAwayTeam ? (
              <>
                {setupHomeSquad.length < 11 || setupAwaySquad.length < 11 ? (
                  <p className="warning">Add at least 11 squad players for both teams before selecting Playing XI.</p>
                ) : null}

                <label>
                  Toss Winner
                  <select
                    value={setupForm.tossWinnerTeamId}
                    onChange={(e) => setSetupForm((prev) => ({ ...prev, tossWinnerTeamId: e.target.value }))}
                  >
                    <option value={setupHomeTeam.id}>{setupHomeTeam.name}</option>
                    <option value={setupAwayTeam.id}>{setupAwayTeam.name}</option>
                  </select>
                </label>

                <label>
                  Elected To
                  <select
                    value={setupForm.tossDecision}
                    onChange={(e) =>
                      setSetupForm((prev) => ({
                        ...prev,
                        tossDecision: e.target.value as TossDecision
                      }))
                    }
                  >
                    {TOSS_DECISIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <article className="match-setup-v4-summary">
                  <h4>Innings Preview</h4>
                  <p>
                    <span>Match:</span> {setupHomeTeam.name} vs {setupAwayTeam.name}
                  </p>
                  <p>
                    <span>Toss:</span>{" "}
                    {(setupForm.tossWinnerTeamId === setupHomeTeam.id ? setupHomeTeam.name : setupAwayTeam.name) ||
                      "-"}{" "}
                    won and chose {setupForm.tossDecision.toLowerCase()}
                  </p>
                  <p>
                    <span>Batting First:</span>{" "}
                    {setupForm.tossDecision === "BAT"
                      ? setupForm.tossWinnerTeamId === setupHomeTeam.id
                        ? setupHomeTeam.name
                        : setupAwayTeam.name
                      : setupForm.tossWinnerTeamId === setupHomeTeam.id
                        ? setupAwayTeam.name
                        : setupHomeTeam.name}
                  </p>
                </article>

                <div className="xi-grid">
                  <div className="xi-column">
                    <h3>
                      {setupHomeTeam.shortCode} Playing XI ({setupForm.homePlayingXIPlayerIds.length}/11)
                    </h3>
                    <label>
                      Captain
                      <select
                        value={setupForm.homeCaptainPlayerId}
                        onChange={(e) => setSetupForm((prev) => ({ ...prev, homeCaptainPlayerId: e.target.value }))}
                        disabled={selectedHomeXIPlayers.length === 0}
                      >
                        {selectedHomeXIPlayers.length === 0 ? <option value="">Select Playing XI first</option> : null}
                        {selectedHomeXIPlayers.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Vice-Captain
                      <select
                        value={setupForm.homeViceCaptainPlayerId}
                        onChange={(e) =>
                          setSetupForm((prev) => ({ ...prev, homeViceCaptainPlayerId: e.target.value }))
                        }
                        disabled={selectedHomeXIPlayers.length === 0}
                      >
                        {selectedHomeXIPlayers.length === 0 ? <option value="">Select Playing XI first</option> : null}
                        {selectedHomeXIPlayers.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {setupHomeSquad.map((player) => {
                      const selected = setupForm.homePlayingXIPlayerIds.includes(player.id);
                      const captainTag = setupForm.homeCaptainPlayerId === player.id ? " (C)" : "";
                      const viceCaptainTag = setupForm.homeViceCaptainPlayerId === player.id ? " (VC)" : "";
                      return (
                        <button
                          type="button"
                          key={player.id}
                          className={selected ? "chip selected" : "chip"}
                          onClick={() => togglePlayingXI("home", player.id)}
                        >
                          {player.name}
                          {selected ? `${captainTag}${viceCaptainTag}` : ""}
                        </button>
                      );
                    })}
                  </div>

                  <div className="xi-column">
                    <h3>
                      {setupAwayTeam.shortCode} Playing XI ({setupForm.awayPlayingXIPlayerIds.length}/11)
                    </h3>
                    <label>
                      Captain
                      <select
                        value={setupForm.awayCaptainPlayerId}
                        onChange={(e) => setSetupForm((prev) => ({ ...prev, awayCaptainPlayerId: e.target.value }))}
                        disabled={selectedAwayXIPlayers.length === 0}
                      >
                        {selectedAwayXIPlayers.length === 0 ? <option value="">Select Playing XI first</option> : null}
                        {selectedAwayXIPlayers.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Vice-Captain
                      <select
                        value={setupForm.awayViceCaptainPlayerId}
                        onChange={(e) =>
                          setSetupForm((prev) => ({ ...prev, awayViceCaptainPlayerId: e.target.value }))
                        }
                        disabled={selectedAwayXIPlayers.length === 0}
                      >
                        {selectedAwayXIPlayers.length === 0 ? <option value="">Select Playing XI first</option> : null}
                        {selectedAwayXIPlayers.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {setupAwaySquad.map((player) => {
                      const selected = setupForm.awayPlayingXIPlayerIds.includes(player.id);
                      const captainTag = setupForm.awayCaptainPlayerId === player.id ? " (C)" : "";
                      const viceCaptainTag = setupForm.awayViceCaptainPlayerId === player.id ? " (VC)" : "";
                      return (
                        <button
                          type="button"
                          key={player.id}
                          className={selected ? "chip selected" : "chip"}
                          onClick={() => togglePlayingXI("away", player.id)}
                        >
                          {player.name}
                          {selected ? `${captainTag}${viceCaptainTag}` : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy || setupMatch.status !== "SCHEDULED"}
                  onClick={() => void startMatchWithSetup()}
                >
                  Start Live Scoring
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );

  if (!authChecked) {
    return (
      <div className="auth-shell">
        <section className="auth-screen">
          {authVisualPanel}
          <article className="auth-card auth-loading-card">
            <h2>Checking your session...</h2>
            <p>Please wait.</p>
          </article>
        </section>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="auth-shell">
        {error ? <div className="error">{error}</div> : null}
        {authFormSection}
      </div>
    );
  }

  if (!profileSetup.profileComplete) {
    return (
      <div className="page">
        <header className="top-nav top-nav-compact">
          <button type="button" className="secondary" onClick={() => void logout()} disabled={busy}>
            Logout
          </button>
        </header>
        {error ? <div className="error">{error}</div> : null}
        {profileSetupPanel}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="top-nav">
        <div className="nav-right">
          <nav className="nav-links">
            <button
              type="button"
              className={activeTopTab === "home" ? "nav-tab active" : "nav-tab"}
              onClick={() => setActiveTopTab("home")}
            >
              Home
            </button>
            <button
              type="button"
              className={activeTopTab === "tournaments" ? "nav-tab active" : "nav-tab"}
              onClick={() => setActiveTopTab("tournaments")}
            >
              Tournaments
            </button>
            <button
              type="button"
              className={activeTopTab === "matchSetup" ? "nav-tab active" : "nav-tab"}
              onClick={() => setActiveTopTab("matchSetup")}
            >
              Match Setup
            </button>
            <button
              type="button"
              className={activeTopTab === "live" ? "nav-tab active" : "nav-tab"}
              onClick={() => setActiveTopTab("live")}
            >
              Live Scoring
            </button>
            <button
              type="button"
              className={activeTopTab === "stats" ? "nav-tab active" : "nav-tab"}
              onClick={() => setActiveTopTab("stats")}
            >
              Stats Table
            </button>
          </nav>
          <div className="user-menu" ref={userMenuRef}>
            <button
              type="button"
              className="user-menu-trigger"
              aria-label="Open profile menu"
              aria-expanded={showUserMenu}
              onClick={() => setShowUserMenu((prev) => !prev)}
            >
              <span />
              <span />
              <span />
            </button>
            {showUserMenu ? (
              <div className="user-menu-dropdown">
                <div className="user-menu-head">
                  <strong>{profileSetup.name || authUser.name}</strong>
                  <p>{authUser.email}</p>
                  <p>Player ID: {authUser.playerId}</p>
                </div>
                <div className="user-menu-admin">
                  <p>
                    <strong>Admin Teams ({manageableTeams.length})</strong>
                  </p>
                  {manageableTeams.length === 0 ? (
                    <p>No admin access assigned yet.</p>
                  ) : (
                    <ul className="user-menu-admin-list">
                      {manageableTeams.map((team) => (
                        <li key={team.id}>
                          {team.name} ({team.shortCode})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary user-menu-edit"
                  onClick={() => {
                    setShowUserMenu(false);
                    setProfileSetup((prev) => ({ ...prev, profileComplete: false }));
                  }}
                >
                  Edit Profile
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setShowUserMenu(false);
                    void logout();
                  }}
                  disabled={busy}
                >
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {activeTopTab === "home" ? playerHomePanel : null}

      {activeTopTab === "tournaments" ? (
        <section className="tournaments-v4-page">
          {tournamentPanel}
          <div className="tournaments-v4-team-block">{createTeamPanel}</div>
        </section>
      ) : null}

      {activeTopTab === "matchSetup" ? (
        <section className="setup-v4-page">{matchSetupPanel}</section>
      ) : null}

      {activeTopTab === "live" || activeTopTab === "stats" ? <section className="ticker-strip">
        {matches.length === 0 ? <p>No matches yet.</p> : null}
        {matches.map((match) => {
          const home = teams.find((team) => team.id === match.homeTeamId);
          const away = teams.find((team) => team.id === match.awayTeamId);
          const latestInnings = match.innings[match.innings.length - 1];

          return (
            <button
              key={match.id}
              type="button"
              className={activeMatchId === match.id ? "ticker-item active" : "ticker-item"}
              onClick={() => {
                setActiveMatchId(match.id);
                if (match.status === "SCHEDULED") {
                  setSetupMatchId(match.id);
                  setSetupTab("playingXI");
                }
              }}
            >
              <strong>
                {home?.shortCode ?? "HOME"} vs {away?.shortCode ?? "AWAY"}
              </strong>
              <small>{match.status}</small>
              {latestInnings ? (
                <small>
                  {latestInnings.runs}/{latestInnings.wickets} ({oversFromBalls(latestInnings.balls)})
                </small>
              ) : (
                <small>Not Started</small>
              )}
            </button>
          );
        })}
      </section> : null}

      {activeTopTab === "live" ? (
        <section className="live-v4-page">
          <article className="panel live-v4-page-head">
            <div className="live-v4-page-head-left">
              <button type="button" className="secondary" onClick={() => setActiveTopTab("matchSetup")}>
                Back
              </button>
              <div>
                <h2>Live Match</h2>
                <p>
                  {activeHomeTeam && activeAwayTeam
                    ? `${activeHomeTeam.name} vs ${activeAwayTeam.name}`
                    : "Select a match to begin scoring"}
                </p>
              </div>
            </div>
            <span className="live-v4-format-badge">
              {activeMatch ? `${activeMatch.summary.oversLimit} Overs` : "Format"}
            </span>
          </article>

          {!hasStartedMatch ? (
            <article className="panel live-v4-empty">
              <h2>Live Scoring</h2>
              <p>Start a scheduled match from the Match Setup page to unlock live scoring.</p>
            </article>
          ) : (
            <>
              <article className="panel live-v4-scorecard">
                {!activeMatch ? <p>Select a match to view scorecard.</p> : null}
                {activeMatch ? (
                  <>
                    <div className="live-v4-head">
                      <div>
                        <h2>
                          {activeHomeTeam?.name ?? "Home"} vs {activeAwayTeam?.name ?? "Away"}
                        </h2>
                        <p>
                          {currentInningsTitle}
                          {activeTossWinner ? ` · Toss: ${activeTossWinner.shortCode} chose ${activeMatch.summary.tossDecision}` : ""}
                        </p>
                      </div>
                      <span className={activeMatch.summary.status === "LIVE" ? "status-pill live" : "status-pill"}>
                        {activeMatch.summary.status}
                      </span>
                    </div>

                    <div className="live-v4-main-score">
                      <strong>
                        {currentInnings?.runs ?? 0}/{currentInnings?.wickets ?? 0}
                      </strong>
                      <p>
                        Overs {currentInnings?.overDisplay ?? "0.0"} / {activeMatch.summary.oversLimit}
                      </p>
                      <p>
                        {teams.find((team) => team.id === currentInnings?.battingTeamId)?.name ?? "Batting Team"} batting
                      </p>
                    </div>

                    <div className="live-v4-metrics">
                      <div>
                        <small>Run Rate</small>
                        <strong>{currentRunRate}</strong>
                      </div>
                      {chaseTarget !== null ? (
                        <div>
                          <small>Target</small>
                          <strong>{chaseTarget}</strong>
                        </div>
                      ) : null}
                      {requiredRunRate !== null ? (
                        <div>
                          <small>Required RR</small>
                          <strong>{requiredRunRate}</strong>
                        </div>
                      ) : null}
                    </div>

                    {matchResultText ? <p className="result-line">{matchResultText}</p> : null}
                  </>
                ) : null}
              </article>

              {currentOverBalls.length > 0 ? (
                <article className="panel live-v4-current-over">
                  <h3>Current Over</h3>
                  <div className="live-v4-ball-row">
                    {currentOverBalls.map((item) => (
                      <span
                        key={item.id}
                        className={[
                          "live-v4-ball",
                          item.isWicket ? "wicket" : "",
                          item.extraType !== "NONE" ? "extra" : "",
                          item.runsOffBat >= 4 && item.extraType === "NONE" ? "boundary" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {ballEventLabel(item)}
                      </span>
                    ))}
                  </div>
                </article>
              ) : null}

              <article className="panel live-v4-controls">
                <h3>Quick Scoring</h3>
                {!activeMatchListItem ? <p>Select a match.</p> : null}

                {activeMatchListItem && activeMatchListItem.status === "SCHEDULED" ? (
                  <p>
                    This match is scheduled. Open Match Setup page, complete Playing XI and toss, then start live scoring.
                  </p>
                ) : null}

                {!activeMatch || !currentInnings ? null : (
                  <>
                    {showBowlerPrompt ? (
                      <div className="overlay">
                        <div className="overlay-card">
                          <h3>Over Complete</h3>
                          <p>Select bowler for the next over.</p>
                          <select value={nextBowlerId} onChange={(e) => setNextBowlerId(e.target.value)}>
                            {bowlingTeamPlayers.map((player) => (
                              <option key={player.id} value={player.id}>
                                {player.name}
                              </option>
                            ))}
                          </select>
                          <button type="button" onClick={confirmNextOverBowler}>
                            Confirm Bowler
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {isLiveMatch ? (
                      <div className="quick-score">
                        <div className="selector-row">
                          <label>
                            Striker
                            <select
                              value={eventActors.strikerId}
                              onChange={(e) => setEventActors((prev) => ({ ...prev, strikerId: e.target.value }))}
                              disabled={showBowlerPrompt}
                            >
                              {battingTeamPlayers.map((player) => (
                                <option key={player.id} value={player.id}>
                                  {player.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            Non-striker
                            <select
                              value={eventActors.nonStrikerId}
                              onChange={(e) => setEventActors((prev) => ({ ...prev, nonStrikerId: e.target.value }))}
                              disabled={showBowlerPrompt}
                            >
                              {battingTeamPlayers.map((player) => (
                                <option key={player.id} value={player.id}>
                                  {player.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            Bowler
                            <select
                              value={eventActors.bowlerId}
                              onChange={(e) => setEventActors((prev) => ({ ...prev, bowlerId: e.target.value }))}
                              disabled={showBowlerPrompt}
                            >
                              {bowlingTeamPlayers.map((player) => (
                                <option key={player.id} value={player.id}>
                                  {player.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <button type="button" onClick={swapBatters} className="secondary" disabled={showBowlerPrompt}>
                            Swap Strike
                          </button>
                        </div>

                        <label>
                          Quick Commentary (optional)
                          <input
                            value={commentary}
                            onChange={(e) => setCommentary(e.target.value)}
                            placeholder="Optional short note"
                            maxLength={240}
                            disabled={showBowlerPrompt}
                          />
                        </label>

                        <div className="quick-actions">
                          <h4>Runs</h4>
                          <div className="live-v4-run-grid">
                            {[0, 1, 2, 3, 4, 6].map((run) => (
                              <button
                                type="button"
                                key={run}
                                className={run >= 4 ? "live-v4-run-btn boundary" : "live-v4-run-btn"}
                                onClick={() =>
                                  void submitBallEvent({
                                    runsOffBat: run,
                                    extraType: "NONE",
                                    extraRuns: 0,
                                    isWicket: false,
                                    wicketType: "NONE"
                                  })
                                }
                                disabled={scoringLocked}
                              >
                                {run}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="quick-actions">
                          <h4>Extras</h4>
                          <div className="live-v4-extra-grid">
                            <button
                              type="button"
                              disabled={scoringLocked}
                              onClick={() =>
                                void submitBallEvent({
                                  runsOffBat: 0,
                                  extraType: "WIDE",
                                  extraRuns: 1,
                                  isWicket: false,
                                  wicketType: "NONE"
                                })
                              }
                            >
                              Wide
                            </button>
                            <button
                              type="button"
                              disabled={scoringLocked}
                              onClick={() =>
                                void submitBallEvent({
                                  runsOffBat: 0,
                                  extraType: "NO_BALL",
                                  extraRuns: 1,
                                  isWicket: false,
                                  wicketType: "NONE"
                                })
                              }
                            >
                              No Ball
                            </button>
                            <button
                              type="button"
                              disabled={scoringLocked}
                              onClick={() =>
                                void submitBallEvent({
                                  runsOffBat: 0,
                                  extraType: "BYE",
                                  extraRuns: 1,
                                  isWicket: false,
                                  wicketType: "NONE"
                                })
                              }
                            >
                              Bye
                            </button>
                            <button
                              type="button"
                              disabled={scoringLocked}
                              onClick={() =>
                                void submitBallEvent({
                                  runsOffBat: 0,
                                  extraType: "LEG_BYE",
                                  extraRuns: 1,
                                  isWicket: false,
                                  wicketType: "NONE"
                                })
                              }
                            >
                              Leg Bye
                            </button>
                          </div>
                        </div>

                        <div className="quick-actions">
                          <h4>Wicket</h4>
                          <div className="live-v4-wicket-grid">
                            <select
                              value={quickWicketType}
                              onChange={(e) => setQuickWicketType(e.target.value as BallEventInput["wicketType"])}
                              disabled={showBowlerPrompt}
                            >
                              {WICKET_TYPES.filter((value) => value !== "NONE").map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                            {quickWicketType === "RUN_OUT" ? (
                              <select
                                value={quickDismissedBatter}
                                onChange={(e) => setQuickDismissedBatter(e.target.value as DismissedBatter)}
                                disabled={showBowlerPrompt}
                              >
                                <option value="STRIKER">Out: Striker</option>
                                <option value="NON_STRIKER">Out: Non-striker</option>
                              </select>
                            ) : null}
                            {["CAUGHT", "RUN_OUT", "STUMPED"].includes(quickWicketType) ? (
                              <select
                                value={quickFielderId}
                                onChange={(e) => setQuickFielderId(e.target.value)}
                                disabled={showBowlerPrompt || bowlingTeamPlayers.length === 0}
                              >
                                {bowlingTeamPlayers.length === 0 ? <option value="">No fielder available</option> : null}
                                {bowlingTeamPlayers.map((player) => (
                                  <option key={player.id} value={player.id}>
                                    Fielder: {player.name}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            <select
                              value={quickIncomingBatterId}
                              onChange={(e) => setQuickIncomingBatterId(e.target.value)}
                              disabled={showBowlerPrompt || nextBatterOptions.length === 0}
                            >
                              {nextBatterOptions.length === 0 ? <option value="">No batter available</option> : null}
                              {nextBatterOptions.map((player) => (
                                <option key={player.id} value={player.id}>
                                  Incoming: {player.name}
                                </option>
                              ))}
                            </select>
                            <label className="checkbox-row inline-check">
                              <input
                                type="checkbox"
                                checked={quickCrossedBeforeDismissal}
                                onChange={(e) => setQuickCrossedBeforeDismissal(e.target.checked)}
                                disabled={showBowlerPrompt}
                              />
                              Crossed before dismissal
                            </label>
                            <button
                              type="button"
                              disabled={
                                scoringLocked ||
                                !quickIncomingBatterId ||
                                (["CAUGHT", "RUN_OUT", "STUMPED"].includes(quickWicketType) && !quickFielderId)
                              }
                              onClick={() =>
                                void submitBallEvent({
                                  runsOffBat: 0,
                                  extraType: "NONE",
                                  extraRuns: 0,
                                  isWicket: true,
                                  wicketType: quickWicketType,
                                  dismissedBatter: quickWicketType === "RUN_OUT" ? quickDismissedBatter : "STRIKER",
                                  incomingBatterId: quickIncomingBatterId,
                                  crossedBeforeDismissal: quickCrossedBeforeDismissal,
                                  fielderId: ["CAUGHT", "RUN_OUT", "STUMPED"].includes(quickWicketType)
                                    ? quickFielderId
                                    : undefined
                                })
                              }
                            >
                              Add Wicket
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p>This match is completed. Ball scoring is locked.</p>
                    )}
                  </>
                )}
              </article>

              <article className="panel live-v4-over-history">
                <h3>Previous Overs</h3>
                {previousOverGroups.length === 0 ? (
                  <p>No completed overs yet.</p>
                ) : (
                  <div className="live-v4-over-list">
                    {previousOverGroups.map((over) => (
                      <div key={over.overNumber} className="live-v4-over-row">
                        <span>Over {over.overNumber}</span>
                        <div className="live-v4-ball-row">
                          {over.balls.map((item) => (
                            <span
                              key={item.id}
                              className={[
                                "live-v4-ball small",
                                item.isWicket ? "wicket" : "",
                                item.extraType !== "NONE" ? "extra" : "",
                                item.runsOffBat >= 4 && item.extraType === "NONE" ? "boundary" : ""
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              {ballEventLabel(item)}
                            </span>
                          ))}
                        </div>
                        <small>{over.balls.reduce((sum, item) => sum + item.runsOffBat + item.extraRuns, 0)} runs</small>
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="panel live-v4-recent">
                <h3>Recent Balls</h3>
                <ul className="list compact">
                  {activeMatch?.recentEvents.map((item) => (
                    <li key={item.id}>
                      <strong>
                        {item.overNumber}.{item.ballInOver}
                      </strong>
                      <span>
                        {item.striker.name} vs {item.bowler.name}: {item.runsOffBat}+{item.extraRuns} ({item.extraType})
                        {item.isWicket ? ` WICKET(${item.wicketType})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>

              {activeMatch?.summary.status === "COMPLETED" ? (
                <article className="panel summary-card">
                  <h3>Match Summary</h3>
                  {matchResultText ? <p>{matchResultText}</p> : null}
                  <p>
                    Toss: {activeTossWinner?.name ?? "N/A"} elected to {activeMatch.summary.tossDecision ?? "N/A"}
                  </p>
                  <p>
                    1st Innings: {teams.find((team) => team.id === firstInningsSummary?.battingTeamId)?.shortCode ?? "--"}{" "}
                    {firstInningsSummary?.runs ?? 0}/{firstInningsSummary?.wickets ?? 0} (
                    {firstInningsSummary?.overDisplay ?? "0.0"})
                  </p>
                  <p>
                    2nd Innings: {teams.find((team) => team.id === secondInningsSummary?.battingTeamId)?.shortCode ?? "--"}{" "}
                    {secondInningsSummary?.runs ?? 0}/{secondInningsSummary?.wickets ?? 0} (
                    {secondInningsSummary?.overDisplay ?? "0.0"})
                  </p>
                </article>
              ) : null}

              <article className="panel live-v4-match-list">
                <h3>Matches</h3>
                <div className="live-v4-match-grid">
                  {matches.map((match) => {
                    const home = teams.find((team) => team.id === match.homeTeamId);
                    const away = teams.find((team) => team.id === match.awayTeamId);
                    const latestInnings = match.innings[match.innings.length - 1];
                    const tossWinner = teams.find((team) => team.id === match.tossWinnerTeamId);

                    return (
                      <button
                        key={match.id}
                        type="button"
                        className={activeMatchId === match.id ? "live-v4-match-tile active" : "live-v4-match-tile"}
                        onClick={() => {
                          setActiveMatchId(match.id);
                          if (match.status === "SCHEDULED") {
                            setSetupMatchId(match.id);
                            setActiveTopTab("matchSetup");
                            setSetupTab("playingXI");
                          }
                        }}
                      >
                        <strong>
                          {home?.shortCode ?? "HOME"} vs {away?.shortCode ?? "AWAY"}
                        </strong>
                        <small>{match.status}</small>
                        {match.tossWinnerTeamId && match.tossDecision ? (
                          <small>
                            Toss: {tossWinner?.shortCode ?? "--"} chose {match.tossDecision}
                          </small>
                        ) : (
                          <small>Toss pending</small>
                        )}
                        {latestInnings ? (
                          <small>
                            {latestInnings.runs}/{latestInnings.wickets} ({oversFromBalls(latestInnings.balls)})
                          </small>
                        ) : (
                          <small>Score not started</small>
                        )}
                      </button>
                    );
                  })}
                </div>
              </article>
            </>
          )}
        </section>
      ) : null}

      {activeTopTab === "stats" ? (
        <section className="panel stats-panel">
          <div className="stats-head">
            <h2>Player Stats</h2>
            <p>Select a team, then choose a player to view full batting, bowling and fielding stats.</p>
          </div>

          <div className="stats-layout">
            <aside className="stats-team-list">
              <h3>Teams</h3>
              <div className="stats-team-buttons">
                {playerStatsByTeam.map((team) => (
                  <button
                    type="button"
                    key={team.teamId}
                    className={selectedStatsTeamId === team.teamId ? "stats-team-btn active" : "stats-team-btn"}
                    onClick={() => {
                      setSelectedStatsTeamId(team.teamId);
                      setSelectedStatsPlayerId("");
                    }}
                  >
                    {team.teamName} ({team.teamShortCode})
                  </button>
                ))}
              </div>
            </aside>

            <aside className="stats-player-list">
              <h3>Players</h3>
              {!selectedStatsTeam ? <p>Select a team first.</p> : null}
              {selectedStatsTeam ? (
                <>
                  <p className="stats-selected-team">
                    {selectedStatsTeam.teamName} ({selectedStatsTeam.teamShortCode})
                  </p>
                  <div className="stats-player-buttons">
                    {selectedTeamPlayers.map((player) => (
                      <button
                        type="button"
                        key={player.playerId}
                        className={selectedStatsPlayerId === player.playerId ? "stats-player-btn active" : "stats-player-btn"}
                        onClick={() => setSelectedStatsPlayerId(player.playerId)}
                      >
                        {player.playerName}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </aside>

            <article className="stats-detail">
              {!selectedStatsPlayer ? <p>Select a player to view stats.</p> : (
                <>
                  <div className="player-stat-top">
                    <div>
                      <h3>{selectedStatsPlayer.playerName}</h3>
                      <p>
                        {selectedStatsPlayer.teamName} ({selectedStatsPlayer.teamShortCode}) · {selectedStatsPlayer.role}
                      </p>
                    </div>
                    {selectedLeadership ? <span className="leader-chip">{selectedLeadership}</span> : null}
                  </div>

                  <section className="stats-block">
                    <h4>Batting</h4>
                    <div className="metric-grid">
                      <div className="metric">
                        <span>Runs</span>
                        <strong>{selectedStatsPlayer.runsScored}</strong>
                      </div>
                      <div className="metric">
                        <span>Balls</span>
                        <strong>{selectedStatsPlayer.ballsFaced}</strong>
                      </div>
                      <div className="metric">
                        <span>Outs</span>
                        <strong>{selectedStatsPlayer.dismissals}</strong>
                      </div>
                      <div className="metric">
                        <span>4s / 6s</span>
                        <strong>
                          {selectedStatsPlayer.fours} / {selectedStatsPlayer.sixes}
                        </strong>
                      </div>
                      <div className="metric">
                        <span>Strike Rate</span>
                        <strong>{formatMetric(selectedStatsPlayer.battingStrikeRate)}</strong>
                      </div>
                      <div className="metric">
                        <span>Average</span>
                        <strong>{formatMetric(selectedStatsPlayer.battingAverage)}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="stats-block">
                    <h4>Bowling</h4>
                    <div className="metric-grid">
                      <div className="metric">
                        <span>Overs</span>
                        <strong>{selectedStatsPlayer.oversBowled}</strong>
                      </div>
                      <div className="metric">
                        <span>Balls</span>
                        <strong>{selectedStatsPlayer.ballsBowled}</strong>
                      </div>
                      <div className="metric">
                        <span>Runs</span>
                        <strong>{selectedStatsPlayer.runsConceded}</strong>
                      </div>
                      <div className="metric">
                        <span>Wickets</span>
                        <strong>{selectedStatsPlayer.wicketsTaken}</strong>
                      </div>
                      <div className="metric">
                        <span>Dot Balls</span>
                        <strong>{selectedStatsPlayer.dotBalls}</strong>
                      </div>
                      <div className="metric">
                        <span>Economy</span>
                        <strong>{formatMetric(selectedStatsPlayer.economy)}</strong>
                      </div>
                      <div className="metric">
                        <span>Average</span>
                        <strong>{formatMetric(selectedStatsPlayer.bowlingAverage)}</strong>
                      </div>
                      <div className="metric">
                        <span>Strike Rate</span>
                        <strong>{formatMetric(selectedStatsPlayer.bowlingStrikeRate)}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="stats-block">
                    <h4>Fielding</h4>
                    <div className="metric-grid">
                      <div className="metric">
                        <span>Catches</span>
                        <strong>{selectedStatsPlayer.catches}</strong>
                      </div>
                      <div className="metric">
                        <span>Stumpings</span>
                        <strong>{selectedStatsPlayer.stumpings}</strong>
                      </div>
                      <div className="metric">
                        <span>Run Outs</span>
                        <strong>{selectedStatsPlayer.runOuts}</strong>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}
