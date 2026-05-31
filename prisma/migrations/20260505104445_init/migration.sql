-- CreateTable
CREATE TABLE "Validator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 5003,
    "network" TEXT NOT NULL DEFAULT 'DevNet',
    "version" TEXT,
    "partyId" TEXT,
    "synchronizerId" TEXT,
    "authToken" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Offline',
    "uptime" TEXT,
    "lastSyncAt" DATETIME,
    "lastHealthCheck" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
