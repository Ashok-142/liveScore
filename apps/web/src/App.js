import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { TOSS_DECISIONS, WICKET_TYPES } from "@culbcric/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
async function api(path, options) {
    const token = typeof window !== "undefined"
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
        const payload = (await response.json().catch(() => ({})));
        throw new Error(payload.error ?? "Request failed");
    }
    return (await response.json());
}
function oversFromBalls(balls) {
    return `${Math.floor(balls / 6)}.${balls % 6}`;
}
function inningsLabel(number) {
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
function getDefaultXI(players) {
    return players.slice(0, 11).map((player) => player.id);
}
function sanitizeXI(selected, players) {
    const allowed = new Set(players.map((player) => player.id));
    const filtered = selected.filter((id, index, arr) => allowed.has(id) && arr.indexOf(id) === index);
    if (filtered.length === 11) {
        return filtered;
    }
    return getDefaultXI(players);
}
function isLegalDelivery(extraType) {
    return extraType !== "WIDE" && extraType !== "NO_BALL";
}
function formatMetric(value) {
    if (value === null || Number.isNaN(value) || !Number.isFinite(value)) {
        return "-";
    }
    return value.toFixed(2);
}
function runRateFrom(runs, balls) {
    if (balls <= 0) {
        return "0.00";
    }
    return ((runs * 6) / balls).toFixed(2);
}
function ballEventLabel(event) {
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
function resolveLeadership(selectedXI, previousCaptainId, previousViceCaptainId) {
    if (selectedXI.length === 0) {
        return { captainId: "", viceCaptainId: "" };
    }
    const captainId = selectedXI.includes(previousCaptainId) ? previousCaptainId : selectedXI[0];
    const viceCaptainId = selectedXI.includes(previousViceCaptainId) && previousViceCaptainId !== captainId
        ? previousViceCaptainId
        : selectedXI.find((playerId) => playerId !== captainId) ?? captainId;
    return { captainId, viceCaptainId };
}
export default function App() {
    const authLoadVersionRef = useRef(0);
    const userMenuRef = useRef(null);
    const [teams, setTeams] = useState([]);
    const [matches, setMatches] = useState([]);
    const [activeMatchId, setActiveMatchId] = useState("");
    const [activeMatch, setActiveMatch] = useState(null);
    const [setupMatchId, setSetupMatchId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [activeTopTab, setActiveTopTab] = useState("home");
    const [authMode, setAuthMode] = useState("login");
    const [authAccountType, setAuthAccountType] = useState("personal");
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [authUser, setAuthUser] = useState(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
    const [profileSetup, setProfileSetup] = useState({
        name: "",
        role: "",
        age: "",
        battingStyle: "",
        bowlingStyle: "",
        teams: [],
        profileComplete: false
    });
    const [profileTeamInput, setProfileTeamInput] = useState("");
    const [homeSelectedTeamId, setHomeSelectedTeamId] = useState("ALL");
    const [homeStatsTab, setHomeStatsTab] = useState("bat");
    const [selectedStatsTeamId, setSelectedStatsTeamId] = useState("");
    const [selectedStatsPlayerId, setSelectedStatsPlayerId] = useState("");
    const [setupTab, setSetupTab] = useState("create");
    const [teamForm, setTeamForm] = useState({ name: "", shortCode: "" });
    const [playerForm, setPlayerForm] = useState({ teamId: "", name: "", role: "Batsman" });
    const [matchForm, setMatchForm] = useState({ homeTeamId: "", awayTeamId: "", oversLimit: 20 });
    const [adminTransferForm, setAdminTransferForm] = useState({ teamId: "", newAdminPlayerId: "" });
    const [tournaments, setTournaments] = useState([]);
    const [tournamentForm, setTournamentForm] = useState({ name: "", teamIds: [] });
    const [showTournamentCreate, setShowTournamentCreate] = useState(false);
    const [selectedTournamentIdForMatch, setSelectedTournamentIdForMatch] = useState("");
    const [setupForm, setSetupForm] = useState({
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
    const [quickWicketType, setQuickWicketType] = useState("BOWLED");
    const [quickDismissedBatter, setQuickDismissedBatter] = useState("STRIKER");
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
        const onScoreUpdate = (summary) => {
            setMatches((current) => current.map((match) => match.id === summary.id
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
                : match));
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
        void loadAuthUser().catch((err) => {
            setError(err.message);
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
            .catch((err) => {
            if (currentVersion === authLoadVersionRef.current) {
                setError(err.message);
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
        const baseProfile = {
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
            const parsed = JSON.parse(raw);
            setProfileSetup({
                name: parsed.name?.trim() || authUser.name,
                role: parsed.role ?? "",
                age: parsed.age ?? "",
                battingStyle: parsed.battingStyle ?? "",
                bowlingStyle: parsed.bowlingStyle ?? "",
                teams: Array.isArray(parsed.teams) ? parsed.teams.filter((team) => typeof team === "string") : [],
                profileComplete: Boolean(parsed.profileComplete)
            });
        }
        catch {
            setProfileSetup(baseProfile);
        }
    }, [authUser?.id, authUser?.name]);
    useEffect(() => {
        if (!showUserMenu) {
            return;
        }
        const onMouseDown = (event) => {
            if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
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
        void loadMatch(activeMatchId).catch((err) => setError(err.message));
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
        setSelectedTournamentIdForMatch((previous) => tournaments.some((tournament) => tournament.id === previous) ? previous : tournaments[0].id);
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
            const awayTeamId = selectableTeams.some((team) => team.id === prev.awayTeamId && team.id !== homeTeamId)
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
        .filter((player) => Boolean(player));
    const selectedAwayXIPlayers = setupForm.awayPlayingXIPlayerIds
        .map((playerId) => setupAwaySquad.find((player) => player.id === playerId))
        .filter((player) => Boolean(player));
    useEffect(() => {
        if (!setupMatch || !setupHomeTeam || !setupAwayTeam) {
            return;
        }
        setSetupForm((prev) => {
            const nextHomeXI = sanitizeXI(prev.homePlayingXIPlayerIds, setupHomeSquad);
            const nextAwayXI = sanitizeXI(prev.awayPlayingXIPlayerIds, setupAwaySquad);
            const homeLeadership = resolveLeadership(nextHomeXI, prev.homeCaptainPlayerId, prev.homeViceCaptainPlayerId);
            const awayLeadership = resolveLeadership(nextAwayXI, prev.awayCaptainPlayerId, prev.awayViceCaptainPlayerId);
            const tossWinnerTeamId = prev.tossWinnerTeamId === setupHomeTeam.id || prev.tossWinnerTeamId === setupAwayTeam.id
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
            return new Map();
        }
        return new Map([
            [activeMatch.summary.homeTeamId, activeMatch.homePlayingXI],
            [activeMatch.summary.awayTeamId, activeMatch.awayPlayingXI]
        ]);
    }, [activeMatch]);
    const currentInnings = activeMatch?.summary.innings.find((innings) => innings.number === activeMatch.summary.currentInnings);
    const isLiveMatch = activeMatch?.summary.status === "LIVE";
    const battingTeamPlayers = currentInnings ? lineupByTeam.get(currentInnings.battingTeamId) ?? [] : [];
    const bowlingTeamPlayers = currentInnings ? lineupByTeam.get(currentInnings.bowlingTeamId) ?? [] : [];
    const nextBatterOptions = battingTeamPlayers.filter((player) => player.id !== eventActors.strikerId && player.id !== eventActors.nonStrikerId);
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
        setQuickIncomingBatterId((prev) => nextBatterOptions.some((player) => player.id === prev) ? prev : firstOption);
    }, [nextBatterOptions]);
    useEffect(() => {
        const firstFielder = bowlingTeamPlayers[0]?.id ?? "";
        if (!firstFielder) {
            setQuickFielderId("");
            return;
        }
        setQuickFielderId((prev) => bowlingTeamPlayers.some((player) => player.id === prev) ? prev : firstFielder);
    }, [bowlingTeamPlayers]);
    useEffect(() => {
        if (!isLiveMatch) {
            setShowBowlerPrompt(false);
            setNextBowlerId("");
        }
    }, [isLiveMatch]);
    async function loadAuthUser() {
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
            const data = await api("/auth/me");
            setAuthUser(data.user);
        }
        catch {
            window.localStorage.removeItem("culbcric_token");
            setAuthUser(null);
        }
        finally {
            setAuthChecked(true);
        }
    }
    async function submitAuth(e) {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
            const endpoint = authMode === "register" ? "/auth/register" : "/auth/login";
            const payload = authMode === "register"
                ? {
                    name: authForm.name.trim(),
                    email: authForm.email.trim(),
                    password: authForm.password
                }
                : {
                    email: authForm.email.trim(),
                    password: authForm.password
                };
            const result = await api(endpoint, {
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
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function logout() {
        setBusy(true);
        setError("");
        try {
            await api("/auth/logout", { method: "POST" });
        }
        catch {
            // Ignore logout failures and clear local session.
        }
        finally {
            if (typeof window !== "undefined") {
                window.localStorage.removeItem("culbcric_token");
            }
            setAuthUser(null);
            setAuthChecked(true);
            setBusy(false);
        }
    }
    function addProfileTeam() {
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
    function removeProfileTeam(teamToRemove) {
        setProfileSetup((prev) => ({
            ...prev,
            teams: prev.teams.filter((team) => team !== teamToRemove)
        }));
    }
    function saveProfileSetup(e) {
        e.preventDefault();
        if (!authUser) {
            return;
        }
        const isValid = profileSetup.name.trim() &&
            profileSetup.role &&
            profileSetup.age &&
            profileSetup.battingStyle &&
            profileSetup.teams.length > 0;
        if (!isValid) {
            setError("Please complete all required profile fields.");
            return;
        }
        const nextProfile = {
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
    async function loadTeams(authUserOverride, expectedVersion) {
        const data = await api("/teams");
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
    async function loadMatches(expectedVersion) {
        const data = await api("/matches");
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
    async function loadTournaments(expectedVersion) {
        const data = await api("/tournaments");
        if (expectedVersion !== undefined && expectedVersion !== authLoadVersionRef.current) {
            return;
        }
        setTournaments(data);
    }
    async function loadMatch(matchId) {
        const data = await api(`/matches/${matchId}`);
        setActiveMatch(data);
    }
    async function createTeam(e) {
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
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function createPlayer(e) {
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
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function removePlayerFromTeam(teamId, playerId) {
        setBusy(true);
        setError("");
        try {
            await api(`/teams/${teamId}/players/${playerId}`, { method: "DELETE" });
            await loadTeams();
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function transferTeamAdmin(e) {
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
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function createMatch(e) {
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
            const match = await api("/matches", {
                method: "POST",
                body: JSON.stringify(matchForm)
            });
            await loadMatches();
            setActiveMatchId(match.id);
            setSetupMatchId(match.id);
            setSetupTab("playingXI");
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    function toggleTournamentTeam(teamId) {
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
    async function createTournament(e) {
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
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    function openMatchSetupFromTournament(tournamentId) {
        setSelectedTournamentIdForMatch(tournamentId);
        setSetupTab("create");
        setActiveTopTab("matchSetup");
    }
    function togglePlayingXI(side, playerId) {
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
    async function startMatchWithSetup() {
        if (!setupMatch) {
            return;
        }
        if (setupForm.homePlayingXIPlayerIds.length !== 11 || setupForm.awayPlayingXIPlayerIds.length !== 11) {
            setError("Select exactly 11 players for both teams.");
            return;
        }
        if (!setupForm.homeCaptainPlayerId ||
            !setupForm.homeViceCaptainPlayerId ||
            !setupForm.awayCaptainPlayerId ||
            !setupForm.awayViceCaptainPlayerId) {
            setError("Select captain and vice-captain for both teams.");
            return;
        }
        if (setupForm.homeCaptainPlayerId === setupForm.homeViceCaptainPlayerId ||
            setupForm.awayCaptainPlayerId === setupForm.awayViceCaptainPlayerId) {
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
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    function applyStrikeRotation(input, previousBalls, shouldPromptNextBowler) {
        let strikerEndPlayerId = eventActors.strikerId;
        let nonStrikerEndPlayerId = eventActors.nonStrikerId;
        const completedRuns = input.runsOffBat + input.extraRuns;
        const rotateForRuns = completedRuns % 2 === 1;
        const rotateForCrossing = Boolean(input.crossedBeforeDismissal) && completedRuns === 0;
        if (rotateForRuns || rotateForCrossing) {
            [strikerEndPlayerId, nonStrikerEndPlayerId] = [nonStrikerEndPlayerId, strikerEndPlayerId];
        }
        if (input.isWicket) {
            const dismissedPlayerId = input.dismissedBatter === "NON_STRIKER" ? eventActors.nonStrikerId : eventActors.strikerId;
            const incomingBatterId = input.incomingBatterId;
            if (!incomingBatterId) {
                throw new Error("Select the incoming batter for wicket.");
            }
            if (strikerEndPlayerId === dismissedPlayerId) {
                strikerEndPlayerId = incomingBatterId;
            }
            else if (nonStrikerEndPlayerId === dismissedPlayerId) {
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
            const suggestedBowlerId = bowlingTeamPlayers.find((player) => player.id !== eventActors.bowlerId)?.id ??
                bowlingTeamPlayers[0]?.id ??
                "";
            setNextBowlerId(suggestedBowlerId);
            setShowBowlerPrompt(true);
        }
    }
    async function submitBallEvent(input) {
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
        const dismissedPlayerId = input.isWicket && input.dismissedBatter === "NON_STRIKER" ? eventActors.nonStrikerId : eventActors.strikerId;
        const wicketNeedsFielder = input.isWicket && ["CAUGHT", "RUN_OUT", "STUMPED"].includes(input.wicketType);
        if (wicketNeedsFielder && !input.fielderId) {
            setError("Select fielder for this wicket.");
            return;
        }
        const previousBalls = currentInnings?.balls ?? 0;
        setBusy(true);
        setError("");
        try {
            const payload = {
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
            const result = await api(`/matches/${activeMatchId}/events`, {
                method: "POST",
                body: JSON.stringify(payload)
            });
            const inningsChanged = result.summary !== null && activeMatch !== null && result.summary.currentInnings !== activeMatch.summary.currentInnings;
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
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    function confirmNextOverBowler() {
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
    function swapBatters() {
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
            return [];
        }
        const grouped = new Map();
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
            return new Map();
        }
        const map = new Map();
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
    const manageableTeams = useMemo(() => (authUser ? teams.filter((team) => team.adminUserId === authUser.id) : []), [authUser, teams]);
    const selectedTournamentForMatch = tournaments.find((tournament) => tournament.id === selectedTournamentIdForMatch) ?? null;
    const selectedTournamentTeams = selectedTournamentForMatch?.teams.map((entry) => entry.team) ?? [];
    const tournamentStatusById = useMemo(() => {
        const status = new Map();
        tournaments.forEach((tournament) => {
            const tournamentTeamIds = new Set(tournament.teams.map((entry) => entry.team.id));
            const tournamentMatches = matches.filter((match) => tournamentTeamIds.has(match.homeTeamId) && tournamentTeamIds.has(match.awayTeamId));
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
    const playerStatsRows = useMemo(() => teams.flatMap((team) => team.players.map((player) => {
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
    })), [teams]);
    const linkedPlayerIds = useMemo(() => {
        if (!authUser) {
            return new Set();
        }
        const normalizedName = authUser.name.trim().toLowerCase();
        const ids = new Set();
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
        const unique = new Map();
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
    const homeFilteredRows = useMemo(() => homeSelectedTeamId === "ALL"
        ? homePlayerRows
        : homePlayerRows.filter((row) => row.teamId === homeSelectedTeamId), [homePlayerRows, homeSelectedTeamId]);
    const homeAggregatedStats = useMemo(() => {
        if (homeFilteredRows.length === 0) {
            return null;
        }
        const totals = homeFilteredRows.reduce((acc, row) => {
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
        }, {
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
        });
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
    const homeDisplayName = profileSetup.name.trim() || homeFilteredRows[0]?.playerName || homePlayerRows[0]?.playerName || authUser?.name || "Player";
    const homeDisplayRole = profileSetup.role || homeFilteredRows[0]?.role || homePlayerRows[0]?.role || "Cricketer";
    const homeDisplayTeams = profileSetup.profileComplete && profileSetup.teams.length > 0
        ? profileSetup.teams
        : homeTeamOptions.map((team) => team.teamName);
    const selectedHomeTeamLabel = homeSelectedTeamId === "ALL"
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
            }
            else if (match.status === "COMPLETED") {
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
    const playerStatsByTeam = useMemo(() => teams
        .map((team) => ({
        teamId: team.id,
        teamName: team.name,
        teamShortCode: team.shortCode,
        players: playerStatsRows.filter((row) => row.teamId === team.id)
    }))
        .filter((team) => team.players.length > 0), [teams, playerStatsRows]);
    useEffect(() => {
        if (playerStatsByTeam.length === 0) {
            setSelectedStatsTeamId("");
            return;
        }
        setSelectedStatsTeamId((previous) => playerStatsByTeam.some((team) => team.teamId === previous) ? previous : "");
    }, [playerStatsByTeam]);
    const selectedStatsTeam = playerStatsByTeam.find((team) => team.teamId === selectedStatsTeamId) ?? null;
    const selectedTeamPlayers = selectedStatsTeam?.players ?? [];
    useEffect(() => {
        if (selectedTeamPlayers.length === 0) {
            setSelectedStatsPlayerId("");
            return;
        }
        setSelectedStatsPlayerId((previous) => selectedTeamPlayers.some((row) => row.playerId === previous) ? previous : "");
    }, [selectedTeamPlayers]);
    const selectedStatsPlayer = selectedTeamPlayers.find((row) => row.playerId === selectedStatsPlayerId) ?? null;
    const selectedLeadership = selectedStatsPlayer ? activeLeadership.get(selectedStatsPlayer.playerId) ?? null : null;
    let matchResultText = "";
    if (activeMatch?.summary.status === "COMPLETED") {
        if (winnerTeam && firstInningsSummary && secondInningsSummary) {
            if (activeMatch.summary.winnerTeamId === firstInningsSummary.battingTeamId) {
                const runMargin = firstInningsSummary.runs - secondInningsSummary.runs;
                matchResultText = `${winnerTeam.name} won by ${runMargin} run${runMargin === 1 ? "" : "s"}.`;
            }
            else {
                const wicketsLeft = Math.max(0, 10 - secondInningsSummary.wickets);
                matchResultText = `${winnerTeam.name} won by ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}.`;
            }
        }
        else {
            matchResultText = "Match tied.";
        }
    }
    const authVisualPanel = (_jsx("aside", { className: "auth-visual", children: _jsxs("div", { className: "auth-visual-content", children: [_jsx("h2", { children: "Culbcric" }), _jsx("p", { className: "auth-visual-subtitle", children: "Your ultimate cricket management platform" }), _jsx("p", { className: "auth-visual-copy", children: "Track live scores, manage teams and tournaments, and keep every player statistic in one place." })] }) }));
    const authFormSection = (_jsxs("section", { className: "auth-screen", children: [authVisualPanel, _jsx("article", { className: "auth-card", children: _jsxs("div", { className: "auth-card-inner", children: [_jsxs("div", { className: "auth-card-head", children: [_jsx("h2", { children: authMode === "register" ? "Create Your Account" : "Welcome to Culbcric" }), _jsx("p", { children: authMode === "register" ? "Sign up to access your cricket world" : "Sign in to continue" })] }), _jsxs("div", { className: "auth-account-tabs", children: [_jsx("button", { type: "button", className: authAccountType === "personal" ? "active" : "", onClick: () => setAuthAccountType("personal"), children: "Personal" }), _jsx("button", { type: "button", className: authAccountType === "team" ? "active" : "", onClick: () => setAuthAccountType("team"), children: "Team" })] }), _jsxs("form", { className: "auth-form auth-form-styled", onSubmit: submitAuth, children: [authMode === "register" ? (_jsxs("label", { children: ["Name", _jsx("div", { className: "auth-input-wrap icon-user", children: _jsx("input", { value: authForm.name, onChange: (e) => setAuthForm((prev) => ({ ...prev, name: e.target.value })), placeholder: "Your name", required: true }) })] })) : null, _jsxs("label", { children: ["Email", _jsx("div", { className: "auth-input-wrap icon-mail", children: _jsx("input", { type: "email", value: authForm.email, onChange: (e) => setAuthForm((prev) => ({ ...prev, email: e.target.value })), placeholder: "name@example.com", required: true }) })] }), _jsxs("label", { children: ["Password", _jsx("div", { className: "auth-input-wrap icon-lock", children: _jsx("input", { type: "password", value: authForm.password, onChange: (e) => setAuthForm((prev) => ({ ...prev, password: e.target.value })), placeholder: "Enter password", required: true }) })] }), authMode === "login" ? (_jsx("button", { type: "button", className: "auth-inline-link", onClick: () => undefined, children: "Forgot Password?" })) : null, _jsx("button", { disabled: busy, children: authMode === "register" ? "Create Account" : "Sign In" })] }), _jsxs("div", { className: "auth-switch-row", children: [_jsx("span", { children: authMode === "register" ? "Already have an account?" : "Don't have an account?" }), _jsx("button", { type: "button", className: "auth-inline-link", onClick: () => setAuthMode((prev) => (prev === "login" ? "register" : "login")), children: authMode === "register" ? "Sign in" : "Create account" })] })] }) })] }));
    const profileSetupPanel = (_jsx("section", { className: "profile-setup-page", children: _jsxs("article", { className: "panel profile-setup-card", children: [_jsxs("div", { className: "profile-setup-head", children: [_jsx("h2", { children: "Complete Your Cricket Profile" }), _jsx("p", { children: "Set up your player information before entering the dashboard." })] }), _jsxs("form", { className: "profile-setup-form", onSubmit: saveProfileSetup, children: [_jsxs("label", { children: ["Full Name", _jsx("input", { value: profileSetup.name, onChange: (e) => setProfileSetup((prev) => ({ ...prev, name: e.target.value })), placeholder: "Enter your full name", required: true })] }), _jsxs("label", { children: ["Playing Role", _jsxs("select", { value: profileSetup.role, onChange: (e) => setProfileSetup((prev) => ({ ...prev, role: e.target.value })), required: true, children: [_jsx("option", { value: "", children: "Select role" }), _jsx("option", { value: "Batsman", children: "Batsman" }), _jsx("option", { value: "Bowler", children: "Bowler" }), _jsx("option", { value: "All-Rounder", children: "All-Rounder" }), _jsx("option", { value: "Wicket-Keeper", children: "Wicket-Keeper" })] })] }), _jsxs("label", { children: ["Age", _jsx("input", { type: "number", min: 10, max: 100, value: profileSetup.age, onChange: (e) => setProfileSetup((prev) => ({ ...prev, age: e.target.value })), placeholder: "Enter your age", required: true })] }), _jsxs("label", { children: ["Batting Style", _jsxs("select", { value: profileSetup.battingStyle, onChange: (e) => setProfileSetup((prev) => ({ ...prev, battingStyle: e.target.value })), required: true, children: [_jsx("option", { value: "", children: "Select batting style" }), _jsx("option", { value: "Right-Hand Bat", children: "Right-Hand Bat" }), _jsx("option", { value: "Left-Hand Bat", children: "Left-Hand Bat" })] })] }), _jsxs("label", { children: ["Bowling Style", _jsxs("select", { value: profileSetup.bowlingStyle, onChange: (e) => setProfileSetup((prev) => ({ ...prev, bowlingStyle: e.target.value })), children: [_jsx("option", { value: "", children: "Select bowling style (optional)" }), _jsx("option", { value: "Right-Arm Fast", children: "Right-Arm Fast" }), _jsx("option", { value: "Left-Arm Fast", children: "Left-Arm Fast" }), _jsx("option", { value: "Right-Arm Medium", children: "Right-Arm Medium" }), _jsx("option", { value: "Left-Arm Medium", children: "Left-Arm Medium" }), _jsx("option", { value: "Right-Arm Off-Spin", children: "Right-Arm Off-Spin" }), _jsx("option", { value: "Right-Arm Leg-Spin", children: "Right-Arm Leg-Spin" }), _jsx("option", { value: "Left-Arm Orthodox", children: "Left-Arm Orthodox" }), _jsx("option", { value: "Left-Arm Chinaman", children: "Left-Arm Chinaman" }), _jsx("option", { value: "N/A", children: "N/A" })] })] }), _jsxs("div", { className: "profile-team-picker", children: [_jsxs("label", { children: ["Teams", _jsxs("div", { className: "profile-team-input-row", children: [_jsx("input", { value: profileTeamInput, onChange: (e) => setProfileTeamInput(e.target.value), placeholder: "Add team name", onKeyDown: (e) => {
                                                        if (e.key === "Enter") {
                                                            e.preventDefault();
                                                            addProfileTeam();
                                                        }
                                                    } }), _jsx("button", { type: "button", className: "secondary", onClick: addProfileTeam, children: "Add" })] })] }), _jsx("div", { className: "profile-team-chips", children: profileSetup.teams.map((team) => (_jsxs("span", { className: "profile-team-chip", children: [team, _jsx("button", { type: "button", onClick: () => removeProfileTeam(team), "aria-label": `Remove ${team}`, children: "x" })] }, team))) }), _jsx("p", { children: "Add at least one team you've played for." })] }), _jsx("button", { disabled: busy ||
                                !profileSetup.name.trim() ||
                                !profileSetup.role ||
                                !profileSetup.age ||
                                !profileSetup.battingStyle ||
                                profileSetup.teams.length === 0, children: "Complete Profile" })] })] }) }));
    const playerHomePanel = (_jsxs("section", { className: "player-home", children: [_jsxs("article", { className: "panel player-home-hero", children: [_jsx("div", { className: "player-home-banner" }), _jsxs("div", { className: "player-home-hero-content", children: [_jsx("div", { className: "player-home-avatar", children: homeDisplayName.charAt(0).toUpperCase() }), _jsxs("div", { className: "player-home-hero-meta", children: [_jsx("h2", { children: homeDisplayName }), _jsx("p", { children: homeDisplayTeams.length ? homeDisplayTeams.join(" • ") : "No teams linked yet" }), _jsxs("div", { className: "player-home-badges", children: [_jsx("span", { className: "player-home-badge", children: homeDisplayRole }), _jsx("span", { className: "player-home-badge subtle", children: selectedHomeTeamLabel })] })] })] })] }), _jsxs("div", { className: "player-home-grid", children: [_jsxs("article", { className: "panel player-home-info", children: [_jsx("h3", { children: "Player Information" }), _jsxs("div", { className: "player-home-info-list", children: [_jsxs("div", { children: [_jsx("small", { children: "Name" }), _jsx("strong", { children: profileSetup.name || authUser?.name || "-" })] }), _jsxs("div", { children: [_jsx("small", { children: "Player ID" }), _jsx("strong", { children: authUser?.playerId ?? "-" })] }), _jsxs("div", { children: [_jsx("small", { children: "Email" }), _jsx("strong", { children: authUser?.email ?? "-" })] }), _jsxs("div", { children: [_jsx("small", { children: "Teams" }), _jsx("strong", { children: homeDisplayTeams.length })] }), _jsxs("div", { children: [_jsx("small", { children: "Age" }), _jsx("strong", { children: profileSetup.age ? `${profileSetup.age} years` : "-" })] }), _jsxs("div", { children: [_jsx("small", { children: "Batting Style" }), _jsx("strong", { children: profileSetup.battingStyle || "-" })] }), _jsxs("div", { children: [_jsx("small", { children: "Bowling Style" }), _jsx("strong", { children: profileSetup.bowlingStyle || "-" })] })] }), _jsxs("label", { children: ["Team Filter", _jsxs("select", { value: homeSelectedTeamId, onChange: (e) => setHomeSelectedTeamId(e.target.value), children: [_jsx("option", { value: "ALL", children: "All Teams" }), homeTeamOptions.map((team) => (_jsxs("option", { value: team.teamId, children: [team.teamName, " (", team.teamShortCode, ")"] }, team.teamId)))] })] })] }), _jsxs("article", { className: "panel player-home-stats", children: [_jsxs("div", { className: "player-home-stats-head", children: [_jsx("h3", { children: "Career Statistics" }), _jsx("span", { children: selectedHomeTeamLabel })] }), _jsxs("div", { className: "player-home-tabs", children: [_jsx("button", { type: "button", className: homeStatsTab === "bat" ? "active" : "", onClick: () => setHomeStatsTab("bat"), children: "Bat" }), _jsx("button", { type: "button", className: homeStatsTab === "bowl" ? "active" : "", onClick: () => setHomeStatsTab("bowl"), children: "Bowl" }), _jsx("button", { type: "button", className: homeStatsTab === "field" ? "active" : "", onClick: () => setHomeStatsTab("field"), children: "Field" })] }), !homeAggregatedStats ? (_jsx("p", { className: "player-home-empty", children: "No player stats available yet. Create team/player data to populate this profile." })) : null, homeAggregatedStats && homeStatsTab === "bat" ? (_jsxs("div", { className: "player-home-metrics", children: [_jsxs("article", { children: [_jsx("small", { children: "Runs" }), _jsx("strong", { children: homeAggregatedStats.runsScored })] }), _jsxs("article", { children: [_jsx("small", { children: "Balls" }), _jsx("strong", { children: homeAggregatedStats.ballsFaced })] }), _jsxs("article", { children: [_jsx("small", { children: "Strike Rate" }), _jsx("strong", { children: formatMetric(homeAggregatedStats.battingStrikeRate) })] }), _jsxs("article", { children: [_jsx("small", { children: "Average" }), _jsx("strong", { children: formatMetric(homeAggregatedStats.battingAverage) })] }), _jsxs("article", { children: [_jsx("small", { children: "4s" }), _jsx("strong", { children: homeAggregatedStats.fours })] }), _jsxs("article", { children: [_jsx("small", { children: "6s" }), _jsx("strong", { children: homeAggregatedStats.sixes })] })] })) : null, homeAggregatedStats && homeStatsTab === "bowl" ? (_jsxs("div", { className: "player-home-metrics", children: [_jsxs("article", { children: [_jsx("small", { children: "Overs" }), _jsx("strong", { children: homeAggregatedStats.oversBowled })] }), _jsxs("article", { children: [_jsx("small", { children: "Wickets" }), _jsx("strong", { children: homeAggregatedStats.wicketsTaken })] }), _jsxs("article", { children: [_jsx("small", { children: "Runs Conceded" }), _jsx("strong", { children: homeAggregatedStats.runsConceded })] }), _jsxs("article", { children: [_jsx("small", { children: "Economy" }), _jsx("strong", { children: formatMetric(homeAggregatedStats.economy) })] }), _jsxs("article", { children: [_jsx("small", { children: "Bowling Avg" }), _jsx("strong", { children: formatMetric(homeAggregatedStats.bowlingAverage) })] }), _jsxs("article", { children: [_jsx("small", { children: "Strike Rate" }), _jsx("strong", { children: formatMetric(homeAggregatedStats.bowlingStrikeRate) })] })] })) : null, homeAggregatedStats && homeStatsTab === "field" ? (_jsxs("div", { className: "player-home-metrics", children: [_jsxs("article", { children: [_jsx("small", { children: "Catches" }), _jsx("strong", { children: homeAggregatedStats.catches })] }), _jsxs("article", { children: [_jsx("small", { children: "Run Outs" }), _jsx("strong", { children: homeAggregatedStats.runOuts })] }), _jsxs("article", { children: [_jsx("small", { children: "Stumpings" }), _jsx("strong", { children: homeAggregatedStats.stumpings })] }), _jsxs("article", { children: [_jsx("small", { children: "Total Dismissals" }), _jsx("strong", { children: homeAggregatedStats.catches + homeAggregatedStats.runOuts + homeAggregatedStats.stumpings })] })] })) : null] })] }), _jsxs("article", { className: "panel player-home-recent", children: [_jsx("h3", { children: "Recent Match Activity" }), homeRecentMatches.length === 0 ? (_jsx("p", { className: "player-home-empty", children: "No match activity for linked teams yet." })) : (_jsx("div", { className: "player-home-table-wrap", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Fixture" }), _jsx("th", { children: "Score" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Result" })] }) }), _jsx("tbody", { children: homeRecentMatches.map((item) => (_jsxs("tr", { children: [_jsx("td", { children: item.fixture }), _jsx("td", { children: item.score }), _jsx("td", { children: item.status }), _jsx("td", { children: item.result })] }, item.id))) })] }) }))] })] }));
    const createTeamPanel = (_jsxs("section", { className: "panel setup-v4-card setup-v4-team-card", children: [_jsx("h2", { children: "Create Team" }), _jsxs("form", { onSubmit: createTeam, children: [_jsxs("label", { children: ["Team Name", _jsx("input", { value: teamForm.name, onChange: (e) => setTeamForm((prev) => ({ ...prev, name: e.target.value })), required: Boolean(authUser), disabled: !authUser, placeholder: "Mumbai Titans" })] }), _jsxs("label", { children: ["Short Code", _jsx("input", { value: teamForm.shortCode, onChange: (e) => setTeamForm((prev) => ({ ...prev, shortCode: e.target.value.toUpperCase() })), required: Boolean(authUser), disabled: !authUser, maxLength: 5, placeholder: "MT" })] }), _jsx("button", { disabled: busy || !authUser, children: "Save Team (You become Admin)" })] }), _jsxs("form", { onSubmit: createPlayer, children: [_jsxs("label", { children: ["Team", _jsxs("select", { value: playerForm.teamId, onChange: (e) => setPlayerForm((prev) => ({ ...prev, teamId: e.target.value })), required: Boolean(authUser), disabled: !authUser || manageableTeams.length === 0, children: [_jsx("option", { value: "", children: "Select team" }), manageableTeams.map((team) => (_jsxs("option", { value: team.id, children: [team.name, " (", team.shortCode, ")"] }, team.id)))] })] }), _jsxs("label", { children: ["Player Name", _jsx("input", { value: playerForm.name, onChange: (e) => setPlayerForm((prev) => ({ ...prev, name: e.target.value })), required: Boolean(authUser), disabled: !authUser, placeholder: "Rahul Sharma" })] }), _jsxs("label", { children: ["Role", _jsxs("select", { value: playerForm.role, onChange: (e) => setPlayerForm((prev) => ({ ...prev, role: e.target.value })), disabled: !authUser, children: [_jsx("option", { children: "Batsman" }), _jsx("option", { children: "Bowler" }), _jsx("option", { children: "All-Rounder" }), _jsx("option", { children: "Wicket-Keeper" })] })] }), _jsx("button", { disabled: busy || !authUser || manageableTeams.length === 0, children: "Save Player" })] }), _jsxs("div", { className: "admin-section", children: [_jsx("h3", { children: "Admin Controls" }), manageableTeams.length === 0 ? (_jsx("p", { children: "You are not admin of any team yet." })) : (_jsxs(_Fragment, { children: [manageableTeams.map((team) => (_jsxs("div", { className: "admin-team-card", children: [_jsxs("strong", { children: [team.name, " (", team.shortCode, ")"] }), _jsxs("small", { children: ["Current Admin: ", team.adminUser?.name ?? "Unknown", " (", team.adminUser?.playerId ?? "--", ")"] }), _jsx("ul", { className: "list compact", children: team.players.map((player) => (_jsxs("li", { className: "admin-player-row", children: [_jsxs("span", { children: [player.name, " (", player.role, ")"] }), _jsx("button", { type: "button", className: "secondary", disabled: busy, onClick: () => void removePlayerFromTeam(team.id, player.id), children: "Remove" })] }, player.id))) })] }, team.id))), _jsxs("form", { onSubmit: transferTeamAdmin, children: [_jsxs("label", { children: ["Team", _jsxs("select", { value: adminTransferForm.teamId, onChange: (e) => setAdminTransferForm((prev) => ({ ...prev, teamId: e.target.value })), required: true, children: [_jsx("option", { value: "", children: "Select team" }), manageableTeams.map((team) => (_jsxs("option", { value: team.id, children: [team.name, " (", team.shortCode, ")"] }, team.id)))] })] }), _jsxs("label", { children: ["New Admin Player ID", _jsx("input", { value: adminTransferForm.newAdminPlayerId, onChange: (e) => setAdminTransferForm((prev) => ({ ...prev, newAdminPlayerId: e.target.value.toUpperCase() })), placeholder: "PCR-AB12CD34", required: true })] }), _jsx("button", { disabled: busy, children: "Transfer Admin Rights" })] })] }))] })] }));
    const tournamentPanel = (_jsxs("section", { className: "tournaments-v4", children: [_jsxs("article", { className: "panel tournaments-v4-header", children: [_jsxs("div", { children: [_jsx("h2", { children: "Tournaments" }), _jsx("p", { children: "Create and manage your cricket tournaments" })] }), _jsx("button", { type: "button", onClick: () => setShowTournamentCreate((prev) => !prev), className: showTournamentCreate ? "secondary" : "", children: showTournamentCreate ? "Close" : "Create Tournament" })] }), showTournamentCreate ? (_jsxs("article", { className: "panel tournaments-v4-create", children: [_jsx("h3", { children: "Create New Tournament" }), _jsxs("form", { onSubmit: createTournament, children: [_jsxs("label", { children: ["Tournament Name", _jsx("input", { value: tournamentForm.name, onChange: (e) => setTournamentForm((prev) => ({ ...prev, name: e.target.value })), required: true, placeholder: "Summer Cricket League 2026" })] }), _jsxs("div", { className: "tournament-team-picker", children: [_jsxs("p", { children: ["Select Teams (", tournamentForm.teamIds.length, ")"] }), teams.length < 2 ? _jsx("p", { className: "warning", children: "Create at least 2 teams before creating a tournament." }) : null, _jsx("div", { className: "tournament-team-chips", children: teams.map((team) => {
                                            const selected = tournamentForm.teamIds.includes(team.id);
                                            return (_jsxs("button", { type: "button", className: selected ? "chip selected" : "chip", onClick: () => toggleTournamentTeam(team.id), children: [team.name, " (", team.shortCode, ")"] }, team.id));
                                        }) })] }), _jsx("button", { disabled: busy || tournamentForm.teamIds.length < 2, children: "Create Tournament" })] })] })) : null, tournaments.length === 0 ? (_jsxs("article", { className: "panel tournaments-v4-empty", children: [_jsx("h3", { children: "No Tournaments Yet" }), _jsx("p", { children: "Create your first tournament to get started." }), _jsx("button", { type: "button", onClick: () => setShowTournamentCreate(true), children: "Create Tournament" })] })) : (_jsx("div", { className: "tournaments-v4-grid", children: tournaments.map((tournament) => {
                    const status = tournamentStatusById.get(tournament.id) ?? "upcoming";
                    return (_jsxs("article", { className: "panel tournaments-v4-card", children: [_jsxs("div", { className: "tournament-card-head", children: [_jsx("strong", { children: tournament.name }), _jsx("span", { className: `tournament-status ${status}`, children: status })] }), _jsxs("p", { children: ["By ", tournament.createdBy.name, " (", tournament.createdBy.playerId, ")"] }), _jsxs("small", { children: ["Created on ", new Date(tournament.createdAt).toLocaleDateString()] }), _jsxs("small", { children: [tournament.teams.length, " teams"] }), _jsx("small", { children: "Format: T20" }), _jsx("div", { className: "tournament-card-chips", children: tournament.teams.map((entry) => (_jsx("span", { children: entry.team.shortCode }, entry.id))) }), _jsx("button", { type: "button", onClick: () => openMatchSetupFromTournament(tournament.id), children: "Start Match" })] }, tournament.id));
                }) }))] }));
    const matchSetupPanel = (_jsxs("section", { className: "panel tournament-panel setup-v4-card setup-v4-match-card match-setup-v4", children: [_jsxs("div", { className: "match-setup-v4-top", children: [_jsx("h2", { children: "Match Setup" }), _jsx("button", { type: "button", className: "secondary", onClick: () => setActiveTopTab("tournaments"), children: "Back to Tournaments" })] }), _jsx("p", { className: "match-setup-v4-sub", children: "Configure match details and launch live scoring." }), _jsxs("div", { className: "tournament-list", children: [_jsx("h3", { children: "Start Match (Tournament)" }), _jsxs("div", { className: "tabs", children: [_jsx("button", { type: "button", className: setupTab === "create" ? "active" : "", onClick: () => setSetupTab("create"), children: "Create Match" }), _jsx("button", { type: "button", className: setupTab === "playingXI" ? "active" : "", onClick: () => setSetupTab("playingXI"), children: "Playing XI + Toss" })] }), setupTab === "create" ? (_jsxs(_Fragment, { children: [_jsxs("form", { onSubmit: createMatch, children: [_jsxs("label", { children: ["Tournament", _jsxs("select", { value: selectedTournamentIdForMatch, onChange: (e) => setSelectedTournamentIdForMatch(e.target.value), required: true, children: [_jsx("option", { value: "", children: "Select tournament" }), tournaments.map((tournament) => (_jsx("option", { value: tournament.id, children: tournament.name }, tournament.id)))] })] }), _jsxs("label", { children: ["Team 1", _jsxs("select", { value: matchForm.homeTeamId, onChange: (e) => setMatchForm((prev) => ({ ...prev, homeTeamId: e.target.value })), required: true, disabled: selectedTournamentTeams.length < 2, children: [_jsx("option", { value: "", children: "Select first team" }), selectedTournamentTeams.map((team) => (_jsxs("option", { value: team.id, children: [team.name, " (", team.shortCode, ")"] }, team.id)))] })] }), _jsxs("label", { children: ["Team 2", _jsxs("select", { value: matchForm.awayTeamId, onChange: (e) => setMatchForm((prev) => ({ ...prev, awayTeamId: e.target.value })), required: true, disabled: selectedTournamentTeams.length < 2, children: [_jsx("option", { value: "", children: "Select second team" }), selectedTournamentTeams
                                                        .filter((team) => team.id !== matchForm.homeTeamId)
                                                        .map((team) => (_jsxs("option", { value: team.id, children: [team.name, " (", team.shortCode, ")"] }, team.id)))] })] }), _jsxs("label", { children: ["Overs per innings", _jsx("input", { type: "number", min: 1, max: 50, value: matchForm.oversLimit, onChange: (e) => setMatchForm((prev) => ({ ...prev, oversLimit: Number(e.target.value) })) })] }), _jsx("button", { disabled: busy || selectedTournamentTeams.length < 2, children: "Create Scheduled Match" })] }), matchForm.homeTeamId && matchForm.awayTeamId ? (_jsxs("article", { className: "match-setup-v4-summary", children: [_jsx("h4", { children: "Match Summary" }), _jsxs("p", { children: [_jsx("span", { children: "Match:" }), " ", teams.find((team) => team.id === matchForm.homeTeamId)?.name ?? "Team 1", " vs", " ", teams.find((team) => team.id === matchForm.awayTeamId)?.name ?? "Team 2"] }), _jsxs("p", { children: [_jsx("span", { children: "Format:" }), " ", matchForm.oversLimit, " overs per side"] }), _jsxs("p", { children: [_jsx("span", { children: "Tournament:" }), " ", selectedTournamentForMatch?.name ?? "-"] })] })) : null] })) : (_jsxs("div", { className: "setup-panel", children: [_jsxs("label", { children: ["Scheduled Match", _jsxs("select", { value: setupMatchId, onChange: (e) => setSetupMatchId(e.target.value), children: [_jsx("option", { value: "", children: "Select scheduled match" }), matches
                                                .filter((match) => match.status === "SCHEDULED")
                                                .map((match) => {
                                                const home = teams.find((team) => team.id === match.homeTeamId);
                                                const away = teams.find((team) => team.id === match.awayTeamId);
                                                return (_jsxs("option", { value: match.id, children: [home?.shortCode ?? "HOME", " vs ", away?.shortCode ?? "AWAY"] }, match.id));
                                            })] })] }), !setupMatch ? _jsx("p", { children: "No scheduled match selected." }) : null, setupMatch && setupHomeTeam && setupAwayTeam ? (_jsxs(_Fragment, { children: [setupHomeSquad.length < 11 || setupAwaySquad.length < 11 ? (_jsx("p", { className: "warning", children: "Add at least 11 squad players for both teams before selecting Playing XI." })) : null, _jsxs("label", { children: ["Toss Winner", _jsxs("select", { value: setupForm.tossWinnerTeamId, onChange: (e) => setSetupForm((prev) => ({ ...prev, tossWinnerTeamId: e.target.value })), children: [_jsx("option", { value: setupHomeTeam.id, children: setupHomeTeam.name }), _jsx("option", { value: setupAwayTeam.id, children: setupAwayTeam.name })] })] }), _jsxs("label", { children: ["Elected To", _jsx("select", { value: setupForm.tossDecision, onChange: (e) => setSetupForm((prev) => ({
                                                    ...prev,
                                                    tossDecision: e.target.value
                                                })), children: TOSS_DECISIONS.map((value) => (_jsx("option", { value: value, children: value }, value))) })] }), _jsxs("article", { className: "match-setup-v4-summary", children: [_jsx("h4", { children: "Innings Preview" }), _jsxs("p", { children: [_jsx("span", { children: "Match:" }), " ", setupHomeTeam.name, " vs ", setupAwayTeam.name] }), _jsxs("p", { children: [_jsx("span", { children: "Toss:" }), " ", (setupForm.tossWinnerTeamId === setupHomeTeam.id ? setupHomeTeam.name : setupAwayTeam.name) ||
                                                        "-", " ", "won and chose ", setupForm.tossDecision.toLowerCase()] }), _jsxs("p", { children: [_jsx("span", { children: "Batting First:" }), " ", setupForm.tossDecision === "BAT"
                                                        ? setupForm.tossWinnerTeamId === setupHomeTeam.id
                                                            ? setupHomeTeam.name
                                                            : setupAwayTeam.name
                                                        : setupForm.tossWinnerTeamId === setupHomeTeam.id
                                                            ? setupAwayTeam.name
                                                            : setupHomeTeam.name] })] }), _jsxs("div", { className: "xi-grid", children: [_jsxs("div", { className: "xi-column", children: [_jsxs("h3", { children: [setupHomeTeam.shortCode, " Playing XI (", setupForm.homePlayingXIPlayerIds.length, "/11)"] }), _jsxs("label", { children: ["Captain", _jsxs("select", { value: setupForm.homeCaptainPlayerId, onChange: (e) => setSetupForm((prev) => ({ ...prev, homeCaptainPlayerId: e.target.value })), disabled: selectedHomeXIPlayers.length === 0, children: [selectedHomeXIPlayers.length === 0 ? _jsx("option", { value: "", children: "Select Playing XI first" }) : null, selectedHomeXIPlayers.map((player) => (_jsx("option", { value: player.id, children: player.name }, player.id)))] })] }), _jsxs("label", { children: ["Vice-Captain", _jsxs("select", { value: setupForm.homeViceCaptainPlayerId, onChange: (e) => setSetupForm((prev) => ({ ...prev, homeViceCaptainPlayerId: e.target.value })), disabled: selectedHomeXIPlayers.length === 0, children: [selectedHomeXIPlayers.length === 0 ? _jsx("option", { value: "", children: "Select Playing XI first" }) : null, selectedHomeXIPlayers.map((player) => (_jsx("option", { value: player.id, children: player.name }, player.id)))] })] }), setupHomeSquad.map((player) => {
                                                        const selected = setupForm.homePlayingXIPlayerIds.includes(player.id);
                                                        const captainTag = setupForm.homeCaptainPlayerId === player.id ? " (C)" : "";
                                                        const viceCaptainTag = setupForm.homeViceCaptainPlayerId === player.id ? " (VC)" : "";
                                                        return (_jsxs("button", { type: "button", className: selected ? "chip selected" : "chip", onClick: () => togglePlayingXI("home", player.id), children: [player.name, selected ? `${captainTag}${viceCaptainTag}` : ""] }, player.id));
                                                    })] }), _jsxs("div", { className: "xi-column", children: [_jsxs("h3", { children: [setupAwayTeam.shortCode, " Playing XI (", setupForm.awayPlayingXIPlayerIds.length, "/11)"] }), _jsxs("label", { children: ["Captain", _jsxs("select", { value: setupForm.awayCaptainPlayerId, onChange: (e) => setSetupForm((prev) => ({ ...prev, awayCaptainPlayerId: e.target.value })), disabled: selectedAwayXIPlayers.length === 0, children: [selectedAwayXIPlayers.length === 0 ? _jsx("option", { value: "", children: "Select Playing XI first" }) : null, selectedAwayXIPlayers.map((player) => (_jsx("option", { value: player.id, children: player.name }, player.id)))] })] }), _jsxs("label", { children: ["Vice-Captain", _jsxs("select", { value: setupForm.awayViceCaptainPlayerId, onChange: (e) => setSetupForm((prev) => ({ ...prev, awayViceCaptainPlayerId: e.target.value })), disabled: selectedAwayXIPlayers.length === 0, children: [selectedAwayXIPlayers.length === 0 ? _jsx("option", { value: "", children: "Select Playing XI first" }) : null, selectedAwayXIPlayers.map((player) => (_jsx("option", { value: player.id, children: player.name }, player.id)))] })] }), setupAwaySquad.map((player) => {
                                                        const selected = setupForm.awayPlayingXIPlayerIds.includes(player.id);
                                                        const captainTag = setupForm.awayCaptainPlayerId === player.id ? " (C)" : "";
                                                        const viceCaptainTag = setupForm.awayViceCaptainPlayerId === player.id ? " (VC)" : "";
                                                        return (_jsxs("button", { type: "button", className: selected ? "chip selected" : "chip", onClick: () => togglePlayingXI("away", player.id), children: [player.name, selected ? `${captainTag}${viceCaptainTag}` : ""] }, player.id));
                                                    })] })] }), _jsx("button", { type: "button", disabled: busy || setupMatch.status !== "SCHEDULED", onClick: () => void startMatchWithSetup(), children: "Start Live Scoring" })] })) : null] }))] })] }));
    if (!authChecked) {
        return (_jsx("div", { className: "auth-shell", children: _jsxs("section", { className: "auth-screen", children: [authVisualPanel, _jsxs("article", { className: "auth-card auth-loading-card", children: [_jsx("h2", { children: "Checking your session..." }), _jsx("p", { children: "Please wait." })] })] }) }));
    }
    if (!authUser) {
        return (_jsxs("div", { className: "auth-shell", children: [error ? _jsx("div", { className: "error", children: error }) : null, authFormSection] }));
    }
    if (!profileSetup.profileComplete) {
        return (_jsxs("div", { className: "page", children: [_jsx("header", { className: "top-nav top-nav-compact", children: _jsx("button", { type: "button", className: "secondary", onClick: () => void logout(), disabled: busy, children: "Logout" }) }), error ? _jsx("div", { className: "error", children: error }) : null, profileSetupPanel] }));
    }
    return (_jsxs("div", { className: "page", children: [_jsx("header", { className: "top-nav", children: _jsxs("div", { className: "nav-right", children: [_jsxs("nav", { className: "nav-links", children: [_jsx("button", { type: "button", className: activeTopTab === "home" ? "nav-tab active" : "nav-tab", onClick: () => setActiveTopTab("home"), children: "Home" }), _jsx("button", { type: "button", className: activeTopTab === "tournaments" ? "nav-tab active" : "nav-tab", onClick: () => setActiveTopTab("tournaments"), children: "Tournaments" }), _jsx("button", { type: "button", className: activeTopTab === "matchSetup" ? "nav-tab active" : "nav-tab", onClick: () => setActiveTopTab("matchSetup"), children: "Match Setup" }), _jsx("button", { type: "button", className: activeTopTab === "live" ? "nav-tab active" : "nav-tab", onClick: () => setActiveTopTab("live"), children: "Live Scoring" }), _jsx("button", { type: "button", className: activeTopTab === "stats" ? "nav-tab active" : "nav-tab", onClick: () => setActiveTopTab("stats"), children: "Stats Table" })] }), _jsxs("div", { className: "user-menu", ref: userMenuRef, children: [_jsxs("button", { type: "button", className: "user-menu-trigger", "aria-label": "Open profile menu", "aria-expanded": showUserMenu, onClick: () => setShowUserMenu((prev) => !prev), children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }), showUserMenu ? (_jsxs("div", { className: "user-menu-dropdown", children: [_jsxs("div", { className: "user-menu-head", children: [_jsx("strong", { children: profileSetup.name || authUser.name }), _jsx("p", { children: authUser.email }), _jsxs("p", { children: ["Player ID: ", authUser.playerId] })] }), _jsxs("div", { className: "user-menu-admin", children: [_jsx("p", { children: _jsxs("strong", { children: ["Admin Teams (", manageableTeams.length, ")"] }) }), manageableTeams.length === 0 ? (_jsx("p", { children: "No admin access assigned yet." })) : (_jsx("ul", { className: "user-menu-admin-list", children: manageableTeams.map((team) => (_jsxs("li", { children: [team.name, " (", team.shortCode, ")"] }, team.id))) }))] }), _jsx("button", { type: "button", className: "secondary user-menu-edit", onClick: () => {
                                                setShowUserMenu(false);
                                                setProfileSetup((prev) => ({ ...prev, profileComplete: false }));
                                            }, children: "Edit Profile" }), _jsx("button", { type: "button", className: "secondary", onClick: () => {
                                                setShowUserMenu(false);
                                                void logout();
                                            }, disabled: busy, children: "Logout" })] })) : null] })] }) }), error ? _jsx("div", { className: "error", children: error }) : null, activeTopTab === "home" ? playerHomePanel : null, activeTopTab === "tournaments" ? (_jsxs("section", { className: "tournaments-v4-page", children: [tournamentPanel, _jsx("div", { className: "tournaments-v4-team-block", children: createTeamPanel })] })) : null, activeTopTab === "matchSetup" ? (_jsx("section", { className: "setup-v4-page", children: matchSetupPanel })) : null, activeTopTab === "live" || activeTopTab === "stats" ? _jsxs("section", { className: "ticker-strip", children: [matches.length === 0 ? _jsx("p", { children: "No matches yet." }) : null, matches.map((match) => {
                        const home = teams.find((team) => team.id === match.homeTeamId);
                        const away = teams.find((team) => team.id === match.awayTeamId);
                        const latestInnings = match.innings[match.innings.length - 1];
                        return (_jsxs("button", { type: "button", className: activeMatchId === match.id ? "ticker-item active" : "ticker-item", onClick: () => {
                                setActiveMatchId(match.id);
                                if (match.status === "SCHEDULED") {
                                    setSetupMatchId(match.id);
                                    setSetupTab("playingXI");
                                }
                            }, children: [_jsxs("strong", { children: [home?.shortCode ?? "HOME", " vs ", away?.shortCode ?? "AWAY"] }), _jsx("small", { children: match.status }), latestInnings ? (_jsxs("small", { children: [latestInnings.runs, "/", latestInnings.wickets, " (", oversFromBalls(latestInnings.balls), ")"] })) : (_jsx("small", { children: "Not Started" }))] }, match.id));
                    })] }) : null, activeTopTab === "live" ? (_jsxs("section", { className: "live-v4-page", children: [_jsxs("article", { className: "panel live-v4-page-head", children: [_jsxs("div", { className: "live-v4-page-head-left", children: [_jsx("button", { type: "button", className: "secondary", onClick: () => setActiveTopTab("matchSetup"), children: "Back" }), _jsxs("div", { children: [_jsx("h2", { children: "Live Match" }), _jsx("p", { children: activeHomeTeam && activeAwayTeam
                                                    ? `${activeHomeTeam.name} vs ${activeAwayTeam.name}`
                                                    : "Select a match to begin scoring" })] })] }), _jsx("span", { className: "live-v4-format-badge", children: activeMatch ? `${activeMatch.summary.oversLimit} Overs` : "Format" })] }), !hasStartedMatch ? (_jsxs("article", { className: "panel live-v4-empty", children: [_jsx("h2", { children: "Live Scoring" }), _jsx("p", { children: "Start a scheduled match from the Match Setup page to unlock live scoring." })] })) : (_jsxs(_Fragment, { children: [_jsxs("article", { className: "panel live-v4-scorecard", children: [!activeMatch ? _jsx("p", { children: "Select a match to view scorecard." }) : null, activeMatch ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "live-v4-head", children: [_jsxs("div", { children: [_jsxs("h2", { children: [activeHomeTeam?.name ?? "Home", " vs ", activeAwayTeam?.name ?? "Away"] }), _jsxs("p", { children: [currentInningsTitle, activeTossWinner ? ` · Toss: ${activeTossWinner.shortCode} chose ${activeMatch.summary.tossDecision}` : ""] })] }), _jsx("span", { className: activeMatch.summary.status === "LIVE" ? "status-pill live" : "status-pill", children: activeMatch.summary.status })] }), _jsxs("div", { className: "live-v4-main-score", children: [_jsxs("strong", { children: [currentInnings?.runs ?? 0, "/", currentInnings?.wickets ?? 0] }), _jsxs("p", { children: ["Overs ", currentInnings?.overDisplay ?? "0.0", " / ", activeMatch.summary.oversLimit] }), _jsxs("p", { children: [teams.find((team) => team.id === currentInnings?.battingTeamId)?.name ?? "Batting Team", " batting"] })] }), _jsxs("div", { className: "live-v4-metrics", children: [_jsxs("div", { children: [_jsx("small", { children: "Run Rate" }), _jsx("strong", { children: currentRunRate })] }), chaseTarget !== null ? (_jsxs("div", { children: [_jsx("small", { children: "Target" }), _jsx("strong", { children: chaseTarget })] })) : null, requiredRunRate !== null ? (_jsxs("div", { children: [_jsx("small", { children: "Required RR" }), _jsx("strong", { children: requiredRunRate })] })) : null] }), matchResultText ? _jsx("p", { className: "result-line", children: matchResultText }) : null] })) : null] }), currentOverBalls.length > 0 ? (_jsxs("article", { className: "panel live-v4-current-over", children: [_jsx("h3", { children: "Current Over" }), _jsx("div", { className: "live-v4-ball-row", children: currentOverBalls.map((item) => (_jsx("span", { className: [
                                                "live-v4-ball",
                                                item.isWicket ? "wicket" : "",
                                                item.extraType !== "NONE" ? "extra" : "",
                                                item.runsOffBat >= 4 && item.extraType === "NONE" ? "boundary" : ""
                                            ]
                                                .filter(Boolean)
                                                .join(" "), children: ballEventLabel(item) }, item.id))) })] })) : null, _jsxs("article", { className: "panel live-v4-controls", children: [_jsx("h3", { children: "Quick Scoring" }), !activeMatchListItem ? _jsx("p", { children: "Select a match." }) : null, activeMatchListItem && activeMatchListItem.status === "SCHEDULED" ? (_jsx("p", { children: "This match is scheduled. Open Match Setup page, complete Playing XI and toss, then start live scoring." })) : null, !activeMatch || !currentInnings ? null : (_jsxs(_Fragment, { children: [showBowlerPrompt ? (_jsx("div", { className: "overlay", children: _jsxs("div", { className: "overlay-card", children: [_jsx("h3", { children: "Over Complete" }), _jsx("p", { children: "Select bowler for the next over." }), _jsx("select", { value: nextBowlerId, onChange: (e) => setNextBowlerId(e.target.value), children: bowlingTeamPlayers.map((player) => (_jsx("option", { value: player.id, children: player.name }, player.id))) }), _jsx("button", { type: "button", onClick: confirmNextOverBowler, children: "Confirm Bowler" })] }) })) : null, isLiveMatch ? (_jsxs("div", { className: "quick-score", children: [_jsxs("div", { className: "selector-row", children: [_jsxs("label", { children: ["Striker", _jsx("select", { value: eventActors.strikerId, onChange: (e) => setEventActors((prev) => ({ ...prev, strikerId: e.target.value })), disabled: showBowlerPrompt, children: battingTeamPlayers.map((player) => (_jsx("option", { value: player.id, children: player.name }, player.id))) })] }), _jsxs("label", { children: ["Non-striker", _jsx("select", { value: eventActors.nonStrikerId, onChange: (e) => setEventActors((prev) => ({ ...prev, nonStrikerId: e.target.value })), disabled: showBowlerPrompt, children: battingTeamPlayers.map((player) => (_jsx("option", { value: player.id, children: player.name }, player.id))) })] }), _jsxs("label", { children: ["Bowler", _jsx("select", { value: eventActors.bowlerId, onChange: (e) => setEventActors((prev) => ({ ...prev, bowlerId: e.target.value })), disabled: showBowlerPrompt, children: bowlingTeamPlayers.map((player) => (_jsx("option", { value: player.id, children: player.name }, player.id))) })] }), _jsx("button", { type: "button", onClick: swapBatters, className: "secondary", disabled: showBowlerPrompt, children: "Swap Strike" })] }), _jsxs("label", { children: ["Quick Commentary (optional)", _jsx("input", { value: commentary, onChange: (e) => setCommentary(e.target.value), placeholder: "Optional short note", maxLength: 240, disabled: showBowlerPrompt })] }), _jsxs("div", { className: "quick-actions", children: [_jsx("h4", { children: "Runs" }), _jsx("div", { className: "live-v4-run-grid", children: [0, 1, 2, 3, 4, 6].map((run) => (_jsx("button", { type: "button", className: run >= 4 ? "live-v4-run-btn boundary" : "live-v4-run-btn", onClick: () => void submitBallEvent({
                                                                        runsOffBat: run,
                                                                        extraType: "NONE",
                                                                        extraRuns: 0,
                                                                        isWicket: false,
                                                                        wicketType: "NONE"
                                                                    }), disabled: scoringLocked, children: run }, run))) })] }), _jsxs("div", { className: "quick-actions", children: [_jsx("h4", { children: "Extras" }), _jsxs("div", { className: "live-v4-extra-grid", children: [_jsx("button", { type: "button", disabled: scoringLocked, onClick: () => void submitBallEvent({
                                                                            runsOffBat: 0,
                                                                            extraType: "WIDE",
                                                                            extraRuns: 1,
                                                                            isWicket: false,
                                                                            wicketType: "NONE"
                                                                        }), children: "Wide" }), _jsx("button", { type: "button", disabled: scoringLocked, onClick: () => void submitBallEvent({
                                                                            runsOffBat: 0,
                                                                            extraType: "NO_BALL",
                                                                            extraRuns: 1,
                                                                            isWicket: false,
                                                                            wicketType: "NONE"
                                                                        }), children: "No Ball" }), _jsx("button", { type: "button", disabled: scoringLocked, onClick: () => void submitBallEvent({
                                                                            runsOffBat: 0,
                                                                            extraType: "BYE",
                                                                            extraRuns: 1,
                                                                            isWicket: false,
                                                                            wicketType: "NONE"
                                                                        }), children: "Bye" }), _jsx("button", { type: "button", disabled: scoringLocked, onClick: () => void submitBallEvent({
                                                                            runsOffBat: 0,
                                                                            extraType: "LEG_BYE",
                                                                            extraRuns: 1,
                                                                            isWicket: false,
                                                                            wicketType: "NONE"
                                                                        }), children: "Leg Bye" })] })] }), _jsxs("div", { className: "quick-actions", children: [_jsx("h4", { children: "Wicket" }), _jsxs("div", { className: "live-v4-wicket-grid", children: [_jsx("select", { value: quickWicketType, onChange: (e) => setQuickWicketType(e.target.value), disabled: showBowlerPrompt, children: WICKET_TYPES.filter((value) => value !== "NONE").map((value) => (_jsx("option", { value: value, children: value }, value))) }), quickWicketType === "RUN_OUT" ? (_jsxs("select", { value: quickDismissedBatter, onChange: (e) => setQuickDismissedBatter(e.target.value), disabled: showBowlerPrompt, children: [_jsx("option", { value: "STRIKER", children: "Out: Striker" }), _jsx("option", { value: "NON_STRIKER", children: "Out: Non-striker" })] })) : null, ["CAUGHT", "RUN_OUT", "STUMPED"].includes(quickWicketType) ? (_jsxs("select", { value: quickFielderId, onChange: (e) => setQuickFielderId(e.target.value), disabled: showBowlerPrompt || bowlingTeamPlayers.length === 0, children: [bowlingTeamPlayers.length === 0 ? _jsx("option", { value: "", children: "No fielder available" }) : null, bowlingTeamPlayers.map((player) => (_jsxs("option", { value: player.id, children: ["Fielder: ", player.name] }, player.id)))] })) : null, _jsxs("select", { value: quickIncomingBatterId, onChange: (e) => setQuickIncomingBatterId(e.target.value), disabled: showBowlerPrompt || nextBatterOptions.length === 0, children: [nextBatterOptions.length === 0 ? _jsx("option", { value: "", children: "No batter available" }) : null, nextBatterOptions.map((player) => (_jsxs("option", { value: player.id, children: ["Incoming: ", player.name] }, player.id)))] }), _jsxs("label", { className: "checkbox-row inline-check", children: [_jsx("input", { type: "checkbox", checked: quickCrossedBeforeDismissal, onChange: (e) => setQuickCrossedBeforeDismissal(e.target.checked), disabled: showBowlerPrompt }), "Crossed before dismissal"] }), _jsx("button", { type: "button", disabled: scoringLocked ||
                                                                            !quickIncomingBatterId ||
                                                                            (["CAUGHT", "RUN_OUT", "STUMPED"].includes(quickWicketType) && !quickFielderId), onClick: () => void submitBallEvent({
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
                                                                        }), children: "Add Wicket" })] })] })] })) : (_jsx("p", { children: "This match is completed. Ball scoring is locked." }))] }))] }), _jsxs("article", { className: "panel live-v4-over-history", children: [_jsx("h3", { children: "Previous Overs" }), previousOverGroups.length === 0 ? (_jsx("p", { children: "No completed overs yet." })) : (_jsx("div", { className: "live-v4-over-list", children: previousOverGroups.map((over) => (_jsxs("div", { className: "live-v4-over-row", children: [_jsxs("span", { children: ["Over ", over.overNumber] }), _jsx("div", { className: "live-v4-ball-row", children: over.balls.map((item) => (_jsx("span", { className: [
                                                            "live-v4-ball small",
                                                            item.isWicket ? "wicket" : "",
                                                            item.extraType !== "NONE" ? "extra" : "",
                                                            item.runsOffBat >= 4 && item.extraType === "NONE" ? "boundary" : ""
                                                        ]
                                                            .filter(Boolean)
                                                            .join(" "), children: ballEventLabel(item) }, item.id))) }), _jsxs("small", { children: [over.balls.reduce((sum, item) => sum + item.runsOffBat + item.extraRuns, 0), " runs"] })] }, over.overNumber))) }))] }), _jsxs("article", { className: "panel live-v4-recent", children: [_jsx("h3", { children: "Recent Balls" }), _jsx("ul", { className: "list compact", children: activeMatch?.recentEvents.map((item) => (_jsxs("li", { children: [_jsxs("strong", { children: [item.overNumber, ".", item.ballInOver] }), _jsxs("span", { children: [item.striker.name, " vs ", item.bowler.name, ": ", item.runsOffBat, "+", item.extraRuns, " (", item.extraType, ")", item.isWicket ? ` WICKET(${item.wicketType})` : ""] })] }, item.id))) })] }), activeMatch?.summary.status === "COMPLETED" ? (_jsxs("article", { className: "panel summary-card", children: [_jsx("h3", { children: "Match Summary" }), matchResultText ? _jsx("p", { children: matchResultText }) : null, _jsxs("p", { children: ["Toss: ", activeTossWinner?.name ?? "N/A", " elected to ", activeMatch.summary.tossDecision ?? "N/A"] }), _jsxs("p", { children: ["1st Innings: ", teams.find((team) => team.id === firstInningsSummary?.battingTeamId)?.shortCode ?? "--", " ", firstInningsSummary?.runs ?? 0, "/", firstInningsSummary?.wickets ?? 0, " (", firstInningsSummary?.overDisplay ?? "0.0", ")"] }), _jsxs("p", { children: ["2nd Innings: ", teams.find((team) => team.id === secondInningsSummary?.battingTeamId)?.shortCode ?? "--", " ", secondInningsSummary?.runs ?? 0, "/", secondInningsSummary?.wickets ?? 0, " (", secondInningsSummary?.overDisplay ?? "0.0", ")"] })] })) : null, _jsxs("article", { className: "panel live-v4-match-list", children: [_jsx("h3", { children: "Matches" }), _jsx("div", { className: "live-v4-match-grid", children: matches.map((match) => {
                                            const home = teams.find((team) => team.id === match.homeTeamId);
                                            const away = teams.find((team) => team.id === match.awayTeamId);
                                            const latestInnings = match.innings[match.innings.length - 1];
                                            const tossWinner = teams.find((team) => team.id === match.tossWinnerTeamId);
                                            return (_jsxs("button", { type: "button", className: activeMatchId === match.id ? "live-v4-match-tile active" : "live-v4-match-tile", onClick: () => {
                                                    setActiveMatchId(match.id);
                                                    if (match.status === "SCHEDULED") {
                                                        setSetupMatchId(match.id);
                                                        setActiveTopTab("matchSetup");
                                                        setSetupTab("playingXI");
                                                    }
                                                }, children: [_jsxs("strong", { children: [home?.shortCode ?? "HOME", " vs ", away?.shortCode ?? "AWAY"] }), _jsx("small", { children: match.status }), match.tossWinnerTeamId && match.tossDecision ? (_jsxs("small", { children: ["Toss: ", tossWinner?.shortCode ?? "--", " chose ", match.tossDecision] })) : (_jsx("small", { children: "Toss pending" })), latestInnings ? (_jsxs("small", { children: [latestInnings.runs, "/", latestInnings.wickets, " (", oversFromBalls(latestInnings.balls), ")"] })) : (_jsx("small", { children: "Score not started" }))] }, match.id));
                                        }) })] })] }))] })) : null, activeTopTab === "stats" ? (_jsxs("section", { className: "panel stats-panel", children: [_jsxs("div", { className: "stats-head", children: [_jsx("h2", { children: "Player Stats" }), _jsx("p", { children: "Select a team, then choose a player to view full batting, bowling and fielding stats." })] }), _jsxs("div", { className: "stats-layout", children: [_jsxs("aside", { className: "stats-team-list", children: [_jsx("h3", { children: "Teams" }), _jsx("div", { className: "stats-team-buttons", children: playerStatsByTeam.map((team) => (_jsxs("button", { type: "button", className: selectedStatsTeamId === team.teamId ? "stats-team-btn active" : "stats-team-btn", onClick: () => {
                                                setSelectedStatsTeamId(team.teamId);
                                                setSelectedStatsPlayerId("");
                                            }, children: [team.teamName, " (", team.teamShortCode, ")"] }, team.teamId))) })] }), _jsxs("aside", { className: "stats-player-list", children: [_jsx("h3", { children: "Players" }), !selectedStatsTeam ? _jsx("p", { children: "Select a team first." }) : null, selectedStatsTeam ? (_jsxs(_Fragment, { children: [_jsxs("p", { className: "stats-selected-team", children: [selectedStatsTeam.teamName, " (", selectedStatsTeam.teamShortCode, ")"] }), _jsx("div", { className: "stats-player-buttons", children: selectedTeamPlayers.map((player) => (_jsx("button", { type: "button", className: selectedStatsPlayerId === player.playerId ? "stats-player-btn active" : "stats-player-btn", onClick: () => setSelectedStatsPlayerId(player.playerId), children: player.playerName }, player.playerId))) })] })) : null] }), _jsx("article", { className: "stats-detail", children: !selectedStatsPlayer ? _jsx("p", { children: "Select a player to view stats." }) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "player-stat-top", children: [_jsxs("div", { children: [_jsx("h3", { children: selectedStatsPlayer.playerName }), _jsxs("p", { children: [selectedStatsPlayer.teamName, " (", selectedStatsPlayer.teamShortCode, ") \u00B7 ", selectedStatsPlayer.role] })] }), selectedLeadership ? _jsx("span", { className: "leader-chip", children: selectedLeadership }) : null] }), _jsxs("section", { className: "stats-block", children: [_jsx("h4", { children: "Batting" }), _jsxs("div", { className: "metric-grid", children: [_jsxs("div", { className: "metric", children: [_jsx("span", { children: "Runs" }), _jsx("strong", { children: selectedStatsPlayer.runsScored })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Balls" }), _jsx("strong", { children: selectedStatsPlayer.ballsFaced })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Outs" }), _jsx("strong", { children: selectedStatsPlayer.dismissals })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "4s / 6s" }), _jsxs("strong", { children: [selectedStatsPlayer.fours, " / ", selectedStatsPlayer.sixes] })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Strike Rate" }), _jsx("strong", { children: formatMetric(selectedStatsPlayer.battingStrikeRate) })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Average" }), _jsx("strong", { children: formatMetric(selectedStatsPlayer.battingAverage) })] })] })] }), _jsxs("section", { className: "stats-block", children: [_jsx("h4", { children: "Bowling" }), _jsxs("div", { className: "metric-grid", children: [_jsxs("div", { className: "metric", children: [_jsx("span", { children: "Overs" }), _jsx("strong", { children: selectedStatsPlayer.oversBowled })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Balls" }), _jsx("strong", { children: selectedStatsPlayer.ballsBowled })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Runs" }), _jsx("strong", { children: selectedStatsPlayer.runsConceded })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Wickets" }), _jsx("strong", { children: selectedStatsPlayer.wicketsTaken })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Dot Balls" }), _jsx("strong", { children: selectedStatsPlayer.dotBalls })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Economy" }), _jsx("strong", { children: formatMetric(selectedStatsPlayer.economy) })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Average" }), _jsx("strong", { children: formatMetric(selectedStatsPlayer.bowlingAverage) })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Strike Rate" }), _jsx("strong", { children: formatMetric(selectedStatsPlayer.bowlingStrikeRate) })] })] })] }), _jsxs("section", { className: "stats-block", children: [_jsx("h4", { children: "Fielding" }), _jsxs("div", { className: "metric-grid", children: [_jsxs("div", { className: "metric", children: [_jsx("span", { children: "Catches" }), _jsx("strong", { children: selectedStatsPlayer.catches })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Stumpings" }), _jsx("strong", { children: selectedStatsPlayer.stumpings })] }), _jsxs("div", { className: "metric", children: [_jsx("span", { children: "Run Outs" }), _jsx("strong", { children: selectedStatsPlayer.runOuts })] })] })] })] })) })] })] })) : null] }));
}
