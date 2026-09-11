import type { Metadata } from "next";

/**
 * See `app/company/dashboard/layout.tsx` — a client page cannot export metadata.
 *
 * Deliberately static rather than a `generateMetadata` that reads the posting:
 * the title would cost a database round-trip on every navigation to an editor
 * whose `h1` already names the role, and this segment is owner-only, so there is
 * nothing to share or index.
 */
export const metadata: Metadata = { title: "Edit posting" };

export default function EditJobLayout({ children }: { children: React.ReactNode }) {
  return children;
}
