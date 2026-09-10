-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('OFF', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('TEXT', 'BOOLEAN', 'SINGLE_CHOICE', 'NUMBER');

-- CreateTable
CREATE TABLE "SkillVector" (
    "tag" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillVector_pkey" PRIMARY KEY ("tag")
);

-- CreateTable
CREATE TABLE "QueryVector" (
    "queryHash" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueryVector_pkey" PRIMARY KEY ("queryHash")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "filters" JSONB,
    "frequency" "AlertFrequency" NOT NULL DEFAULT 'DAILY',
    "lastNotifiedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchExplanation" (
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchExplanation_pkey" PRIMARY KEY ("userId","jobId")
);

-- CreateTable
CREATE TABLE "JobQuestion" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "kind" "QuestionKind" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT true,
    "knockout" BOOLEAN NOT NULL DEFAULT false,
    "expected" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAnswer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueryVector_updatedAt_idx" ON "QueryVector"("updatedAt");

-- CreateIndex
CREATE INDEX "SavedSearch_userId_idx" ON "SavedSearch"("userId");

-- CreateIndex
CREATE INDEX "SavedSearch_frequency_lastRunAt_idx" ON "SavedSearch"("frequency", "lastRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_userId_name_key" ON "SavedSearch"("userId", "name");

-- CreateIndex
CREATE INDEX "MatchExplanation_contentHash_idx" ON "MatchExplanation"("contentHash");

-- CreateIndex
CREATE INDEX "JobQuestion_jobId_position_idx" ON "JobQuestion"("jobId", "position");

-- CreateIndex
CREATE INDEX "ApplicationAnswer_applicationId_idx" ON "ApplicationAnswer"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationAnswer_applicationId_questionId_key" ON "ApplicationAnswer"("applicationId", "questionId");

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchExplanation" ADD CONSTRAINT "MatchExplanation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchExplanation" ADD CONSTRAINT "MatchExplanation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobQuestion" ADD CONSTRAINT "JobQuestion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "JobQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lexical half of hybrid retrieval.
--
-- Vector search is weak on rare literal tokens: a company name, "K8s", "SRE",
-- a specific framework version. Those are exactly the queries where the user
-- already knows what they want, so retrieval fuses a full-text ranking with the
-- vector ranking (see `lib/ai/search.ts`).
--
-- An expression index rather than a stored tsvector column: Prisma has no
-- native tsvector type, and keeping the expression here means the schema stays
-- fully describable by `schema.prisma`.
--
-- `skills` is deliberately absent: `array_to_string` is STABLE rather than
-- IMMUTABLE and Postgres refuses it in an index expression. Skills already
-- carry weight through the embedding and through the skills facet, so the
-- lexical half loses very little by indexing prose only.
CREATE INDEX IF NOT EXISTS "Job_fulltext_idx"
  ON "Job"
  USING GIN (
    to_tsvector(
      'english',
      coalesce("title", '') || ' ' ||
      coalesce("location", '') || ' ' ||
      coalesce("type", '') || ' ' ||
      coalesce("description", '')
    )
  );

-- Trigram index for fuzzy literal matching (typos, partial company names).
-- Created only if the extension is available; a managed tier that refuses
-- pg_trgm still gets working full-text search from the index above.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "Job_title_trgm_idx" ON "Job" USING GIN ("title" gin_trgm_ops);
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm unavailable; skipping trigram index';
END $$;
