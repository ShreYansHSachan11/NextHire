import type { Metadata } from "next";

/** See `app/company/dashboard/layout.tsx` — a client page cannot export metadata. */
export const metadata: Metadata = { title: "Post a job" };

export default function PostJobLayout({ children }: { children: React.ReactNode }) {
  return children;
}
