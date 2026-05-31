-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ValidatorConfig" (
    "validatorId" TEXT NOT NULL PRIMARY KEY,
    "migrationId" INTEGER,
    "sponsorSvUrl" TEXT,
    "scanUrl" TEXT,
    "sequencerUrl" TEXT,
    "onboardingSecret" TEXT,
    "partyHint" TEXT,
    "disableBft" BOOLEAN NOT NULL DEFAULT true,
    "authEnabled" BOOLEAN NOT NULL DEFAULT false,
    "authUrl" TEXT,
    "authJwksUrl" TEXT,
    "authWellknownUrl" TEXT,
    "ledgerApiAudience" TEXT,
    "ledgerApiScope" TEXT,
    "ledgerApiAdminUser" TEXT,
    "validatorAudience" TEXT,
    "validatorClientId" TEXT,
    "validatorClientSecret" TEXT,
    "walletAdminUser" TEXT,
    "walletUiClientId" TEXT,
    "ansUiClientId" TEXT,
    "contactPoint" TEXT,
    "proxyHost" TEXT,
    "proxyPort" INTEGER,
    "trafficThroughput" INTEGER,
    "trafficTopupInterval" TEXT,
    "configuredAt" DATETIME,
    "firstStartedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ValidatorConfig_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "Validator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ValidatorConfig" ("ansUiClientId", "authEnabled", "authJwksUrl", "authUrl", "authWellknownUrl", "configuredAt", "contactPoint", "createdAt", "firstStartedAt", "ledgerApiAdminUser", "ledgerApiAudience", "ledgerApiScope", "migrationId", "onboardingSecret", "partyHint", "proxyHost", "proxyPort", "sponsorSvUrl", "trafficThroughput", "trafficTopupInterval", "updatedAt", "validatorAudience", "validatorClientId", "validatorClientSecret", "validatorId", "walletAdminUser", "walletUiClientId") SELECT "ansUiClientId", "authEnabled", "authJwksUrl", "authUrl", "authWellknownUrl", "configuredAt", "contactPoint", "createdAt", "firstStartedAt", "ledgerApiAdminUser", "ledgerApiAudience", "ledgerApiScope", "migrationId", "onboardingSecret", "partyHint", "proxyHost", "proxyPort", "sponsorSvUrl", "trafficThroughput", "trafficTopupInterval", "updatedAt", "validatorAudience", "validatorClientId", "validatorClientSecret", "validatorId", "walletAdminUser", "walletUiClientId" FROM "ValidatorConfig";
DROP TABLE "ValidatorConfig";
ALTER TABLE "new_ValidatorConfig" RENAME TO "ValidatorConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
