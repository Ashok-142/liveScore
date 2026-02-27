import cors from "cors";
import express from "express";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Prisma, PrismaClient } from "@prisma/client";
import { Server } from "socket.io";
import {
  EXTRA_TYPES,
  TOSS_DECISIONS,
  WICKET_TYPES,
  type BallEventInput,
  type MatchSummaryDTO,
  type TossDecision
} from "@culbcric/shared";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"
  }
});

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"
  })
);
app.use(express.json());

type AsyncHandler = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => Promise<unknown>;

function asyncHandler(handler: AsyncHandler) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

io.on("connection", (socket) => {
  socket.on("join:match", (matchId: string) => {
    socket.join(`match:${matchId}`);
  });

  socket.on("leave:match", (matchId: string) => {
    socket.leave(`match:${matchId}`);
  });
});

const createTeamSchema = z.object({
  name: z.string().min(2),
  shortCode: z
    .string()
    .min(2)
    .max(5)
    .transform((value) => value.toUpperCase())
});

const createPlayerSchema = z.object({
  name: z.string().min(2),
  role: z.string().min(2)
});

const createMatchSchema = z.object({
  homeTeamId: z.string().min(1),
  awayTeamId: z.string().min(1),
  oversLimit: z.number().int().min(1).max(50).default(20)
});

const playingXISchema = z
  .array(z.string().min(1))
  .length(11)
  .refine((ids) => new Set(ids).size === 11, "Playing XI must contain 11 unique players.");

const startMatchSchema = z.object({
  tossWinnerTeamId: z.string().min(1),
  tossDecision: z.enum(TOSS_DECISIONS),
  homePlayingXIPlayerIds: playingXISchema,
  awayPlayingXIPlayerIds: playingXISchema,
  homeCaptainPlayerId: z.string().min(1),
  homeViceCaptainPlayerId: z.string().min(1),
  awayCaptainPlayerId: z.string().min(1),
  awayViceCaptainPlayerId: z.string().min(1)
});

const ballEventSchema: z.ZodType<BallEventInput> = z.object({
  strikerId: z.string().min(1),
  nonStrikerId: z.string().min(1),
  bowlerId: z.string().min(1),
  dismissedPlayerId: z.string().min(1).optional(),
  fielderId: z.string().min(1).optional(),
  runsOffBat: z.number().int().min(0).max(6),
  extraType: z.enum(EXTRA_TYPES),
  extraRuns: z.number().int().min(0).max(6),
  isWicket: z.boolean(),
  wicketType: z.enum(WICKET_TYPES),
  commentary: z.string().max(240).optional()
});

const completeMatchSchema = z.object({
  winnerTeamId: z.string().min(1).optional()
});

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(100)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const changeAdminSchema = z.object({
  newAdminPlayerId: z.string().min(1)
});

const createTournamentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  teamIds: z
    .array(z.string().min(1))
    .min(2, "Select at least two teams.")
    .refine((teamIds) => new Set(teamIds).size === teamIds.length, "Tournament teams must be unique.")
});

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  playerId: string;
};

type AuthContext = {
  user: AuthenticatedUser;
  tokenHash: string;
};

const SESSION_TTL_DAYS = 30;

function toOverDisplay(balls: number): string {
  const overs = Math.floor(balls / 6);
  const ball = balls % 6;
  return `${overs}.${ball}`;
}

function isLegalDelivery(extraType: BallEventInput["extraType"]): boolean {
  return extraType !== "WIDE" && extraType !== "NO_BALL";
}

function isBowlerCharged(extraType: BallEventInput["extraType"]): boolean {
  return extraType === "WIDE" || extraType === "NO_BALL";
}

function getFirstInningsTeams(match: { homeTeamId: string; awayTeamId: string }, tossWinnerTeamId: string, tossDecision: TossDecision) {
  const tossLoserTeamId = tossWinnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;

  if (tossDecision === "BAT") {
    return {
      battingTeamId: tossWinnerTeamId,
      bowlingTeamId: tossLoserTeamId
    };
  }

  return {
    battingTeamId: tossLoserTeamId,
    bowlingTeamId: tossWinnerTeamId
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) {
    return false;
  }

  const derived = scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(keyHex, "hex");
  if (derived.length !== keyBuffer.length) {
    return false;
  }

  return timingSafeEqual(derived, keyBuffer);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readBearerToken(req: express.Request): string | null {
  const header = req.header("authorization");
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.authSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt
    }
  });

  return { token, expiresAt };
}

async function generateUniquePlayerId(): Promise<string> {
  while (true) {
    const candidate = `PCR-${randomBytes(4).toString("hex").toUpperCase()}`;
    const existing = await prisma.user.findUnique({
      where: { playerId: candidate },
      select: { id: true }
    });

    if (!existing) {
      return candidate;
    }
  }
}

async function getAuthContext(req: express.Request): Promise<AuthContext | null> {
  const token = readBearerToken(req);
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          playerId: true
        }
      }
    }
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return {
    user: session.user,
    tokenHash
  };
}

async function requireAuth(req: express.Request, res: express.Response): Promise<AuthContext | null> {
  const context = await getAuthContext(req);
  if (!context) {
    res.status(401).json({ error: "Unauthorized. Please login first." });
    return null;
  }

  return context;
}

async function ensurePlayerStatRows(
  tx: Prisma.TransactionClient,
  matchId: string,
  playerId: string,
  teamId: string
): Promise<void> {
  await tx.playerMatchStat.upsert({
    where: { matchId_playerId: { matchId, playerId } },
    update: {},
    create: {
      matchId,
      playerId,
      teamId
    }
  });

  await tx.playerCareerStat.upsert({
    where: { playerId },
    update: {},
    create: { playerId }
  });
}

async function ensureTeamCareerRow(tx: Prisma.TransactionClient, teamId: string): Promise<void> {
  await tx.teamCareerStat.upsert({
    where: { teamId },
    update: {},
    create: { teamId }
  });
}

async function buildMatchSummary(matchId: string): Promise<MatchSummaryDTO | null> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      innings: {
        orderBy: { number: "asc" }
      }
    }
  });

  if (!match) {
    return null;
  }

  return {
    id: match.id,
    status: match.status,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    winnerTeamId: match.winnerTeamId,
    tossWinnerTeamId: match.tossWinnerTeamId,
    tossDecision: match.tossDecision,
    firstBattingTeamId: match.firstBattingTeamId,
    firstBowlingTeamId: match.firstBowlingTeamId,
    currentInnings: match.currentInnings,
    oversLimit: match.oversLimit,
    innings: match.innings.map((innings) => ({
      id: innings.id,
      number: innings.number,
      battingTeamId: innings.battingTeamId,
      bowlingTeamId: innings.bowlingTeamId,
      runs: innings.runs,
      wickets: innings.wickets,
      balls: innings.balls,
      overDisplay: toOverDisplay(innings.balls)
    }))
  };
}

app.get(
  "/health",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true });
  })
);

app.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const email = normalizeEmail(parsed.data.email);
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const playerId = await generateUniquePlayerId();
    const passwordHash = hashPassword(parsed.data.password);

    const user = await prisma.user.create({
      data: {
        name: parsed.data.name.trim(),
        email,
        passwordHash,
        playerId
      },
      select: {
        id: true,
        name: true,
        email: true,
        playerId: true
      }
    });

    const session = await createSession(user.id);

    return res.status(201).json({
      token: session.token,
      expiresAt: session.expiresAt,
      user
    });
  })
);

app.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const email = normalizeEmail(parsed.data.email);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const session = await createSession(user.id);

    return res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        playerId: user.playerId
      }
    });
  })
);

app.get(
  "/auth/me",
  asyncHandler(async (req, res) => {
    const auth = await requireAuth(req, res);
    if (!auth) {
      return;
    }

    res.json({ user: auth.user });
  })
);

app.post(
  "/auth/logout",
  asyncHandler(async (req, res) => {
    const auth = await getAuthContext(req);
    if (auth) {
      await prisma.authSession.deleteMany({
        where: { tokenHash: auth.tokenHash }
      });
    }

    res.json({ ok: true });
  })
);

app.get(
  "/teams",
  asyncHandler(async (_req, res) => {
    const teams = await prisma.team.findMany({
      include: {
        adminUser: {
          select: {
            id: true,
            name: true,
            playerId: true
          }
        },
        players: {
          include: {
            careerStat: true
          },
          orderBy: { createdAt: "asc" }
        },
        teamCareerStat: true
      },
      orderBy: { createdAt: "asc" }
    });

    res.json(teams);
  })
);

app.post(
  "/teams",
  asyncHandler(async (req, res) => {
    const auth = await requireAuth(req, res);
    if (!auth) {
      return;
    }

    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const existing = await prisma.team.findUnique({
      where: { shortCode: parsed.data.shortCode }
    });

    if (existing) {
      return res.status(409).json({ error: "Team shortCode already exists." });
    }

    const team = await prisma.team.create({
      data: {
        ...parsed.data,
        adminUserId: auth.user.id,
        teamCareerStat: {
          create: {}
        }
      },
      include: {
        adminUser: {
          select: {
            id: true,
            name: true,
            playerId: true
          }
        },
        players: true,
        teamCareerStat: true
      }
    });

    return res.status(201).json(team);
  })
);

app.post(
  "/teams/:teamId/players",
  asyncHandler(async (req, res) => {
    const auth = await requireAuth(req, res);
    if (!auth) {
      return;
    }

    const parsed = createPlayerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const team = await prisma.team.findUnique({ where: { id: req.params.teamId } });
    if (!team) {
      return res.status(404).json({ error: "Team not found." });
    }

    if (!team.adminUserId || team.adminUserId !== auth.user.id) {
      return res.status(403).json({ error: "Only team admin can add players." });
    }

    const player = await prisma.player.create({
      data: {
        ...parsed.data,
        teamId: team.id,
        careerStat: {
          create: {}
        }
      }
    });

    return res.status(201).json(player);
  })
);

app.delete(
  "/teams/:teamId/players/:playerId",
  asyncHandler(async (req, res) => {
    const auth = await requireAuth(req, res);
    if (!auth) {
      return;
    }

    const team = await prisma.team.findUnique({ where: { id: req.params.teamId } });
    if (!team) {
      return res.status(404).json({ error: "Team not found." });
    }

    if (!team.adminUserId || team.adminUserId !== auth.user.id) {
      return res.status(403).json({ error: "Only team admin can remove players." });
    }

    const player = await prisma.player.findUnique({ where: { id: req.params.playerId } });
    if (!player || player.teamId !== team.id) {
      return res.status(404).json({ error: "Player not found in this team." });
    }

    await prisma.player.delete({
      where: { id: player.id }
    });

    return res.json({ ok: true });
  })
);

app.post(
  "/teams/:teamId/admin",
  asyncHandler(async (req, res) => {
    const auth = await requireAuth(req, res);
    if (!auth) {
      return;
    }

    const parsed = changeAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const team = await prisma.team.findUnique({ where: { id: req.params.teamId } });
    if (!team) {
      return res.status(404).json({ error: "Team not found." });
    }

    if (!team.adminUserId || team.adminUserId !== auth.user.id) {
      return res.status(403).json({ error: "Only current admin can transfer admin rights." });
    }

    const nextAdmin = await prisma.user.findUnique({
      where: { playerId: parsed.data.newAdminPlayerId.trim().toUpperCase() }
    });
    if (!nextAdmin) {
      return res.status(404).json({ error: "User with this player ID was not found." });
    }

    const updatedTeam = await prisma.team.update({
      where: { id: team.id },
      data: {
        adminUserId: nextAdmin.id
      },
      include: {
        adminUser: {
          select: {
            id: true,
            name: true,
            playerId: true
          }
        }
      }
    });

    return res.json(updatedTeam);
  })
);

app.get(
  "/teams/:teamId/players",
  asyncHandler(async (req, res) => {
    const players = await prisma.player.findMany({
      where: { teamId: req.params.teamId },
      include: {
        careerStat: true
      },
      orderBy: { createdAt: "asc" }
    });

    res.json(players);
  })
);

app.get(
  "/tournaments",
  asyncHandler(async (req, res) => {
    const auth = await requireAuth(req, res);
    if (!auth) {
      return;
    }

    const tournaments = await prisma.tournament.findMany({
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            playerId: true
          }
        },
        teams: {
          include: {
            team: {
              select: {
                id: true,
                name: true,
                shortCode: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.json(tournaments);
  })
);

app.post(
  "/tournaments",
  asyncHandler(async (req, res) => {
    const auth = await requireAuth(req, res);
    if (!auth) {
      return;
    }

    const parsed = createTournamentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const teams = await prisma.team.findMany({
      where: {
        id: {
          in: parsed.data.teamIds
        }
      },
      select: {
        id: true
      }
    });

    if (teams.length !== parsed.data.teamIds.length) {
      return res.status(404).json({ error: "One or more selected teams were not found." });
    }

    const tournament = await prisma.tournament.create({
      data: {
        name: parsed.data.name,
        createdByUserId: auth.user.id,
        teams: {
          create: parsed.data.teamIds.map((teamId) => ({
            teamId
          }))
        }
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            playerId: true
          }
        },
        teams: {
          include: {
            team: {
              select: {
                id: true,
                name: true,
                shortCode: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    return res.status(201).json(tournament);
  })
);

app.get(
  "/matches",
  asyncHandler(async (req, res) => {
    const rawStatus = req.query.status as string | undefined;
    const status = rawStatus ? z.enum(["SCHEDULED", "LIVE", "COMPLETED"] as const).safeParse(rawStatus) : null;
    if (rawStatus && !status?.success) {
      return res.status(400).json({ error: "Invalid status filter." });
    }

    const matches = await prisma.match.findMany({
      where: status?.success ? { status: status.data } : undefined,
      include: {
        innings: {
          orderBy: { number: "asc" }
        },
        homeTeam: true,
        awayTeam: true,
        tossWinnerTeam: true
      },
      orderBy: [{ status: "asc" }, { startedAt: "desc" }]
    });

    res.json(matches);
  })
);

app.post(
  "/matches",
  asyncHandler(async (req, res) => {
    const parsed = createMatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    if (parsed.data.homeTeamId === parsed.data.awayTeamId) {
      return res.status(400).json({ error: "Home and away teams must be different." });
    }

    const [homeTeam, awayTeam] = await Promise.all([
      prisma.team.findUnique({ where: { id: parsed.data.homeTeamId } }),
      prisma.team.findUnique({ where: { id: parsed.data.awayTeamId } })
    ]);

    if (!homeTeam || !awayTeam) {
      return res.status(404).json({ error: "One or both teams not found." });
    }

    const match = await prisma.match.create({
      data: {
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        oversLimit: parsed.data.oversLimit,
        status: "SCHEDULED"
      },
      include: {
        innings: true,
        homeTeam: true,
        awayTeam: true
      }
    });

    io.emit("match:created", match);

    return res.status(201).json(match);
  })
);

app.post(
  "/matches/:matchId/start",
  asyncHandler(async (req, res) => {
    const parsed = startMatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const match = await prisma.match.findUnique({
      where: { id: req.params.matchId },
      include: {
        innings: true
      }
    });

    if (!match) {
      return res.status(404).json({ error: "Match not found." });
    }

    if (match.status !== "SCHEDULED") {
      return res.status(400).json({ error: "Only scheduled matches can be started." });
    }

    if (match.innings.length > 0 || match.startedAt) {
      return res.status(400).json({ error: "This match has already been started." });
    }

    if (parsed.data.tossWinnerTeamId !== match.homeTeamId && parsed.data.tossWinnerTeamId !== match.awayTeamId) {
      return res.status(400).json({ error: "Toss winner must be one of the two match teams." });
    }

    const combinedPlayerIds = [...parsed.data.homePlayingXIPlayerIds, ...parsed.data.awayPlayingXIPlayerIds];
    if (new Set(combinedPlayerIds).size !== 22) {
      return res.status(400).json({ error: "Playing XI cannot contain duplicate players across both teams." });
    }

    const selectedPlayers = await prisma.player.findMany({
      where: {
        id: {
          in: combinedPlayerIds
        }
      }
    });

    if (selectedPlayers.length !== 22) {
      return res.status(400).json({ error: "One or more selected players are invalid." });
    }

    const selectedPlayersById = new Map(selectedPlayers.map((player) => [player.id, player]));
    const invalidHomeXI = parsed.data.homePlayingXIPlayerIds.some(
      (playerId) => selectedPlayersById.get(playerId)?.teamId !== match.homeTeamId
    );
    const invalidAwayXI = parsed.data.awayPlayingXIPlayerIds.some(
      (playerId) => selectedPlayersById.get(playerId)?.teamId !== match.awayTeamId
    );

    if (invalidHomeXI) {
      return res.status(400).json({ error: "Home team Playing XI must only contain home squad players." });
    }

    if (invalidAwayXI) {
      return res.status(400).json({ error: "Away team Playing XI must only contain away squad players." });
    }

    const homeXI = selectedPlayers.filter((player) => player.teamId === match.homeTeamId);
    const awayXI = selectedPlayers.filter((player) => player.teamId === match.awayTeamId);

    if (homeXI.length !== 11) {
      return res.status(400).json({ error: "Home team Playing XI must include 11 players from the home squad." });
    }

    if (awayXI.length !== 11) {
      return res.status(400).json({ error: "Away team Playing XI must include 11 players from the away squad." });
    }

    if (
      parsed.data.homeCaptainPlayerId === parsed.data.homeViceCaptainPlayerId ||
      parsed.data.awayCaptainPlayerId === parsed.data.awayViceCaptainPlayerId
    ) {
      return res.status(400).json({ error: "Captain and vice-captain must be different players." });
    }

    const homeXISet = new Set(parsed.data.homePlayingXIPlayerIds);
    const awayXISet = new Set(parsed.data.awayPlayingXIPlayerIds);

    if (!homeXISet.has(parsed.data.homeCaptainPlayerId) || !homeXISet.has(parsed.data.homeViceCaptainPlayerId)) {
      return res.status(400).json({ error: "Home captain and vice-captain must be selected from home Playing XI." });
    }

    if (!awayXISet.has(parsed.data.awayCaptainPlayerId) || !awayXISet.has(parsed.data.awayViceCaptainPlayerId)) {
      return res.status(400).json({ error: "Away captain and vice-captain must be selected from away Playing XI." });
    }

    const firstInnings = getFirstInningsTeams(match, parsed.data.tossWinnerTeamId, parsed.data.tossDecision);

    await prisma.$transaction(async (tx) => {
      await ensureTeamCareerRow(tx, match.homeTeamId);
      await ensureTeamCareerRow(tx, match.awayTeamId);

      await tx.teamCareerStat.update({
        where: { teamId: match.homeTeamId },
        data: { matchesPlayed: { increment: 1 } }
      });

      await tx.teamCareerStat.update({
        where: { teamId: match.awayTeamId },
        data: { matchesPlayed: { increment: 1 } }
      });

      await tx.matchPlayingXI.deleteMany({
        where: { matchId: match.id }
      });

      const playingXIData = [
        ...parsed.data.homePlayingXIPlayerIds.map((playerId) => ({
          matchId: match.id,
          teamId: match.homeTeamId,
          playerId,
          isCaptain: playerId === parsed.data.homeCaptainPlayerId,
          isViceCaptain: playerId === parsed.data.homeViceCaptainPlayerId
        })),
        ...parsed.data.awayPlayingXIPlayerIds.map((playerId) => ({
          matchId: match.id,
          teamId: match.awayTeamId,
          playerId,
          isCaptain: playerId === parsed.data.awayCaptainPlayerId,
          isViceCaptain: playerId === parsed.data.awayViceCaptainPlayerId
        }))
      ];

      await tx.matchPlayingXI.createMany({
        data: playingXIData
      });

      await tx.playerMatchStat.createMany({
        data: playingXIData.map((entry) => ({
          matchId: match.id,
          teamId: entry.teamId,
          playerId: entry.playerId
        })),
        skipDuplicates: true
      });

      await tx.match.update({
        where: { id: match.id },
        data: {
          status: "LIVE",
          currentInnings: 1,
          startedAt: new Date(),
          tossWinnerTeamId: parsed.data.tossWinnerTeamId,
          tossDecision: parsed.data.tossDecision,
          firstBattingTeamId: firstInnings.battingTeamId,
          firstBowlingTeamId: firstInnings.bowlingTeamId
        }
      });

      await tx.innings.create({
        data: {
          matchId: match.id,
          number: 1,
          battingTeamId: firstInnings.battingTeamId,
          bowlingTeamId: firstInnings.bowlingTeamId
        }
      });
    });

    const summary = await buildMatchSummary(match.id);
    if (summary) {
      io.to(`match:${match.id}`).emit("score:update", summary);
    }

    return res.json({ ok: true, summary });
  })
);

app.get(
  "/matches/:matchId",
  asyncHandler(async (req, res) => {
    const summary = await buildMatchSummary(req.params.matchId);
    if (!summary) {
      return res.status(404).json({ error: "Match not found." });
    }

    const [events, playingXI] = await Promise.all([
      prisma.ballEvent.findMany({
        where: { matchId: req.params.matchId },
        include: {
          striker: true,
          bowler: true
        },
        orderBy: { createdAt: "desc" },
        take: 24
      }),
      prisma.matchPlayingXI.findMany({
        where: { matchId: req.params.matchId },
        include: {
          player: true
        },
        orderBy: {
          player: {
            name: "asc"
          }
        }
      })
    ]);

    const homePlayingXI = playingXI
      .filter((entry) => entry.teamId === summary.homeTeamId)
      .map((entry) => entry.player);
    const awayPlayingXI = playingXI
      .filter((entry) => entry.teamId === summary.awayTeamId)
      .map((entry) => entry.player);
    const homeCaptainPlayerId = playingXI.find((entry) => entry.teamId === summary.homeTeamId && entry.isCaptain)?.playerId ?? null;
    const homeViceCaptainPlayerId =
      playingXI.find((entry) => entry.teamId === summary.homeTeamId && entry.isViceCaptain)?.playerId ?? null;
    const awayCaptainPlayerId = playingXI.find((entry) => entry.teamId === summary.awayTeamId && entry.isCaptain)?.playerId ?? null;
    const awayViceCaptainPlayerId =
      playingXI.find((entry) => entry.teamId === summary.awayTeamId && entry.isViceCaptain)?.playerId ?? null;

    return res.json({
      summary,
      recentEvents: events,
      homePlayingXI,
      awayPlayingXI,
      homeCaptainPlayerId,
      homeViceCaptainPlayerId,
      awayCaptainPlayerId,
      awayViceCaptainPlayerId
    });
  })
);

app.post(
  "/matches/:matchId/events",
  asyncHandler(async (req, res) => {
    const parsed = ballEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    if (parsed.data.strikerId === parsed.data.nonStrikerId) {
      return res.status(400).json({ error: "Striker and non-striker must be different players." });
    }

    if (!parsed.data.isWicket && parsed.data.wicketType !== "NONE") {
      return res.status(400).json({ error: "wicketType must be NONE when isWicket is false." });
    }

    if (parsed.data.isWicket && parsed.data.wicketType === "NONE") {
      return res.status(400).json({ error: "wicketType must be set when isWicket is true." });
    }

    if (parsed.data.isWicket && !parsed.data.dismissedPlayerId) {
      return res.status(400).json({ error: "dismissedPlayerId must be provided for wickets." });
    }

    if (!parsed.data.isWicket && parsed.data.dismissedPlayerId) {
      return res.status(400).json({ error: "dismissedPlayerId is only allowed for wicket events." });
    }

    const requiresFielder = parsed.data.isWicket && ["CAUGHT", "RUN_OUT", "STUMPED"].includes(parsed.data.wicketType);
    if (requiresFielder && !parsed.data.fielderId) {
      return res.status(400).json({ error: "fielderId is required for caught, run-out and stumped wickets." });
    }

    if (!parsed.data.isWicket && parsed.data.fielderId) {
      return res.status(400).json({ error: "fielderId is only allowed for wicket events." });
    }

    if (parsed.data.isWicket && parsed.data.dismissedPlayerId) {
      if (
        parsed.data.wicketType === "RUN_OUT" &&
        parsed.data.dismissedPlayerId !== parsed.data.strikerId &&
        parsed.data.dismissedPlayerId !== parsed.data.nonStrikerId
      ) {
        return res.status(400).json({ error: "For run-out, dismissed player must be striker or non-striker." });
      }

      if (parsed.data.wicketType !== "RUN_OUT" && parsed.data.dismissedPlayerId !== parsed.data.strikerId) {
        return res.status(400).json({ error: "For this wicket type, dismissed player must be the striker." });
      }
    }

    const matchId = req.params.matchId;

    const event = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({ where: { id: matchId } });
      if (!match) {
        throw new ApiError("Match not found.", 404);
      }

      if (match.status !== "LIVE") {
        throw new ApiError("Match is not live.", 400);
      }

      const innings = await tx.innings.findUnique({
        where: {
          matchId_number: {
            matchId,
            number: match.currentInnings
          }
        }
      });

      if (!innings) {
        throw new ApiError("Innings not found for current match state.", 404);
      }

      if (innings.balls >= match.oversLimit * 6) {
        throw new ApiError("Innings overs limit already reached.", 400);
      }

      if (innings.wickets >= 10) {
        throw new ApiError("All wickets have already fallen for this innings.", 400);
      }

      const involvedPlayerIds = new Set([parsed.data.strikerId, parsed.data.nonStrikerId, parsed.data.bowlerId]);
      if (parsed.data.dismissedPlayerId) {
        involvedPlayerIds.add(parsed.data.dismissedPlayerId);
      }
      if (parsed.data.fielderId) {
        involvedPlayerIds.add(parsed.data.fielderId);
      }

      const xiEntries = await tx.matchPlayingXI.findMany({
        where: {
          matchId,
          playerId: {
            in: Array.from(involvedPlayerIds)
          }
        }
      });

      if (xiEntries.length !== involvedPlayerIds.size) {
        throw new ApiError("All involved players must be in the selected Playing XI.", 400);
      }

      const strikerEntry = xiEntries.find((entry) => entry.playerId === parsed.data.strikerId)!;
      const nonStrikerEntry = xiEntries.find((entry) => entry.playerId === parsed.data.nonStrikerId)!;
      const bowlerEntry = xiEntries.find((entry) => entry.playerId === parsed.data.bowlerId)!;
      const dismissedEntry = parsed.data.dismissedPlayerId
        ? xiEntries.find((entry) => entry.playerId === parsed.data.dismissedPlayerId) ?? null
        : null;
      const fielderEntry = parsed.data.fielderId
        ? xiEntries.find((entry) => entry.playerId === parsed.data.fielderId) ?? null
        : null;

      if (strikerEntry.teamId !== innings.battingTeamId || nonStrikerEntry.teamId !== innings.battingTeamId) {
        throw new ApiError("Striker/non-striker must belong to the batting team Playing XI.", 400);
      }

      if (bowlerEntry.teamId !== innings.bowlingTeamId) {
        throw new ApiError("Bowler must belong to the bowling team Playing XI.", 400);
      }

      if (dismissedEntry && dismissedEntry.teamId !== innings.battingTeamId) {
        throw new ApiError("Dismissed player must belong to the batting team Playing XI.", 400);
      }

      if (fielderEntry && fielderEntry.teamId !== innings.bowlingTeamId) {
        throw new ApiError("Fielder must belong to the bowling team Playing XI.", 400);
      }

      await ensurePlayerStatRows(tx, matchId, parsed.data.strikerId, strikerEntry.teamId);
      await ensurePlayerStatRows(tx, matchId, parsed.data.bowlerId, bowlerEntry.teamId);
      if (dismissedEntry) {
        await ensurePlayerStatRows(tx, matchId, dismissedEntry.playerId, dismissedEntry.teamId);
      }
      if (fielderEntry) {
        await ensurePlayerStatRows(tx, matchId, fielderEntry.playerId, fielderEntry.teamId);
      }
      await ensureTeamCareerRow(tx, innings.battingTeamId);
      await ensureTeamCareerRow(tx, innings.bowlingTeamId);

      const legalDelivery = isLegalDelivery(parsed.data.extraType);
      const totalRuns = parsed.data.runsOffBat + parsed.data.extraRuns;
      const bowlerChargedRuns = parsed.data.runsOffBat + (isBowlerCharged(parsed.data.extraType) ? parsed.data.extraRuns : 0);
      const dotBall = legalDelivery && totalRuns === 0;
      const wicketCredit = parsed.data.isWicket && parsed.data.wicketType !== "RUN_OUT";

      const overNumber = Math.floor(innings.balls / 6);
      const ballInOver = (innings.balls % 6) + 1;
      const newRuns = innings.runs + totalRuns;
      const newWickets = innings.wickets + (parsed.data.isWicket ? 1 : 0);
      const newBalls = innings.balls + (legalDelivery ? 1 : 0);

      await tx.innings.update({
        where: { id: innings.id },
        data: {
          runs: { increment: totalRuns },
          wickets: { increment: parsed.data.isWicket ? 1 : 0 },
          balls: { increment: legalDelivery ? 1 : 0 }
        }
      });

      await tx.playerMatchStat.update({
        where: { matchId_playerId: { matchId, playerId: parsed.data.strikerId } },
        data: {
          runsScored: { increment: parsed.data.runsOffBat },
          ballsFaced: { increment: legalDelivery ? 1 : 0 },
          fours: { increment: parsed.data.runsOffBat === 4 ? 1 : 0 },
          sixes: { increment: parsed.data.runsOffBat === 6 ? 1 : 0 }
        }
      });

      await tx.playerCareerStat.update({
        where: { playerId: parsed.data.strikerId },
        data: {
          runsScored: { increment: parsed.data.runsOffBat },
          ballsFaced: { increment: legalDelivery ? 1 : 0 },
          fours: { increment: parsed.data.runsOffBat === 4 ? 1 : 0 },
          sixes: { increment: parsed.data.runsOffBat === 6 ? 1 : 0 }
        }
      });

      if (parsed.data.isWicket && parsed.data.dismissedPlayerId) {
        await tx.playerMatchStat.update({
          where: { matchId_playerId: { matchId, playerId: parsed.data.dismissedPlayerId } },
          data: {
            dismissals: { increment: 1 }
          }
        });

        await tx.playerCareerStat.update({
          where: { playerId: parsed.data.dismissedPlayerId },
          data: {
            dismissals: { increment: 1 }
          }
        });
      }

      await tx.playerMatchStat.update({
        where: { matchId_playerId: { matchId, playerId: parsed.data.bowlerId } },
        data: {
          wicketsTaken: { increment: wicketCredit ? 1 : 0 },
          ballsBowled: { increment: legalDelivery ? 1 : 0 },
          runsConceded: { increment: bowlerChargedRuns },
          dotBalls: { increment: dotBall ? 1 : 0 }
        }
      });

      if (parsed.data.isWicket && parsed.data.fielderId) {
        const fieldingUpdate: Prisma.PlayerMatchStatUpdateInput = {};

        if (parsed.data.wicketType === "CAUGHT") {
          fieldingUpdate.catches = { increment: 1 };
        } else if (parsed.data.wicketType === "STUMPED") {
          fieldingUpdate.stumpings = { increment: 1 };
        } else if (parsed.data.wicketType === "RUN_OUT") {
          fieldingUpdate.runOuts = { increment: 1 };
        }

        if (Object.keys(fieldingUpdate).length > 0) {
          await tx.playerMatchStat.update({
            where: { matchId_playerId: { matchId, playerId: parsed.data.fielderId } },
            data: fieldingUpdate
          });

          await tx.playerCareerStat.update({
            where: { playerId: parsed.data.fielderId },
            data: fieldingUpdate
          });
        }
      }

      await tx.playerCareerStat.update({
        where: { playerId: parsed.data.bowlerId },
        data: {
          wicketsTaken: { increment: wicketCredit ? 1 : 0 },
          ballsBowled: { increment: legalDelivery ? 1 : 0 },
          runsConceded: { increment: bowlerChargedRuns },
          dotBalls: { increment: dotBall ? 1 : 0 }
        }
      });

      await tx.teamCareerStat.update({
        where: { teamId: innings.battingTeamId },
        data: {
          totalRunsScored: { increment: totalRuns },
          totalWicketsLost: { increment: parsed.data.isWicket ? 1 : 0 }
        }
      });

      await tx.teamCareerStat.update({
        where: { teamId: innings.bowlingTeamId },
        data: {
          totalRunsConceded: { increment: totalRuns },
          totalWicketsTaken: { increment: parsed.data.isWicket ? 1 : 0 }
        }
      });

      const createdEvent = await tx.ballEvent.create({
        data: {
          matchId,
          inningsId: innings.id,
          overNumber,
          ballInOver,
          strikerId: parsed.data.strikerId,
          nonStrikerId: parsed.data.nonStrikerId,
          bowlerId: parsed.data.bowlerId,
          dismissedPlayerId: parsed.data.dismissedPlayerId,
          fielderId: parsed.data.fielderId,
          runsOffBat: parsed.data.runsOffBat,
          extraType: parsed.data.extraType,
          extraRuns: parsed.data.extraRuns,
          isWicket: parsed.data.isWicket,
          wicketType: parsed.data.wicketType,
          commentary: parsed.data.commentary
        }
      });

      const inningsCompleted = newBalls >= match.oversLimit * 6 || newWickets >= 10;

      if (match.currentInnings === 1 && inningsCompleted) {
        const secondInnings = await tx.innings.findUnique({
          where: {
            matchId_number: {
              matchId,
              number: 2
            }
          }
        });

        if (!secondInnings) {
          await tx.innings.create({
            data: {
              matchId,
              number: 2,
              battingTeamId: innings.bowlingTeamId,
              bowlingTeamId: innings.battingTeamId
            }
          });
        }

        await tx.match.update({
          where: { id: matchId },
          data: { currentInnings: 2 }
        });
      }

      if (match.currentInnings === 2) {
        const firstInnings = await tx.innings.findUnique({
          where: {
            matchId_number: {
              matchId,
              number: 1
            }
          }
        });

        if (!firstInnings) {
          throw new ApiError("First innings data missing.", 400);
        }

        const chaseCompleted = newRuns > firstInnings.runs;
        if (chaseCompleted || inningsCompleted) {
          let winnerTeamId: string | null = null;
          if (newRuns > firstInnings.runs) {
            winnerTeamId = innings.battingTeamId;
          } else if (newRuns < firstInnings.runs) {
            winnerTeamId = innings.bowlingTeamId;
          }

          await tx.match.update({
            where: { id: matchId },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
              winnerTeamId
            }
          });

          if (winnerTeamId) {
            const loserTeamId = winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
            await ensureTeamCareerRow(tx, winnerTeamId);
            await ensureTeamCareerRow(tx, loserTeamId);

            await tx.teamCareerStat.update({
              where: { teamId: winnerTeamId },
              data: { wins: { increment: 1 } }
            });

            await tx.teamCareerStat.update({
              where: { teamId: loserTeamId },
              data: { losses: { increment: 1 } }
            });
          }
        }
      }

      return createdEvent;
    });

    const summary = await buildMatchSummary(matchId);
    if (summary) {
      io.to(`match:${matchId}`).emit("score:update", summary);
    }

    return res.status(201).json({ event, summary });
  })
);

app.post(
  "/matches/:matchId/next-innings",
  asyncHandler(async (req, res) => {
    const match = await prisma.match.findUnique({
      where: { id: req.params.matchId },
      include: { innings: true }
    });

    if (!match) {
      return res.status(404).json({ error: "Match not found." });
    }

    if (match.status !== "LIVE") {
      return res.status(400).json({ error: "Only live matches can start next innings." });
    }

    if (match.currentInnings >= 2) {
      return res.status(400).json({ error: "This starter currently supports up to 2 innings." });
    }

    const currentInnings = match.innings.find((innings) => innings.number === match.currentInnings);
    if (!currentInnings) {
      return res.status(404).json({ error: "Current innings record missing." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.innings.create({
        data: {
          matchId: match.id,
          number: match.currentInnings + 1,
          battingTeamId: currentInnings.bowlingTeamId,
          bowlingTeamId: currentInnings.battingTeamId
        }
      });

      await tx.match.update({
        where: { id: match.id },
        data: { currentInnings: { increment: 1 } }
      });
    });

    const summary = await buildMatchSummary(match.id);
    if (summary) {
      io.to(`match:${match.id}`).emit("score:update", summary);
    }

    return res.json({ ok: true, summary });
  })
);

app.post(
  "/matches/:matchId/complete",
  asyncHandler(async (req, res) => {
    const parsed = completeMatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const match = await prisma.match.findUnique({ where: { id: req.params.matchId } });
    if (!match) {
      return res.status(404).json({ error: "Match not found." });
    }

    if (match.status !== "LIVE") {
      return res.status(400).json({ error: "Only live matches can be completed." });
    }

    if (
      parsed.data.winnerTeamId &&
      parsed.data.winnerTeamId !== match.homeTeamId &&
      parsed.data.winnerTeamId !== match.awayTeamId
    ) {
      return res.status(400).json({ error: "winnerTeamId must belong to this match." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: match.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          winnerTeamId: parsed.data.winnerTeamId
        }
      });

      if (parsed.data.winnerTeamId) {
        const loserTeamId = parsed.data.winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;

        await ensureTeamCareerRow(tx, parsed.data.winnerTeamId);
        await ensureTeamCareerRow(tx, loserTeamId);

        await tx.teamCareerStat.update({
          where: { teamId: parsed.data.winnerTeamId },
          data: { wins: { increment: 1 } }
        });

        await tx.teamCareerStat.update({
          where: { teamId: loserTeamId },
          data: { losses: { increment: 1 } }
        });
      }
    });

    const summary = await buildMatchSummary(match.id);
    if (summary) {
      io.to(`match:${match.id}`).emit("score:update", summary);
    }

    res.json({ ok: true, summary });
  })
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return res.status(400).json({ error: "Database error.", code: error.code });
  }

  // eslint-disable-next-line no-console
  console.error(error);
  return res.status(500).json({ error: "Internal server error." });
});

const port = Number(process.env.PORT ?? 4000);
httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API running on http://localhost:${port}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
