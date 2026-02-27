import { EXTRA_TYPES, WICKET_TYPES, type BallEventInput, type MatchSummaryDTO } from "@culbcric/shared";
import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

type Team = {
  id: string;
  name: string;
  shortCode: string;
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
  name: string;
  role: string;
  careerStat?: {
    runsScored: number;
    ballsFaced: number;
    wicketsTaken: number;
    ballsBowled: number;
  } | null;
};

type MatchListItem = {
  id: string;
  status: "SCHEDULED" | "LIVE" | "COMPLETED";
  homeTeamId: string;
  awayTeamId: string;
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
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json"
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

export default function App(): JSX.Element {
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [activeMatchId, setActiveMatchId] = useState<string>("");
  const [activeMatch, setActiveMatch] = useState<MatchDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [teamForm, setTeamForm] = useState({ name: "", shortCode: "" });
  const [playerForm, setPlayerForm] = useState({ teamId: "", name: "", role: "Batsman" });
  const [matchForm, setMatchForm] = useState({ homeTeamId: "", awayTeamId: "", oversLimit: 20 });
  const [winnerTeamId, setWinnerTeamId] = useState("");

  const [eventForm, setEventForm] = useState<BallEventInput>({
    strikerId: "",
    nonStrikerId: "",
    bowlerId: "",
    runsOffBat: 0,
    extraType: "NONE",
    extraRuns: 0,
    isWicket: false,
    wicketType: "NONE",
    commentary: ""
  });

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
    void loadTeams().catch((err: unknown) => setError((err as Error).message));
    void loadMatches().catch((err: unknown) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    if (!activeMatchId) {
      setActiveMatch(null);
      return;
    }

    socket.emit("join:match", activeMatchId);
    void loadMatch(activeMatchId).catch((err: unknown) => setError((err as Error).message));

    return () => {
      socket.emit("leave:match", activeMatchId);
    };
  }, [activeMatchId, socket]);

  const currentInnings = activeMatch?.summary.innings.find(
    (innings) => innings.number === activeMatch.summary.currentInnings
  );
  const isLiveMatch = activeMatch?.summary.status === "LIVE";

  const battingTeamPlayers = teams.find((team) => team.id === currentInnings?.battingTeamId)?.players ?? [];
  const bowlingTeamPlayers = teams.find((team) => team.id === currentInnings?.bowlingTeamId)?.players ?? [];

  useEffect(() => {
    if (!battingTeamPlayers.length || !bowlingTeamPlayers.length) {
      return;
    }

    setEventForm((prev) => ({
      ...prev,
      strikerId: prev.strikerId || battingTeamPlayers[0].id,
      nonStrikerId: prev.nonStrikerId || battingTeamPlayers[Math.min(1, battingTeamPlayers.length - 1)].id,
      bowlerId: prev.bowlerId || bowlingTeamPlayers[0].id
    }));
  }, [battingTeamPlayers, bowlingTeamPlayers]);

  async function loadTeams(): Promise<void> {
    const data = await api<Team[]>("/teams");
    setTeams(data);

    if (!playerForm.teamId && data.length > 0) {
      setPlayerForm((prev) => ({ ...prev, teamId: data[0].id }));
    }

    if (!matchForm.homeTeamId && data.length > 1) {
      setMatchForm((prev) => ({ ...prev, homeTeamId: data[0].id, awayTeamId: data[1].id }));
    }
  }

  async function loadMatches(): Promise<void> {
    const data = await api<MatchListItem[]>("/matches");
    setMatches(data);

    if (!activeMatchId) {
      const liveMatch = data.find((match) => match.status === "LIVE");
      if (liveMatch) {
        setActiveMatchId(liveMatch.id);
      }
    }
  }

  async function loadMatch(matchId: string): Promise<void> {
    const data = await api<MatchDetail>(`/matches/${matchId}`);
    setActiveMatch(data);
  }

  async function createTeam(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
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

  async function createPlayer(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
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

  async function createMatch(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const match = await api<MatchListItem>("/matches", {
        method: "POST",
        body: JSON.stringify(matchForm)
      });

      await loadMatches();
      setActiveMatchId(match.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addBallEvent(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!activeMatchId) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const payload: BallEventInput = {
        ...eventForm,
        wicketType: eventForm.isWicket ? eventForm.wicketType : "NONE",
        commentary: eventForm.commentary?.trim() || undefined
      };

      await api(`/matches/${activeMatchId}/events`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      await loadMatch(activeMatchId);
      setEventForm((prev) => ({
        ...prev,
        runsOffBat: 0,
        extraRuns: 0,
        isWicket: false,
        wicketType: "NONE",
        commentary: ""
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startNextInnings(): Promise<void> {
    if (!activeMatchId) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await api(`/matches/${activeMatchId}/next-innings`, {
        method: "POST"
      });
      await loadMatches();
      await loadMatch(activeMatchId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function completeMatch(): Promise<void> {
    if (!activeMatchId) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await api(`/matches/${activeMatchId}/complete`, {
        method: "POST",
        body: JSON.stringify({ winnerTeamId: winnerTeamId || undefined })
      });
      await loadMatches();
      await loadMatch(activeMatchId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header>
        <h1>Culbcric Live Scoring</h1>
        <p>Live score + long-term team/player stats for web and mobile-ready APIs.</p>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="grid">
        <article className="card">
          <h2>Create Team</h2>
          <form onSubmit={createTeam}>
            <label>
              Team Name
              <input
                value={teamForm.name}
                onChange={(e) => setTeamForm((prev) => ({ ...prev, name: e.target.value }))}
                required
                placeholder="Mumbai Titans"
              />
            </label>
            <label>
              Short Code
              <input
                value={teamForm.shortCode}
                onChange={(e) => setTeamForm((prev) => ({ ...prev, shortCode: e.target.value.toUpperCase() }))}
                required
                maxLength={5}
                placeholder="MT"
              />
            </label>
            <button disabled={busy}>Save Team</button>
          </form>
        </article>

        <article className="card">
          <h2>Add Player</h2>
          <form onSubmit={createPlayer}>
            <label>
              Team
              <select
                value={playerForm.teamId}
                onChange={(e) => setPlayerForm((prev) => ({ ...prev, teamId: e.target.value }))}
                required
              >
                <option value="">Select team</option>
                {teams.map((team) => (
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
                required
                placeholder="Rahul Sharma"
              />
            </label>
            <label>
              Role
              <select value={playerForm.role} onChange={(e) => setPlayerForm((prev) => ({ ...prev, role: e.target.value }))}>
                <option>Batsman</option>
                <option>Bowler</option>
                <option>All-Rounder</option>
                <option>Wicket-Keeper</option>
              </select>
            </label>
            <button disabled={busy}>Save Player</button>
          </form>
        </article>

        <article className="card">
          <h2>Create Match</h2>
          <form onSubmit={createMatch}>
            <label>
              Home Team
              <select
                value={matchForm.homeTeamId}
                onChange={(e) => setMatchForm((prev) => ({ ...prev, homeTeamId: e.target.value }))}
                required
              >
                <option value="">Select team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Away Team
              <select
                value={matchForm.awayTeamId}
                onChange={(e) => setMatchForm((prev) => ({ ...prev, awayTeamId: e.target.value }))}
                required
              >
                <option value="">Select team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Overs
              <input
                type="number"
                min={1}
                max={50}
                value={matchForm.oversLimit}
                onChange={(e) => setMatchForm((prev) => ({ ...prev, oversLimit: Number(e.target.value) }))}
              />
            </label>
            <button disabled={busy}>Start Match</button>
          </form>
        </article>
      </section>

      <section className="grid">
        <article className="card tall">
          <h2>Matches</h2>
          {matches.length === 0 ? <p>No matches yet.</p> : null}
          <ul className="list">
            {matches.map((match) => {
              const home = teams.find((team) => team.id === match.homeTeamId);
              const away = teams.find((team) => team.id === match.awayTeamId);
              const latestInnings = match.innings[match.innings.length - 1];

              return (
                <li
                  key={match.id}
                  className={activeMatchId === match.id ? "selected" : ""}
                  onClick={() => setActiveMatchId(match.id)}
                >
                  <strong>
                    {home?.shortCode ?? "HOME"} vs {away?.shortCode ?? "AWAY"}
                  </strong>
                  <span>{match.status}</span>
                  {latestInnings ? (
                    <small>
                      {latestInnings.runs}/{latestInnings.wickets} ({oversFromBalls(latestInnings.balls)})
                    </small>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </article>

        <article className="card tall">
          <h2>Live Score</h2>
          {!activeMatch || !currentInnings ? <p>Select a match to score live balls.</p> : null}
          {activeMatch && currentInnings ? (
            <>
              <div className="score">
                <strong>
                  {teams.find((team) => team.id === currentInnings.battingTeamId)?.name ?? "Batting Team"}
                </strong>
                <span>
                  {currentInnings.runs}/{currentInnings.wickets}
                </span>
                <small>
                  Overs: {currentInnings.overDisplay} / {activeMatch.summary.oversLimit}
                </small>
              </div>

              <div className="controls-row">
                {activeMatch.summary.status === "LIVE" && activeMatch.summary.currentInnings === 1 ? (
                  <button type="button" onClick={() => void startNextInnings()} disabled={busy}>
                    Start 2nd Innings
                  </button>
                ) : null}
                <select value={winnerTeamId} onChange={(e) => setWinnerTeamId(e.target.value)}>
                  <option value="">Winner (optional)</option>
                  <option value={activeMatch.summary.homeTeamId}>
                    {teams.find((team) => team.id === activeMatch.summary.homeTeamId)?.name ?? "Home Team"}
                  </option>
                  <option value={activeMatch.summary.awayTeamId}>
                    {teams.find((team) => team.id === activeMatch.summary.awayTeamId)?.name ?? "Away Team"}
                  </option>
                </select>
                <button type="button" onClick={() => void completeMatch()} disabled={busy}>
                  Complete Match
                </button>
              </div>

              {isLiveMatch ? <form onSubmit={addBallEvent}>
                <label>
                  Striker
                  <select
                    value={eventForm.strikerId}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, strikerId: e.target.value }))}
                    required
                  >
                    <option value="">Select striker</option>
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
                    value={eventForm.nonStrikerId}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, nonStrikerId: e.target.value }))}
                    required
                  >
                    <option value="">Select non-striker</option>
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
                    value={eventForm.bowlerId}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, bowlerId: e.target.value }))}
                    required
                  >
                    <option value="">Select bowler</option>
                    {bowlingTeamPlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Runs Off Bat
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={eventForm.runsOffBat}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, runsOffBat: Number(e.target.value) }))}
                  />
                </label>

                <label>
                  Extra Type
                  <select
                    value={eventForm.extraType}
                    onChange={(e) =>
                      setEventForm((prev) => ({
                        ...prev,
                        extraType: e.target.value as BallEventInput["extraType"]
                      }))
                    }
                  >
                    {EXTRA_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Extra Runs
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={eventForm.extraRuns}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, extraRuns: Number(e.target.value) }))}
                  />
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={eventForm.isWicket}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, isWicket: e.target.checked }))}
                  />
                  Wicket
                </label>

                <label>
                  Wicket Type
                  <select
                    value={eventForm.wicketType}
                    onChange={(e) =>
                      setEventForm((prev) => ({
                        ...prev,
                        wicketType: e.target.value as BallEventInput["wicketType"]
                      }))
                    }
                    disabled={!eventForm.isWicket}
                  >
                    {WICKET_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Commentary (optional)
                  <input
                    value={eventForm.commentary}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, commentary: e.target.value }))}
                    maxLength={240}
                    placeholder="Short delivery, edged to slip"
                  />
                </label>

                <button disabled={busy}>Add Ball Event</button>
              </form> : <p>This match is completed. Ball scoring is locked.</p>}

              <h3>Recent Balls</h3>
              <ul className="list compact">
                {activeMatch.recentEvents.map((item) => (
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
            </>
          ) : null}
        </article>
      </section>

      <section className="card">
        <h2>Team and Player Stats Snapshot</h2>
        <div className="team-grid">
          {teams.map((team) => (
            <div key={team.id} className="team-card">
              <h3>
                {team.name} ({team.shortCode})
              </h3>
              <p>
                MP: {team.teamCareerStat?.matchesPlayed ?? 0} | W: {team.teamCareerStat?.wins ?? 0} | L: {team.teamCareerStat?.losses ?? 0}
              </p>
              <p>
                Runs: {team.teamCareerStat?.totalRunsScored ?? 0} | Wickets Taken: {team.teamCareerStat?.totalWicketsTaken ?? 0}
              </p>
              <ul className="list compact">
                {team.players.map((player) => (
                  <li key={player.id}>
                    <strong>{player.name}</strong>
                    <span>
                      {player.role} | Runs: {player.careerStat?.runsScored ?? 0} | Wkts: {player.careerStat?.wicketsTaken ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
