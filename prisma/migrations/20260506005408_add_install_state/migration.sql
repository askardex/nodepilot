/*
  Warnings:

  - You are about to drop the column `authToken` on the `Validator` table. All the data in the column will be lost.
  - You are about to drop the column `port` on the `Validator` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "SvScanNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "version" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Validator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUsername" TEXT NOT NULL DEFAULT 'root',
    "sshAuthType" TEXT NOT NULL DEFAULT 'password',
    "sshPassword" TEXT,
    "sshPrivateKey" TEXT,
    "network" TEXT NOT NULL DEFAULT 'DevNet',
    "validatorPort" INTEGER NOT NULL DEFAULT 5003,
    "version" TEXT,
    "partyId" TEXT,
    "synchronizerId" TEXT,
    "hostname" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Offline',
    "uptime" TEXT,
    "lastSyncAt" DATETIME,
    "lastHealthCheck" DATETIME,
    "installState" TEXT NOT NULL DEFAULT 'NotInstalled',
    "spliceVersion" TEXT,
    "installPath" TEXT,
    "installLog" TEXT,
    "installedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Validator" ("createdAt", "host", "id", "lastHealthCheck", "lastSyncAt", "name", "network", "partyId", "status", "synchronizerId", "updatedAt", "uptime", "version") SELECT "createdAt", "host", "id", "lastHealthCheck", "lastSyncAt", "name", "network", "partyId", "status", "synchronizerId", "updatedAt", "uptime", "version" FROM "Validator";
DROP TABLE "Validator";
ALTER TABLE "new_Validator" RENAME TO "Validator";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
