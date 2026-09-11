import type { Metadata } from "next";

/**
 * See the sibling layouts under `app/seeker/` — a client page cannot export
 * `metadata`, so the per-route title has to come from a server layout
 * (DESIGN-NOTES §2.1). Resolves to "Edit profile · NextHire".
 */
export const metadata: Metadata = { title: "Edit profile" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
