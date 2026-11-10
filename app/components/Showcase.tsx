import { FIT_BANDS, Icon, PIPELINE_STAGES } from "./ui";

type Step = { title: string; body: string };

const INTERVIEW_STAGE = PIPELINE_STAGES.indexOf("INTERVIEW");

/**
 * The three-card bento used on the auth panels and the homepage hero. Each card
 * pairs one step of the product with a small picture of it. The pictures are
 * illustrations rather than data, so they are hidden from assistive tech and
 * each picture is labelled "Example".
 *
 * Colours come from tokens rather than `dark:` utilities, because this sits on
 * `.band-dark`, which is dark in both themes.
 */
export function ShowcaseBento({
  steps,
  className = "",
}: {
  steps: readonly [Step, Step, Step];
  className?: string;
}) {
  const [score, track, talk] = steps;

  return (
    <div className={`grid grid-cols-2 gap-3 ${className}`}>
      <div className="panel surface-accent flex min-w-0 flex-col justify-between gap-6 p-5">
        <div aria-hidden="true">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--ink-muted)]">
            Example
            <Icon.spark className="h-4 w-4" />
          </div>
          <p className="mt-3 text-3xl font-semibold leading-none tracking-tight text-[var(--ink)]">
            {FIT_BANDS[0].label}
          </p>
        </div>
        <StepCopy step={score} />
      </div>

      <div className="panel flex min-w-0 flex-col justify-between gap-6 p-5">
        <div aria-hidden="true">
          <div className="text-xs font-medium text-[var(--ink-muted)]">Example</div>
          <p className="mt-3 text-3xl font-semibold leading-none tracking-tight text-[var(--ink)]">
            Interview
          </p>
          <div className="track track-fill mt-3">
            {PIPELINE_STAGES.map((stage, index) => (
              <span
                key={stage}
                className={`track-seg ${index <= INTERVIEW_STAGE ? "track-seg-done" : ""}`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--ink-muted)]">
            Stage {INTERVIEW_STAGE + 1} of {PIPELINE_STAGES.length}
          </p>
        </div>
        <StepCopy step={track} />
      </div>

      <div className="panel panel-lit col-span-2 grid min-w-0 gap-5 p-5 sm:grid-cols-2 sm:items-center">
        <StepCopy step={talk} />
        <div className="flex flex-col gap-1.5 text-xs" aria-hidden="true">
          <span className="bubble bubble-peer self-start">Are you free on Thursday?</span>
          <span className="bubble bubble-own self-end">Thursday works.</span>
        </div>
      </div>
    </div>
  );
}

const SCAN_SKILLS = ["React", "TypeScript", "Node.js", "PostgreSQL", "System design"] as const;
const SCAN_FIT = 88;

/**
 * The homepage hero picture: a resume being read, the skills it found, and the
 * job it fits best. It shows what the product does in one glance — the scan
 * line sweeps the page, the skills arrive one by one, the fit bar fills.
 *
 * Illustration, not data: hidden from assistive tech and marked "Example".
 * Every animation is CSS and stops under reduced motion, leaving the final
 * frame.
 */
export function ResumeScanCard({ className = "" }: { className?: string }) {
  const band = FIT_BANDS.find((b) => SCAN_FIT >= b.min) ?? FIT_BANDS[0];

  return (
    <div className={`relative ${className}`} aria-hidden="true">
      <div className="panel panel-glow relative p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ink)]">Resume analysis</p>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">Example</p>
          </div>
          <span className="chip chip-accent">
            <Icon.check className="h-3.5 w-3.5" />
            Parsed
          </span>
        </div>

        {/* The page being read. */}
        <div
          className="scan-doc mt-5 h-36"
          style={{ ["--scan-distance" as string]: "9rem" }}
        >
          <span className="scan-bar w-2/5" style={{ height: "0.625rem" }} />
          <span className="scan-bar mt-2 w-1/4" />
          <span className="scan-bar mt-5 w-11/12" />
          <span className="scan-bar mt-2 w-4/5" />
          <span className="scan-bar mt-2 w-3/4" />
          <span className="scan-bar mt-2 w-2/3" />
          <span className="scan-line" />
        </div>

        <p className="eyebrow mt-5">Skills found</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SCAN_SKILLS.map((skill, index) => (
            <span
              key={skill}
              className="chip reveal-pop"
              style={{ ["--delay" as string]: `${300 + index * 140}ms` }}
            >
              {skill}
            </span>
          ))}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="panel-sunken px-3 py-2">
            <dt className="text-[var(--ink-muted)]">Seniority</dt>
            <dd className="mt-0.5 text-sm font-semibold text-[var(--ink)]">Senior</dd>
          </div>
          <div className="panel-sunken px-3 py-2">
            <dt className="text-[var(--ink-muted)]">Experience</dt>
            <dd className="mt-0.5 text-sm font-semibold text-[var(--ink)]">6 years</dd>
          </div>
        </dl>

        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="mono tile tile-ink h-9 w-9 flex-shrink-0 text-sm font-semibold">N</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--ink)]">Senior Frontend Engineer</p>
                <p className="truncate text-xs text-[var(--ink-muted)]">Best match · Remote</p>
              </div>
            </div>
            <p className="flex-shrink-0 text-right">
              <span className="text-gradient block text-2xl font-semibold leading-none tracking-tight">
                {SCAN_FIT}
              </span>
              <span className="eyebrow mt-1 block">{band.label} fit</span>
            </p>
          </div>
          <div className="meter mt-3">
            <span
              className="meter-fill grow-x"
              style={{ width: `${SCAN_FIT}%`, ["--delay" as string]: "1100ms" }}
            />
          </div>
        </div>
      </div>

      {/* A notification arriving under the card, clear of its edge. */}
      <div className="panel-overlay float-slow mx-auto mt-4 flex w-fit items-center gap-3 rounded-full px-4 py-2.5">
        <span className="live-dot" />
        <span className="text-xs font-medium text-[var(--ink)]">3 new jobs match your resume</span>
      </div>
    </div>
  );
}

function StepCopy({ step }: { step: Step }) {
  return (
    <div className="min-w-0">
      {/* A paragraph, not a heading: this appears under an h1 on the homepage and
          an h2 on the auth panels, and it is not a section of either. */}
      <p className="text-sm font-semibold text-[var(--ink)]">{step.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">{step.body}</p>
    </div>
  );
}
