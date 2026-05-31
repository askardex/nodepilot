-- CreateTable
CREATE TABLE "SpliceInstallation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "validatorId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "installPath" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpliceInstallation_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "Validator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SpliceInstallation_validatorId_idx" ON "SpliceInstallation"("validatorId");

-- CreateIndex
CREATE UNIQUE INDEX "SpliceInstallation_validatorId_version_key" ON "SpliceInstallation"("validatorId", "version");
