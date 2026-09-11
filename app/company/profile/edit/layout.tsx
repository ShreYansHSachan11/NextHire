import type { Metadata } from "next";

/** See `app/company/dashboard/layout.tsx` — a client page cannot export metadata. */
export const metadata: Metadata = { title: "Edit company profile" };

export default function CompanyProfileEditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
