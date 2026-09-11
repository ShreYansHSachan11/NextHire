import type { Metadata } from "next";

/**
 * Every page under `app/` is a client component, and a client component cannot
 * export `metadata` — so without a sibling server layout each route served the
 * root title verbatim. That is a WCAG 2.4.2 (Page Titled) failure, and it also
 * silently neuters the App Router's route announcer, which reads
 * `document.title` on navigation: identical titles are indistinguishable from
 * no navigation at all (DESIGN-NOTES §2.1).
 *
 * The root layout's `template` turns this into "Messages · NextHire".
 */
export const metadata: Metadata = { title: "Messages" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
