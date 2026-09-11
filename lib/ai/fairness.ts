/**
 * Outbound protected-characteristic filter for anything the model writes about
 * people.
 *
 * A system instruction is a request, not a control. It is the right first line
 * — the model complies with it almost always — but "almost always" is not a
 * safety property, and the failure mode here is an unlawful screening question
 * shown to an employer with our name on it. So every generation that talks
 * about candidates passes through this on the way out: the prompt asks, and
 * this enforces.
 *
 * The list deliberately errs towards dropping. A false positive costs one
 * suggestion the employer never sees and can type themselves; a false negative
 * costs a candidate a question no employer is allowed to ask.
 */

/**
 * Regex sources, matched whole-word and case-insensitively.
 *
 * `\w*` marks a stem where the whole family is unsafe (`disab` → disabled,
 * disability, disabilities). Bare words are used where the stem would collide
 * with ordinary vocabulary — `medical condition` rather than `medical`, because
 * a healthtech pipeline legitimately describes medical-device backgrounds, and
 * `diagnosis` rather than `diagnos\w*`, because `diagnostics` is a tooling word.
 */
const PROTECTED_TERMS: readonly string[] = [
  // Age, and the coded language that stands in for it.
  'ages?',
  'aged',
  'how old',
  'date of birth',
  'birth ?date',
  'birthday',
  'year of birth',
  'born',
  'young\\w*',
  'youthful',
  'elderly',
  'retire\\w*',
  'millennial\\w*',
  'boomer\\w*',
  'gen ?z',
  'digital native',
  'recent grad\\w*',
  'graduation year',

  // Race and ethnicity. `race condition` is a real engineering term and a
  // plausible screening question, so it is excluded explicitly rather than
  // costing us the whole word.
  'races?(?!\\s+conditions?)',
  'racial\\w*',
  'ethnic\\w*',
  'skin colou?r',
  'caste',
  'ancestry',
  'heritage',

  // Religion or belief.
  'religio\\w*',
  'faith',
  'church',
  'mosque',
  'synagogue',
  'christian\\w*',
  'muslim\\w*',
  'islam\\w*',
  'hindu\\w*',
  'jewish',
  'sikh',
  'buddhis\\w*',
  'atheis\\w*',
  'sabbath',
  'ramadan',
  'kosher',
  'halal',

  // Sex, gender and sexual orientation.
  'sex',
  'sexual\\w*',
  'gender\\w*',
  'male',
  'female',
  'wom[ae]n',
  'pronouns?',
  'lgbt\\w*',
  'gay',
  'lesbian',
  'bisexual',
  'queer',

  // Disability and health.
  'disab\\w*',
  'handicap\\w*',
  'impair\\w*',
  'wheelchair',
  'medical (?:condition|history|record)s?',
  'health (?:condition|issue|problem)s?',
  'mental health',
  'psychiatric',
  'illness',
  'diagnosis',
  'diagnosed',
  'chronic',
  'medication',
  'genetic\\w*',
  'accommodations?',

  // Pregnancy, family and marital status.
  'pregnan\\w*',
  'maternity',
  'paternity',
  'parental leave',
  'childcare',
  'children',
  'kids',
  'depend[ae]nts?',
  'family',
  'marital',
  'married',
  'unmarried',
  'spouse',
  'divorc\\w*',
  'widow\\w*',

  // National origin. Sponsorship and work authorisation are deliberately absent:
  // "do you need visa sponsorship for this role" is a lawful, routine screening
  // question, and blocking it would make the feature useless for the employers
  // who most need to ask.
  'nationalit\\w*',
  'national origin',
  'citizen\\w*',
  'country of (?:origin|birth)',
  'birthplace',
  'native speaker',
  'mother tongue',
  'immigrat\\w*',

  // Veteran status, political affiliation and union membership.
  'veterans?',
  'military service',
  'armed forces',
  'political\\w*',
  '(?:trade )?union member\\w*',

  // Records that are fair-chance protected in much of the world.
  'criminal record',
  'arrest record',
  'convictions?',
];

const PROTECTED_RE = new RegExp(`\\b(?:${PROTECTED_TERMS.join('|')})\\b`, 'i');

/** True when `value` mentions anything on the denylist. */
export function containsProtectedTerm(value: string | null | undefined): boolean {
  if (!value) return false;
  return PROTECTED_RE.test(value);
}

/** Keeps only the entries that mention nothing on the denylist. */
export function withoutProtectedTerms(values: readonly string[]): string[] {
  return values.filter((value) => !containsProtectedTerm(value));
}

/**
 * Sentence-level filter for generated prose.
 *
 * Dropping the whole paragraph over one stray clause would throw away useful
 * signal, and silently rewriting the model's words would be worse — we would be
 * putting sentences in its mouth. Removing the offending sentence and keeping
 * the rest is the honest middle: what remains is verbatim, and what is gone was
 * never safe to show.
 *
 * Returns an empty string when nothing survives, which callers should treat the
 * same way they treat a failed generation.
 */
export function stripProtectedSentences(value: string | null | undefined): string {
  if (!value) return '';
  const sentences = value.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => !containsProtectedTerm(sentence));
  return kept.join(' ').trim();
}
