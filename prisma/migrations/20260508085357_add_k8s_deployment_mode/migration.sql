-- CreateTable
CREATE TABLE "K8sConfig" (
    "validatorId" TEXT NOT NULL PRIMARY KEY,
    "kubeconfig" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT 'default',
    "namespace" TEXT NOT NULL DEFAULT 'validator',
    "chartVersion" TEXT,
    "clusterType" TEXT NOT NULL DEFAULT 'k3s',
    "region" TEXT,
    "ingressHostname" TEXT,
    "kmsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "kmsProvider" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "K8sConfig_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "Validator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "installError" TEXT,
    "installedAt" DATETIME,
    "deploymentMode" TEXT NOT NULL DEFAULT 'compose',
    "runState" TEXT NOT NULL DEFAULT 'Stopped',
    "lastStartedAt" DATETIME,
    "lastStoppedAt" DATETIME,
    "lastStartError" TEXT,
    "lastStartLog" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Validator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Validator" ("createdAt", "host", "hostname", "id", "installError", "installLog", "installPath", "installState", "installedAt", "lastHealthCheck", "lastStartError", "lastStartLog", "lastStartedAt", "lastStoppedAt", "lastSyncAt", "name", "network", "partyId", "runState", "spliceVersion", "sshAuthType", "sshPassword", "sshPort", "sshPrivateKey", "sshUsername", "status", "synchronizerId", "updatedAt", "uptime", "userId", "validatorPort", "version") SELECT "createdAt", "host", "hostname", "id", "installError", "installLog", "installPath", "installState", "installedAt", "lastHealthCheck", "lastStartError", "lastStartLog", "lastStartedAt", "lastStoppedAt", "lastSyncAt", "name", "network", "partyId", "runState", "spliceVersion", "sshAuthType", "sshPassword", "sshPort", "sshPrivateKey", "sshUsername", "status", "synchronizerId", "updatedAt", "uptime", "userId", "validatorPort", "version" FROM "Validator";
DROP TABLE "Validator";
ALTER TABLE "new_Validator" RENAME TO "Validator";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
