import { Card, Skeleton, SkeletonLine } from "@/app/components/ui";

/**
 * Placeholders shaped like the specific cards and rows they stand in for.
 *
 * These lived twice each: once in the client page that shows them while it
 * fetches, and again — copy-pasted — in the route's `loading.tsx`. Two of the
 * four pairs had already drifted apart. The match card's footer was
 * `mt-auto … pt-4` in the page and `mt-6` in the loading file; the job card's
 * chips and footer were different widths in each. Nobody edits both copies,
 * because nothing tells you the second one is there.
 *
 * The heights are not eyeballed. Each shape below is checked against the real
 * component row for row, using the tokens the real component resolves to:
 *
 *   text-sm line box      20px      .eyebrow line box     13.2px
 *   text-base line box    24px      .chip                 25px
 *   text-lg line box      28px      button / field        40px  (--control-h-md)
 *   .btn-ghost            32px      .meter                 4px  (--control-h-sm)
 *
 * That matters more than it sounds. A skeleton shorter than its own content is
 * a layout shift with extra steps — the exact thing it was added to prevent —
 * and every one of these was short, the match card by 63px per card.
 *
 * A skeleton may only reserve space for content that is *always* there. The
 * blocks the real cards render conditionally — a matched-skills list, a score
 * meter on an unscored feed — are deliberately absent: a placeholder for
 * something that usually will not arrive overshoots just as badly as one that
 * is too short, in the other direction.
 */

/* -------------------------------------------------------------------------- */
/* Seeker dashboard                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors `MatchedJobCard` on the seeker dashboard.
 *
 * Content height 174px against the real card's 173px:
 *   header 54  ·  meter 16  ·  skills 56  ·  footer 48
 *
 * The previous shape came to 110px. Most of the gap was the header — it
 * reserved 32px for a `MatchScore` that stands three lines tall (band, score,
 * rank ordinal) — and a footer bar carrying `pt-4`, which paints *inside* the
 * bar's own box and so reserved nothing at all.
 */
export function MatchCardSkeleton() {
  return (
    <Card className="flex h-full w-full min-w-0 flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        {/* Title (text-sm) over company (text-sm, mt-0.5). */}
        <div className="min-w-0 flex-1">
          <SkeletonLine width="w-3/4" />
          <SkeletonLine bar="h-3" width="w-1/2" className="mt-0.5" />
        </div>

        {/* `MatchScore`: a 20px band row, then two eyebrow lines — the score
            readout and the "3rd closest of 24" ordinal. */}
        <div className="flex flex-shrink-0 flex-col items-end">
          <SkeletonLine bar="h-4" width="w-20" />
          <SkeletonLine height="h-3.5" bar="h-2.5" width="w-24" className="mt-1" />
          <SkeletonLine height="h-3.5" bar="h-2.5" width="w-16" className="mt-0.5" />
        </div>
      </div>

      {/* The reserved meter slot. 4px is the real bar's full height, so this
          reads as a hairline on purpose rather than by mistake. */}
      <div className="mt-3">
        <Skeleton className="h-1 w-full" rounded="rounded-full" />
      </div>

      {/* "Skills in common" caption over the chip row. The caption was missing
          entirely, which is 19px of the shortfall on its own. */}
      <div className="mt-3">
        <SkeletonLine height="h-3.5" bar="h-2.5" width="w-24" className="mb-1.5" />
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-6 w-16" rounded="rounded-md" />
          <Skeleton className="h-6 w-20" rounded="rounded-md" />
        </div>
      </div>

      {/* `pt-4` belongs on this wrapper, not on a bar: it has to push the row
          down, and padding on a skeleton is painted, not reserved. */}
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <SkeletonLine height="h-3.5" bar="h-2.5" width="w-20" />
        <Skeleton className="h-8 w-24" rounded="rounded-sm" />
      </div>
    </Card>
  );
}

/**
 * Mirrors `ApplicationRow` on the seeker dashboard.
 *
 * The right rail is the tall side at 158px, and the old shape reserved 96:
 * it drew one button where the row has two, and collapsed `PipelineTrack` to
 * its 4px bars while dropping the stage caption underneath them.
 */
export function ApplicationRowSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
      {/* Title (text-lg from sm up), company, chips, then the applied-on line. */}
      <div className="min-w-0 flex-1">
        <SkeletonLine height="h-7" bar="h-4" width="w-2/3" />
        <SkeletonLine bar="h-3" width="w-1/3" className="mt-0.5" />
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Skeleton className="h-6 w-24" rounded="rounded-md" />
          <Skeleton className="h-6 w-20" rounded="rounded-md" />
        </div>
        <SkeletonLine height="h-3.5" bar="h-2.5" width="w-1/2" className="mt-2.5" />
      </div>

      <div className="flex flex-col gap-3 lg:w-56 lg:flex-shrink-0">
        {/* StatusBadge. */}
        <Skeleton className="h-6 w-28" rounded="rounded-md" />

        {/* `PipelineTrack`: four segment bars over a stage caption. */}
        <div>
          <div className="flex gap-1">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-1 flex-1" rounded="rounded-full" />
            ))}
          </div>
          <SkeletonLine height="h-3.5" bar="h-2.5" width="w-24" className="mt-1.5" />
        </div>

        {/* Message and Withdraw — two controls, not one. `btn-touch` holds
            these at 44px for a thumb and relaxes to 40px from `md` up, so the
            placeholder has to step down at the same breakpoint. */}
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <Skeleton className="h-11 w-full sm:flex-1 md:h-10 lg:w-full" rounded="rounded-md" />
          <Skeleton className="h-11 w-full sm:flex-1 md:h-10 lg:w-full" rounded="rounded-md" />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Jobs feed                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors `JobCard` in the jobs feed.
 *
 * Content height 179px against the real card's 180px, measured on the shape
 * every reader gets. The matched-skills block and the score meter are omitted
 * on purpose: both are present only for a signed-in seeker with an indexed
 * profile on a deployment that has a model, and reserving ~74px for them would
 * leave anonymous visitors — who are most of this page's traffic — staring at
 * a placeholder half again as tall as the card that replaces it.
 *
 * The description is the row that was most wrong: two lines of `leading-relaxed`
 * are 23px each, not the 12px the bars were drawn at.
 */
export function JobCardSkeleton() {
  return (
    <Card grid className="@container p-4 @lg:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {/* The company avatar. */}
          <Skeleton className="h-11 w-11 flex-shrink-0" rounded="rounded-lg" />
          <div className="min-w-0 flex-1">
            {/* `text-base leading-snug` — a 22px line box, not 16px. */}
            <SkeletonLine height="h-[1.375rem]" bar="h-4" width="w-3/4" />
            <SkeletonLine bar="h-3" width="w-1/3" className="mt-1" />
          </div>
        </div>
        {/* The score column, held open whether or not this reader gets one. */}
        <Skeleton className="h-9 w-20 flex-shrink-0" rounded="rounded-md" />
      </div>

      {/* Two clamped lines of description at their real 23px line box. */}
      <div className="mt-3">
        <SkeletonLine height="h-[1.4375rem]" bar="h-3" width="w-full" />
        <SkeletonLine height="h-[1.4375rem]" bar="h-3" width="w-5/6" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Skeleton className="h-6 w-24" rounded="rounded-md" />
        <Skeleton className="h-6 w-20" rounded="rounded-md" />
        <Skeleton className="h-6 w-16" rounded="rounded-md" />
      </div>

      {/* The real card puts a `flex-1` spacer here so footers line up across a
          row; with no content to absorb, the margin alone is the same height. */}
      <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
        <SkeletonLine height="h-4" bar="h-2.5" width="w-40" />
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Saved searches                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors `SavedSearchRow` on the alerts page: name, the query in mono, and
 * the frequency select, over a footer rule carrying the metadata and actions.
 *
 * The name is `text-base` (24px) and the select is a 40px control; the old
 * shape used 20px and 44px respectively.
 */
export function SavedSearchRowSkeleton() {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <SkeletonLine height="h-6" bar="h-4" width="w-2/5" />
          <SkeletonLine bar="h-3" width="w-3/4" className="mt-2" />
        </div>
        <Skeleton className="h-10 w-full flex-shrink-0 sm:w-40" rounded="rounded-md" />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        <SkeletonLine height="h-3.5" bar="h-2.5" width="w-40" />
        <Skeleton className="h-8 w-32" rounded="rounded-sm" />
      </div>
    </Card>
  );
}
