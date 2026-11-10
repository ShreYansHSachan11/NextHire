-- Jobs imported from public job boards (Arbeitnow, Remote OK, Adzuna).
-- Additive and nullable: existing rows and existing queries are unaffected.

-- A company that exists only because its jobs were imported. It has no users.
ALTER TABLE "Company" ADD COLUMN "isExternal" BOOLEAN NOT NULL DEFAULT false;

-- Where an imported job came from, its id there, the original posting, and
-- when the importer last saw it.
ALTER TABLE "Job" ADD COLUMN "source" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "sourceUrl" TEXT,
ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Job_source_externalId_key" ON "Job"("source", "externalId");
CREATE INDEX "Job_source_lastSeenAt_idx" ON "Job"("source", "lastSeenAt");
