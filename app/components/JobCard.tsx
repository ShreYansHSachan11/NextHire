"use client";

import { useId } from "react";
import Link from "next/link";
import { experienceLabel } from "@/lib/copy";
import { sourceLabel } from "@/lib/jobs/sources";
import { Avatar, Card, Chip, Eyebrow, formatCount, formatDate, Icon, MatchScore, Meter } from "./ui";

/**
 * The fields a job card reads. A structural subset of a `GET /api/jobs` row, so
 * the feed passes its rows straight in.
 */
export interface JobCardJob {
  id: string;
  title: string;
  salary?: string | null;
  experience?: string | null;
  location?: string | null;
  type?: string | null;
  company?: { name: string } | null;
  createdAt: string;
  _count?: { applications: number };
  /** Set for a job imported from another job board. */
  source?: string | null;
  /** Present only for a signed-in seeker whose profile has been scored. */
  match?: { score: number; sharedSkills: string[] } | null;
}

/** A posting this recent gets the "New" badge. */
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How many matched skills a card lists before "+N more". */
const CARD_SKILL_LIMIT = 3;

/**
 * A location short enough for one line of a card.
 *
 * Imported jobs often list every office: "Noida, Uttar Pradesh · Mumbai,
 * Maharashtra · Bengaluru, Karnataka", or "Remote · Remote job". This keeps the
 * first place, drops repeats, and counts the rest: "Noida +2 more". `full` is
 * the whole tidied list, for a tooltip or a detail page.
 */
export function compactLocation(raw?: string | null): { label: string; full: string } | null {
  if (!raw) return null;
  const seen = new Set<string>();
  const places: string[] = [];
  for (const part of raw.split(/\s*[·|;]\s*/)) {
    let place = /^remote(\s+job)?$/i.test(part.trim()) ? "Remote" : part.trim();
    // "Berlin, Berlin" says the city twice.
    const [city, region, ...rest] = place.split(/\s*,\s*/);
    if (rest.length === 0 && region && city.toLowerCase() === region.toLowerCase()) place = city;
    if (!place || seen.has(place.toLowerCase())) continue;
    seen.add(place.toLowerCase());
    places.push(place);
  }
  if (places.length === 0) return null;
  const full = places.join(" · ");
  // Two short places fit as they are: "Remote · London".
  if (places.length === 1 || (places.length === 2 && full.length <= 22 && !full.includes(","))) {
    return { label: full, full };
  }
  // With more places to count, the city alone is enough: "Noida +2 more".
  const first = places[0].split(",")[0].trim();
  return { label: `${first} +${places.length - 1} more`, full };
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", then the date itself. */
export function postedAgo(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  return `on ${formatDate(date)}`;
}

/**
 * One job in a list.
 *
 * Only what a reader scans before deciding to open a job: the title, who is
 * hiring, then where, what it pays, how it is worked and how senior it is. The
 * description stays on the job page.
 *
 * The whole card is the link. Its accessible name is the title alone
 * (`aria-labelledby`), so a screen reader does not read the entire card out as
 * the link text, and a tooltip on a chip inside it still shows on hover.
 *
 * `scored` is a fact about the whole list, not this card: in a list where any
 * job has a fit score, every card holds the score's space open so a two-column
 * grid stays level.
 */
export default function JobCard({ job, scored = false }: { job: JobCardJob; scored?: boolean }) {
  const titleId = useId();
  const company = job.company?.name ?? "Company";
  const location = compactLocation(job.location);
  const isNew = Date.now() - new Date(job.createdAt).getTime() < NEW_WINDOW_MS;
  const source = sourceLabel(job.source, job.company?.name);
  const applicants = job._count?.applications ?? 0;

  const match = job.match ?? null;
  const sharedSkills = match?.sharedSkills.slice(0, CARD_SKILL_LIMIT) ?? [];
  const extraSkills = (match?.sharedSkills.length ?? 0) - sharedSkills.length;

  const iconClass = "h-3.5 w-3.5";

  return (
    <Card interactive as="article" className="@container flex h-full">
      <Link
        href={`/jobs/${job.id}`}
        aria-labelledby={titleId}
        className="group flex min-w-0 flex-1 flex-col rounded-[inherit] p-4 @lg:p-5"
      >
        <div className="flex items-start gap-3">
          <Avatar name={company} />
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              title={job.title.length > 60 ? job.title : undefined}
              className="line-clamp-2 text-pretty text-base font-semibold leading-snug text-gray-900 dark:text-white"
            >
              {job.title}
            </h2>
            <p className="mt-0.5 truncate text-sm text-gray-600 dark:text-gray-400">{company}</p>
          </div>

          {(isNew || match) && (
            <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
              {isNew && (
                <span className="rounded-md border border-green-300 bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-300">
                  New
                </span>
              )}
              {match && <MatchScore value={match.score} caption="Profile fit" />}
            </div>
          )}
        </div>

        {/* The facts a reader filters on, pay first when it is known. */}
        {(job.salary || location || job.type || job.experience) && (
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {job.salary && (
              <Chip icon={<Icon.money className={iconClass} />} className="font-medium">
                {job.salary}
              </Chip>
            )}
            {location && (
              <Chip
                icon={<Icon.location className={iconClass} />}
                title={location.full !== location.label ? location.full : undefined}
              >
                {location.label}
              </Chip>
            )}
            {job.type && <Chip icon={<Icon.clock className={iconClass} />}>{job.type}</Chip>}
            {job.experience && (
              <Chip icon={<Icon.briefcase className={iconClass} />}>{experienceLabel(job.experience)}</Chip>
            )}
          </div>
        )}

        {/* What a fit score is made of: the skills this job and the profile share. */}
        {sharedSkills.length > 0 && (
          <div className="mt-3">
            <Eyebrow accent className="mb-1.5">
              Matched skills
            </Eyebrow>
            <div className="flex flex-wrap items-center gap-1.5">
              {sharedSkills.map((skill) => (
                <Chip key={skill} accent size="sm">
                  {skill}
                </Chip>
              ))}
              {extraSkills > 0 && <Eyebrow as="span">+{extraSkills} more</Eyebrow>}
            </div>
          </div>
        )}

        {/* Held open only where cards sit side by side; a single column has no
            neighbour to line up with. */}
        {scored && (
          <div className={`mt-3 min-h-[0.375rem] ${match ? "" : "hidden lg:block"}`}>
            {match && <Meter value={match.score} label={`Profile fit: ${match.score} out of 100`} />}
          </div>
        )}

        {/* Takes up the slack so footers line up across a row. */}
        <div className="mt-4 flex-1" aria-hidden="true" />

        <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
          <p className="eyebrow flex min-w-0 items-center gap-1.5">
            <time dateTime={job.createdAt} title={formatDate(job.createdAt)} className="flex-shrink-0">
              Posted {postedAgo(job.createdAt)}
            </time>
            <span aria-hidden="true">·</span>
            {/* An imported job takes applications on the original posting, so a
                count here would always read 0; say where it came from instead. */}
            <span className="truncate">{source ? `via ${source}` : `${formatCount(applicants)} applied`}</span>
          </p>
          <span
            className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-gray-500 transition-colors group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white"
            aria-hidden="true"
          >
            View
            <Icon.arrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    </Card>
  );
}
