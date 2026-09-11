import type { Metadata } from "next";

/*
 * A server layout whose only job is the route title.
 *
 * `page.tsx` here is `"use client"`, and a client page cannot export
 * `metadata` — so without this every employer route served the root title and
 * Next's App Router announcer read the same string on every navigation, which
 * a screen-reader user cannot tell apart from nothing happening (WCAG 2.4.2
 * Page Titled). The root layout's `%s · NextHire` template does the rest.
 *
 * It is also the prerequisite for the sibling `loading.tsx`: a segment needs a
 * boundary before Next will show a segment-level loading state.
 */
export const metadata: Metadata = { title: "Company dashboard" };

export default function CompanyDashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
