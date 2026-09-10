-- Adds the six User profile columns that `schema.prisma` has always declared but
-- that no migration ever created. They existed in the previously-connected
-- database (added out-of-band, most likely by `prisma db push`), which is why
-- the drift went unnoticed: every query referencing them worked there and fails
-- on any database built purely from this migration history.
--
-- `IF NOT EXISTS` keeps this safe to apply to a database that already has them.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "industry" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profile" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "size" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "website" TEXT;
