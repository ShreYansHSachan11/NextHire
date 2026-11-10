import type { Metadata } from "next";

/**
 * Server layout beside a client page, so `/auth/register` has a title of its
 * own — see the note in `app/jobs/layout.tsx` for why this has to be a sibling.
 *
 * Unlike sign-in this one *is* indexable: "create an account" is a real entry
 * point to the product and a legitimate landing page for it.
 */
export const metadata: Metadata = {
  title: "Create an account",
  description:
    "Create a free NextHire account to apply for jobs or post them.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
