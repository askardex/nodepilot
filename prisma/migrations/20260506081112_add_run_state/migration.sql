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
    "installError" TEXT,
    "installedAt" DATETIME,
    "runState" TEXT NOT NULL DEFAULT 'Stopped',
    "lastStartedAt" DATETIME,
    "lastStoppedAt" DATETIME,
    "lastStartError" TEXT,
    "lastStartLog" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Validator" ("createdAt", "host", "hostname", "id", "installError", "installLog", "installPath", "installState", "installedAt", "lastHealthCheck", "lastSyncAt", "name", "network", "partyId", "spliceVersion", "sshAuthType", "sshPassword", "sshPort", "sshPrivateKey", "sshUsername", "status", "synchronizerId", "updatedAt", "uptime", "validatorPort", "version") SELECT "createdAt", "host", "hostname", "id", "installError", "installLog", "installPath", "installState", "installedAt", "lastHealthCheck", "lastSyncAt", "name", "network", "partyId", "spliceVersion", "sshAuthType", "sshPassword", "sshPort", "sshPrivateKey", "sshUsername", "status", "synchronizerId", "updatedAt", "uptime", "validatorPort", "version" FROM "Validator";
DROP TABLE "Validator";
ALTER TABLE "new_Validator" RENAME TO "Validator";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
