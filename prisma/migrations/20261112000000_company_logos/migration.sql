-- Company logos: where a company's site is, and a logo URL when a source
-- provides one. Both nullable; nothing existing changes.
ALTER TABLE "Company" ADD COLUMN "website" TEXT,
ADD COLUMN "logoUrl" TEXT;

-- Employers already gave their website on their profile (stored on the
-- account); copy it to their company so their jobs show a logo straight away.
UPDATE "Company" AS c
SET "website" = u."website"
FROM "User" AS u
WHERE u."companyId" = c."id"
  AND u."role" = 'COMPANY'
  AND u."website" IS NOT NULL
  AND c."website" IS NULL;
