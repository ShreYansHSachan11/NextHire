import type { Metadata } from "next";

/** Client pages cannot export metadata; see app/seeker/coach/layout.tsx. */
export const metadata: Metadata = { title: "Resume insights" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
