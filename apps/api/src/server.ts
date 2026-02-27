import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Prisma, PrismaClient } from "@prisma/client";
import { Server } from "socket.io";
import { EXTRA_TYPES, WICKET_TYPES, type BallEventInput, type MatchSummaryDTO } from "@culbcric/shared";
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

const ballEventSchema: z.ZodType<BallEventInput> = z.object({
  strikerId: z.string().min(1),
  nonStrikerId: z.string().min(1),
  bowlerId: z.string().min(1),
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

function toOverDisplay(balls: number): string {
  const overs = Math.floor(balls / 6);
  const ball = balls % 6;
  return `${overs}.${ball}`;
}

function isLegalDelivery(extraType: Prisma.ExtraType): boolean {
  return extraType !== "WIDE" && extraType !== "NO_BALL";
}

function isBowlerCharged(extraType: Prisma.ExtraType): boolean {
  return extraType === "WIDE" || extraType === "NO_BALL";
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

app.get(
  "/teams",
  asyncHandler(async (_req, res) => {
    const teams = await prisma.team.findMany({
      include: {
        players: {
          include: {
            careerStat: true
          }
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
        teamCareerStat: {
          create: {}
        }
      },
      include: {
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
    const parsed = createPlayerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const team = await prisma.team.findUnique({ where: { id: req.params.teamId } });
    if (!team) {
      return res.status(404).json({ error: "Team not found." });
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
        awayTeam: true
      },
      orderBy: { startedAt: "desc" }
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

    const match = await prisma.$transaction(async (tx) => {
      await ensureTeamCareerRow(tx, homeTeam.id);
      await ensureTeamCareerRow(tx, awayTeam.id);

      await tx.teamCareerStat.update({
        where: { teamId: homeTeam.id },
        data: { matchesPlayed: { increment: 1 } }
      });

      await tx.teamCareerStat.update({
        where: { teamId: awayTeam.id },
        data: { matchesPlayed: { increment: 1 } }
      });

      return tx.match.create({
        data: {
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          status: "LIVE",
          currentInnings: 1,
          oversLimit: parsed.data.oversLimit,
          startedAt: new Date(),
          innings: {
            create: {
              number: 1,
              battingTeamId: homeTeam.id,
              bowlingTeamId: awayTeam.id
            }
          }
        },
        include: {
          innings: true,
          homeTeam: true,
          awayTeam: true
        }
      });
    });

    io.emit("match:created", match);

    return res.status(201).json(match);
  })
);

app.get(
  "/matches/:matchId",
  asyncHandler(async (req, res) => {
    const summary = await buildMatchSummary(req.params.matchId);
    if (!summary) {
      return res.status(404).json({ error: "Match not found." });
    }

    const events = await prisma.ballEvent.findMany({
      where: { matchId: req.params.matchId },
      include: {
        striker: true,
        bowler: true
      },
      orderBy: { createdAt: "desc" },
      take: 24
    });

    return res.json({ summary, recentEvents: events });
  })
);

app.post(
  "/matches/:matchId/events",
  asyncHandler(async (req, res) => {
    const parsed = ballEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    if (!parsed.data.isWicket && parsed.data.wicketType !== "NONE") {
      return res.status(400).json({ error: "wicketType must be NONE when isWicket is false." });
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

      const players = await tx.player.findMany({
        where: {
          id: {
            in: [parsed.data.strikerId, parsed.data.nonStrikerId, parsed.data.bowlerId]
          }
        }
      });

      if (players.length !== 3) {
        throw new ApiError("One or more players are invalid.", 404);
      }

      const striker = players.find((player) => player.id === parsed.data.strikerId)!;
      const nonStriker = players.find((player) => player.id === parsed.data.nonStrikerId)!;
      const bowler = players.find((player) => player.id === parsed.data.bowlerId)!;

      if (striker.teamId !== innings.battingTeamId || nonStriker.teamId !== innings.battingTeamId) {
        throw new ApiError("Striker/non-striker must belong to the batting team.", 400);
      }

      if (bowler.teamId !== innings.bowlingTeamId) {
        throw new ApiError("Bowler must belong to the bowling team.", 400);
      }

      await ensurePlayerStatRows(tx, matchId, striker.id, striker.teamId);
      await ensurePlayerStatRows(tx, matchId, bowler.id, bowler.teamId);
      await ensureTeamCareerRow(tx, innings.battingTeamId);
      await ensureTeamCareerRow(tx, innings.bowlingTeamId);

      const legalDelivery = isLegalDelivery(parsed.data.extraType as Prisma.ExtraType);
      const totalRuns = parsed.data.runsOffBat + parsed.data.extraRuns;
      const bowlerChargedRuns =
        parsed.data.runsOffBat + (isBowlerCharged(parsed.data.extraType as Prisma.ExtraType) ? parsed.data.extraRuns : 0);
      const dotBall = legalDelivery && totalRuns === 0;
      const wicketCredit = parsed.data.isWicket && parsed.data.wicketType !== "RUN_OUT";

      const overNumber = Math.floor(innings.balls / 6);
      const ballInOver = (innings.balls % 6) + 1;

      await tx.innings.update({
        where: { id: innings.id },
        data: {
          runs: { increment: totalRuns },
          wickets: { increment: parsed.data.isWicket ? 1 : 0 },
          balls: { increment: legalDelivery ? 1 : 0 }
        }
      });

      await tx.playerMatchStat.update({
        where: { matchId_playerId: { matchId, playerId: striker.id } },
        data: {
          runsScored: { increment: parsed.data.runsOffBat },
          ballsFaced: { increment: legalDelivery ? 1 : 0 },
          fours: { increment: parsed.data.runsOffBat === 4 ? 1 : 0 },
          sixes: { increment: parsed.data.runsOffBat === 6 ? 1 : 0 }
        }
      });

      await tx.playerCareerStat.update({
        where: { playerId: striker.id },
        data: {
          runsScored: { increment: parsed.data.runsOffBat },
          ballsFaced: { increment: legalDelivery ? 1 : 0 },
          fours: { increment: parsed.data.runsOffBat === 4 ? 1 : 0 },
          sixes: { increment: parsed.data.runsOffBat === 6 ? 1 : 0 }
        }
      });

      await tx.playerMatchStat.update({
        where: { matchId_playerId: { matchId, playerId: bowler.id } },
        data: {
          wicketsTaken: { increment: wicketCredit ? 1 : 0 },
          ballsBowled: { increment: legalDelivery ? 1 : 0 },
          runsConceded: { increment: bowlerChargedRuns },
          dotBalls: { increment: dotBall ? 1 : 0 }
        }
      });

      await tx.playerCareerStat.update({
        where: { playerId: bowler.id },
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

      return tx.ballEvent.create({
        data: {
          matchId,
          inningsId: innings.id,
          overNumber,
          ballInOver,
          strikerId: striker.id,
          nonStrikerId: nonStriker.id,
          bowlerId: bowler.id,
          runsOffBat: parsed.data.runsOffBat,
          extraType: parsed.data.extraType as Prisma.ExtraType,
          extraRuns: parsed.data.extraRuns,
          isWicket: parsed.data.isWicket,
          wicketType: parsed.data.wicketType as Prisma.WicketType,
          commentary: parsed.data.commentary
        }
      });
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

    if (match.status === "COMPLETED") {
      return res.status(400).json({ error: "Match already completed." });
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
