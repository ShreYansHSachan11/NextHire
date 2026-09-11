import type { Metadata } from "next";

/**
 * Server layout beside a client page, so `/auth/login` has a title of its own —
 * see the note in `app/jobs/layout.tsx` for why this has to be a sibling file.
 *
 * `robots: noindex` because a sign-in form is not a landing page: it has no
 * content a search engine should rank, and indexing it competes with the
 * homepage for the brand query.
 */
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to NextHire to pick up your matches, applications and conversations.",
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
