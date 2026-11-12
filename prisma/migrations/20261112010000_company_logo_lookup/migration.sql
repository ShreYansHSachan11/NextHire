-- When an imported company was last looked up by name for its logo.
ALTER TABLE "Company" ADD COLUMN "logoCheckedAt" TIMESTAMP(3);
