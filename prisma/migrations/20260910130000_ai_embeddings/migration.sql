-- Gemini-powered matching: vector indexes for jobs and seeker profiles, plus
-- the AI-derived profile fields those vectors are built from.

-- 1. AI-derived profile fields on User ---------------------------------------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "headline"    TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "skills"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "seniority"   TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "yearsOfExp"  INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "aiSummary"   TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "aiUpdatedAt" TIMESTAMP(3);

-- 2. Parsed skills on Job -----------------------------------------------------
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 3. Match score captured at the moment of applying ---------------------------
ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "matchScore" INTEGER;

-- 4. Vector tables ------------------------------------------------------------
-- Vectors are plain double-precision arrays rather than a pgvector column, so
-- the app runs on any managed Postgres. Similarity is computed in Node; see the
-- pgvector upgrade note in README if the corpus outgrows that.
CREATE TABLE IF NOT EXISTS "JobEmbedding" (
    "jobId"       TEXT NOT NULL,
    "vector"      DOUBLE PRECISION[] NOT NULL,
    "model"       TEXT NOT NULL,
    "dimensions"  INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobEmbedding_pkey" PRIMARY KEY ("jobId")
);

CREATE TABLE IF NOT EXISTS "ProfileEmbedding" (
    "userId"      TEXT NOT NULL,
    "vector"      DOUBLE PRECISION[] NOT NULL,
    "model"       TEXT NOT NULL,
    "dimensions"  INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProfileEmbedding_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX IF NOT EXISTS "JobEmbedding_contentHash_idx"     ON "JobEmbedding"("contentHash");
CREATE INDEX IF NOT EXISTS "ProfileEmbedding_contentHash_idx" ON "ProfileEmbedding"("contentHash");

-- Embeddings are derived data: dropping the source row drops the vector.
ALTER TABLE "JobEmbedding" DROP CONSTRAINT IF EXISTS "JobEmbedding_jobId_fkey";
ALTER TABLE "JobEmbedding" ADD  CONSTRAINT "JobEmbedding_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfileEmbedding" DROP CONSTRAINT IF EXISTS "ProfileEmbedding_userId_fkey";
ALTER TABLE "ProfileEmbedding" ADD  CONSTRAINT "ProfileEmbedding_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
