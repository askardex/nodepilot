-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "emailVerified" DATETIME,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SslCertificate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "domains" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "certPem" TEXT NOT NULL,
    "keyPem" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "issuedAt" DATETIME,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SslCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SslCertificate" ("certPem", "createdAt", "domains", "expiresAt", "id", "issuedAt", "keyPem", "label", "source", "updatedAt") SELECT "certPem", "createdAt", "domains", "expiresAt", "id", "issuedAt", "keyPem", "label", "source", "updatedAt" FROM "SslCertificate";
DROP TABLE "SslCertificate";
ALTER TABLE "new_SslCertificate" RENAME TO "SslCertificate";
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
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Validator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Validator" ("createdAt", "host", "hostname", "id", "installError", "installLog", "installPath", "installState", "installedAt", "lastHealthCheck", "lastStartError", "lastStartLog", "lastStartedAt", "lastStoppedAt", "lastSyncAt", "name", "network", "partyId", "runState", "spliceVersion", "sshAuthType", "sshPassword", "sshPort", "sshPrivateKey", "sshUsername", "status", "synchronizerId", "updatedAt", "uptime", "validatorPort", "version") SELECT "createdAt", "host", "hostname", "id", "installError", "installLog", "installPath", "installState", "installedAt", "lastHealthCheck", "lastStartError", "lastStartLog", "lastStartedAt", "lastStoppedAt", "lastSyncAt", "name", "network", "partyId", "runState", "spliceVersion", "sshAuthType", "sshPassword", "sshPort", "sshPrivateKey", "sshUsername", "status", "synchronizerId", "updatedAt", "uptime", "validatorPort", "version" FROM "Validator";
DROP TABLE "Validator";
ALTER TABLE "new_Validator" RENAME TO "Validator";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");
