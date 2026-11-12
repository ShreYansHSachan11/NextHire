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
