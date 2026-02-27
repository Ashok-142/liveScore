-- CreateEnum
CREATE TYPE "TossDecision" AS ENUM ('BAT', 'BOWL');

-- AlterTable
ALTER TABLE "Match"
ADD COLUMN "tossWinnerTeamId" TEXT,
ADD COLUMN "tossDecision" "TossDecision",
ADD COLUMN "firstBattingTeamId" TEXT,
ADD COLUMN "firstBowlingTeamId" TEXT;

-- CreateTable
CREATE TABLE "MatchPlayingXI" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchPlayingXI_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayingXI_matchId_playerId_key" ON "MatchPlayingXI"("matchId", "playerId");

-- CreateIndex
CREATE INDEX "MatchPlayingXI_matchId_teamId_idx" ON "MatchPlayingXI"("matchId", "teamId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_tossWinnerTeamId_fkey" FOREIGN KEY ("tossWinnerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_firstBattingTeamId_fkey" FOREIGN KEY ("firstBattingTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_firstBowlingTeamId_fkey" FOREIGN KEY ("firstBowlingTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayingXI" ADD CONSTRAINT "MatchPlayingXI_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayingXI" ADD CONSTRAINT "MatchPlayingXI_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayingXI" ADD CONSTRAINT "MatchPlayingXI_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
