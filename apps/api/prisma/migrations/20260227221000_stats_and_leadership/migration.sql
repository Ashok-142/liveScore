-- AlterTable
ALTER TABLE "MatchPlayingXI"
ADD COLUMN "isCaptain" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isViceCaptain" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BallEvent"
ADD COLUMN "dismissedPlayerId" TEXT,
ADD COLUMN "fielderId" TEXT;

-- AlterTable
ALTER TABLE "PlayerMatchStat"
ADD COLUMN "dismissals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "catches" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "stumpings" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "runOuts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PlayerCareerStat"
ADD COLUMN "dismissals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "catches" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "stumpings" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "runOuts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "BallEvent_dismissedPlayerId_idx" ON "BallEvent"("dismissedPlayerId");

-- CreateIndex
CREATE INDEX "BallEvent_fielderId_idx" ON "BallEvent"("fielderId");

-- AddForeignKey
ALTER TABLE "BallEvent" ADD CONSTRAINT "BallEvent_dismissedPlayerId_fkey" FOREIGN KEY ("dismissedPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallEvent" ADD CONSTRAINT "BallEvent_fielderId_fkey" FOREIGN KEY ("fielderId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
