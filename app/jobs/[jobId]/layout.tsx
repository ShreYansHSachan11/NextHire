import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";

/**
 * Titles a posting, from the server, beside a client page.
 *
 * Same reason as `app/jobs/layout.tsx`: the page is `"use client"` and cannot
 * export metadata itself. The difference here is that the title is *data*, and
 * it is the single piece of this route that a bookmark, a browser tab, a shared
 * link and the App Router's route announcer all depend on. "NextHire —
 * Signal-driven job matching" on every one of a hundred postings is the same
 * string a screen-reader user hears after every card they open.
 *
 * One narrow `select` rather than the whole row: this runs on every detail
 * render and the page already fetches the job it needs through the API.
 * Failures are swallowed to a neutral title — a metadata query is not worth
 * taking the route down for, and `notFound()` here would pre-empt the page's
 * own, better, error card.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<Metadata> {
  const { jobId } = await params;

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        title: true,
        location: true,
        type: true,
        company: { select: { name: true } },
      },
    });

    if (!job) return { title: "Role not found" };

    const company = job.company?.name ?? "a company";
    // The description is the search-result snippet and the link preview, so it
    // carries the facts a reader decides on rather than a marketing sentence.
    const facts = [job.location, job.type].filter(Boolean).join(" · ");

    return {
      title: `${job.title} at ${company}`,
      description: facts
        ? `${job.title} at ${company} — ${facts}. Open for applications on NextHire.`
        : `${job.title} at ${company}. Open for applications on NextHire.`,
    };
  } catch {
    return { title: "Role" };
  }
}

export default function JobDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
