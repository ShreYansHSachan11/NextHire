import type { Metadata } from "next";

/**
 * A server layout beside a client page, existing only so `/jobs` has a title.
 *
 * Every page in `app/` is `"use client"`, and a client page cannot export
 * `metadata` — so `/`, `/jobs` and `/auth/login` all served the root template's
 * default string. That is a WCAG 2.4.2 (Page Titled) failure, and it silently
 * neuters the App Router's route announcer, which reads `document.title` after
 * a client-side navigation: an identical title everywhere is indistinguishable
 * from nothing being announced at all. A *sibling server layout* can export the
 * metadata without the page being converted, which is why this file exists and
 * does nothing else.
 *
 * Deeper segments override this — `app/jobs/[jobId]/layout.tsx` titles the
 * posting itself. `/jobs/post` inherits "Open roles" until that segment adds
 * its own one-line layout.
 */
export const metadata: Metadata = {
  title: "Open roles",
  description:
    "Every role currently accepting applications on NextHire. Filter by location, experience and type, and see how each one lines up with your profile.",
};

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
