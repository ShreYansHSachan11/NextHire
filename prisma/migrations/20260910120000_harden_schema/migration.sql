-- Harden the schema: cascade deletes, uniqueness guarantees, lookup indexes and
-- the new columns backing structured notifications and reliable resume replacement.

-- 1. New columns -------------------------------------------------------------
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "link" TEXT;
ALTER TABLE "Message"      ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);
ALTER TABLE "Resume"       ADD COLUMN IF NOT EXISTS "publicId" TEXT;
ALTER TABLE "Resume"       ADD COLUMN IF NOT EXISTS "fileName" TEXT;

-- 2. De-duplicate before adding unique constraints ---------------------------
-- Keep the earliest application per (userId, jobId).
DELETE FROM "Application" a
USING "Application" b
WHERE a."userId" = b."userId"
  AND a."jobId"  = b."jobId"
  AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

-- Move messages off duplicate conversations onto the surviving one, then drop them.
WITH ranked AS (
  SELECT "id",
         FIRST_VALUE("id") OVER (
           PARTITION BY "userId", "companyId"
           ORDER BY "createdAt", "id"
         ) AS keep_id
  FROM "Conversation"
)
UPDATE "Message" m
SET "conversationId" = r.keep_id
FROM ranked r
WHERE m."conversationId" = r."id" AND r."id" <> r.keep_id;

DELETE FROM "Conversation" c
USING "Conversation" d
WHERE c."userId" = d."userId"
  AND c."companyId" = d."companyId"
  AND (c."createdAt" > d."createdAt" OR (c."createdAt" = d."createdAt" AND c."id" > d."id"));

-- 3. Unique constraints ------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "Application_userId_jobId_key"      ON "Application"("userId", "jobId");
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_userId_companyId_key" ON "Conversation"("userId", "companyId");

-- 4. Lookup indexes ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS "User_companyId_idx"                 ON "User"("companyId");
CREATE INDEX IF NOT EXISTS "Job_companyId_idx"                  ON "Job"("companyId");
CREATE INDEX IF NOT EXISTS "Job_isActive_createdAt_idx"         ON "Job"("isActive", "createdAt");
CREATE INDEX IF NOT EXISTS "Application_jobId_idx"              ON "Application"("jobId");
CREATE INDEX IF NOT EXISTS "Application_userId_createdAt_idx"   ON "Application"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Conversation_companyId_idx"         ON "Conversation"("companyId");
CREATE INDEX IF NOT EXISTS "Conversation_userId_idx"            ON "Conversation"("userId");
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");
CREATE INDEX IF NOT EXISTS "Resume_userId_createdAt_idx"        ON "Resume"("userId", "createdAt");

-- 5. Cascade deletes ---------------------------------------------------------
-- Deleting a job previously failed with a foreign-key error whenever it had
-- applications; deleting a user or conversation had the same problem.
ALTER TABLE "Job"          DROP CONSTRAINT IF EXISTS "Job_companyId_fkey";
ALTER TABLE "Job"          ADD  CONSTRAINT "Job_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Application"  DROP CONSTRAINT IF EXISTS "Application_jobId_fkey";
ALTER TABLE "Application"  ADD  CONSTRAINT "Application_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Application"  DROP CONSTRAINT IF EXISTS "Application_userId_fkey";
ALTER TABLE "Application"  ADD  CONSTRAINT "Application_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_companyId_fkey";
ALTER TABLE "Conversation" ADD  CONSTRAINT "Conversation_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_userId_fkey";
ALTER TABLE "Conversation" ADD  CONSTRAINT "Conversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message"      DROP CONSTRAINT IF EXISTS "Message_conversationId_fkey";
ALTER TABLE "Message"      ADD  CONSTRAINT "Message_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message"      DROP CONSTRAINT IF EXISTS "Message_senderId_fkey";
ALTER TABLE "Message"      ADD  CONSTRAINT "Message_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_userId_fkey";
ALTER TABLE "Notification" ADD  CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Resume"       DROP CONSTRAINT IF EXISTS "Resume_userId_fkey";
ALTER TABLE "Resume"       ADD  CONSTRAINT "Resume_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
