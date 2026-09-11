import type { Metadata } from "next";

/** See `app/company/dashboard/layout.tsx` — a client page cannot export metadata. */
export const metadata: Metadata = { title: "Messages" };

export default function ConversationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
