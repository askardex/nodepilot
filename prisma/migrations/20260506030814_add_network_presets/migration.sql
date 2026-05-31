-- CreateTable
CREATE TABLE "NetworkPreset" (
    "network" TEXT NOT NULL PRIMARY KEY,
    "sponsorSvUrl" TEXT NOT NULL DEFAULT '',
    "scanUrl" TEXT NOT NULL DEFAULT '',
    "sequencerUrl" TEXT NOT NULL DEFAULT '',
    "migrationId" INTEGER,
    "updatedAt" DATETIME NOT NULL
);
