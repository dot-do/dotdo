/**
 * Verb Form State Encoding
 *
 * The key insight: verb form IS the state, no separate status column needed.
 *
 * State Machine:
 *   create (action/intent) -> creating (activity/in-progress) -> created (event/completed)
 *
 * Verb Forms:
 * - Action form (create, update, delete) = intent/pending, may have from, to describes what will be affected
 * - Activity form (creating, updating, deleting) = in-progress, to=null (work in progress)
 * - Event form (created, updated, deleted) = completed, to=result (the result of the action)
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Verb form types that encode state
 */
export type VerbFormType = 'action' | 'activity' | 'event'

/**
 * Verb form state with its semantics
 */
export interface VerbFormState {
  form: string // The actual verb form (e.g., 'create', 'creating', 'created')
  type: VerbFormType // action, activity, or event
  baseVerb: string // The canonical verb (e.g., 'create')
}

/**
 * Relationship edge with verb form state encoding
 * The verb field encodes the state directly - no status column needed
 */
export interface VerbFormEdge {
  id: string
  verb: string // The verb form encodes state: 'create' | 'creating' | 'created'
  from: string // Source URL
  to: string | null // null during activity (in-progress), set when event (completed)
  data?: Record<string, unknown>
  createdAt: Date
}

/**
 * Verb conjugation data for state transitions
 */
export interface VerbConjugation {
  action: string // 'create' - intent/pending
  activity: string // 'creating' - in-progress
  event: string // 'created' - completed
  inverse?: string // 'delete' - opposite action
}

// ============================================================================
// KNOWN IRREGULAR VERBS
// ============================================================================

/**
 * Known irregular verb conjugations
 */
const IRREGULAR_VERBS: Record<string, VerbConjugation> = {
  // Completely irregular
  go: { action: 'go', activity: 'going', event: 'went' },
  have: { action: 'have', activity: 'having', event: 'had' },
  be: { action: 'be', activity: 'being', event: 'was' },
  do: { action: 'do', activity: 'doing', event: 'done' },
  get: { action: 'get', activity: 'getting', event: 'got' },
  make: { action: 'make', activity: 'making', event: 'made' },
  take: { action: 'take', activity: 'taking', event: 'took' },
  see: { action: 'see', activity: 'seeing', event: 'saw' },
  come: { action: 'come', activity: 'coming', event: 'came' },
  give: { action: 'give', activity: 'giving', event: 'gave' },
  find: { action: 'find', activity: 'finding', event: 'found' },
  write: { action: 'write', activity: 'writing', event: 'written' },
  run: { action: 'run', activity: 'running', event: 'ran' },
  begin: { action: 'begin', activity: 'beginning', event: 'began' },
  send: { action: 'send', activity: 'sending', event: 'sent' },
  build: { action: 'build', activity: 'building', event: 'built' },
  set: { action: 'set', activity: 'setting', event: 'set' },
  put: { action: 'put', activity: 'putting', event: 'put' },
  cut: { action: 'cut', activity: 'cutting', event: 'cut' },
  read: { action: 'read', activity: 'reading', event: 'read' },
}

/**
 * Reverse lookup from any conjugated form to base verb
 */
const IRREGULAR_LOOKUP: Map<string, string> = new Map()
for (const [base, conj] of Object.entries(IRREGULAR_VERBS)) {
  IRREGULAR_LOOKUP.set(conj.action, base)
  IRREGULAR_LOOKUP.set(conj.activity, base)
  IRREGULAR_LOOKUP.set(conj.event, base)
}

// ============================================================================
// CONJUGATION RULES
// ============================================================================

/**
 * Determines if a character is a vowel
 */
function isVowel(char: string): boolean {
  return 'aeiou'.includes(char.toLowerCase())
}

/**
 * Determines if a character is a consonant
 */
function isConsonant(char: string): boolean {
  return /[bcdfghjklmnpqrstvwxyz]/i.test(char)
}

/**
 * Conjugate a base verb to its -ing form (activity/present participle)
 */
function conjugateToActivity(baseVerb: string): string {
  // Check irregular verbs first
  const irregular = IRREGULAR_VERBS[baseVerb]
  if (irregular) {
    return irregular.activity
  }

  // Verbs ending in -ie: change to -ying (die -> dying, lie -> lying)
  if (baseVerb.endsWith('ie')) {
    return baseVerb.slice(0, -2) + 'ying'
  }

  // Verbs ending in -e (but not -ee, -ye, -oe): drop e, add -ing (create -> creating)
  if (
    baseVerb.endsWith('e') &&
    !baseVerb.endsWith('ee') &&
    !baseVerb.endsWith('ye') &&
    !baseVerb.endsWith('oe')
  ) {
    return baseVerb.slice(0, -1) + 'ing'
  }

  // CVC pattern (consonant-vowel-consonant): double final consonant
  // Only for single-syllable verbs or verbs with stress on final syllable
  const len = baseVerb.length
  if (
    len >= 3 &&
    isConsonant(baseVerb[len - 1]!) &&
    isVowel(baseVerb[len - 2]!) &&
    isConsonant(baseVerb[len - 3]!) &&
    // Don't double w, x, y
    !/[wxy]$/.test(baseVerb)
  ) {
    // Simple heuristic: double for short verbs
    if (len <= 4) {
      return baseVerb + baseVerb[len - 1] + 'ing'
    }
  }

  // Default: just add -ing
  return baseVerb + 'ing'
}

/**
 * Conjugate a base verb to its -ed form (event/past participle)
 */
function conjugateToEvent(baseVerb: string): string {
  // Check irregular verbs first
  const irregular = IRREGULAR_VERBS[baseVerb]
  if (irregular) {
    return irregular.event
  }

  // Verbs ending in -e: just add -d (create -> created)
  if (baseVerb.endsWith('e')) {
    return baseVerb + 'd'
  }

  // Verbs ending in consonant + y: change y to ied (apply -> applied, deny -> denied)
  if (baseVerb.endsWith('y') && baseVerb.length > 1 && isConsonant(baseVerb[baseVerb.length - 2]!)) {
    return baseVerb.slice(0, -1) + 'ied'
  }

  // CVC pattern: double final consonant
  const len = baseVerb.length
  if (
    len >= 3 &&
    isConsonant(baseVerb[len - 1]!) &&
    isVowel(baseVerb[len - 2]!) &&
    isConsonant(baseVerb[len - 3]!) &&
    !/[wxy]$/.test(baseVerb)
  ) {
    if (len <= 4) {
      return baseVerb + baseVerb[len - 1] + 'ed'
    }
  }

  // Default: add -ed
  return baseVerb + 'ed'
}

/**
 * Extract base verb from an -ing form
 */
function extractBaseFromActivity(activityForm: string): string {
  // Check irregular verbs first
  const irregularBase = IRREGULAR_LOOKUP.get(activityForm)
  if (irregularBase) {
    return irregularBase
  }

  if (!activityForm.endsWith('ing')) {
    return activityForm
  }

  const stem = activityForm.slice(0, -3)

  // Check for doubled consonant (running -> run)
  if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
    const potential = stem.slice(0, -1)
    // Verify this is a valid CVC pattern
    if (
      potential.length >= 2 &&
      isConsonant(potential[potential.length - 1]!) &&
      isVowel(potential[potential.length - 2]!)
    ) {
      return potential
    }
  }

  // Check if base ended in -e (creating -> create)
  const withE = stem + 'e'
  // Heuristic: if stem ends in consonant cluster, likely had -e
  if (stem.length >= 2 && isConsonant(stem[stem.length - 1]!) && isConsonant(stem[stem.length - 2]!)) {
    // Probably not -e ending (publishing -> publish)
    return stem
  }
  if (isConsonant(stem[stem.length - 1]!) && isVowel(stem[stem.length - 2]!)) {
    // Could have been -e ending - check common patterns
    if (/[td]$/.test(stem)) {
      return withE
    }
  }

  // Check for -ying -> -ie (dying -> die)
  if (activityForm.endsWith('ying') && stem.length >= 1) {
    return stem.slice(0, -1) + 'ie'
  }

  // Try with -e first for common patterns
  if (stem.match(/[^aeiou][aeiou][^aeiou]$/)) {
    return withE
  }

  return stem
}

/**
 * Extract base verb from an -ed form
 */
function extractBaseFromEvent(eventForm: string): string {
  // Check irregular verbs first
  const irregularBase = IRREGULAR_LOOKUP.get(eventForm)
  if (irregularBase) {
    return irregularBase
  }

  // Handle -ied -> -y (applied -> apply)
  if (eventForm.endsWith('ied')) {
    return eventForm.slice(0, -3) + 'y'
  }

  if (!eventForm.endsWith('ed')) {
    return eventForm
  }

  // Handle -ed where base ends in -e (created -> create)
  if (eventForm.endsWith('ed') && !eventForm.endsWith('eed')) {
    const withoutEd = eventForm.slice(0, -2)
    const withoutD = eventForm.slice(0, -1)

    // Check for doubled consonant (stopped -> stop)
    if (
      withoutEd.length >= 2 &&
      withoutEd[withoutEd.length - 1] === withoutEd[withoutEd.length - 2] &&
      isConsonant(withoutEd[withoutEd.length - 1]!)
    ) {
      return withoutEd.slice(0, -1)
    }

    // If removing -d gives a word ending in e, that's the base (created -> create)
    if (withoutD.endsWith('e')) {
      return withoutD
    }

    // Otherwise remove -ed (published -> publish)
    return withoutEd
  }

  return eventForm.slice(0, -2)
}

// ============================================================================
// VERB FORM TYPE DETECTION
// ============================================================================

/**
 * Determines the verb form type (action, activity, or event)
 * based on the morphology of the verb.
 */
export function getVerbFormType(verb: string): VerbFormType {
  // Check irregular verbs first
  for (const [base, conj] of Object.entries(IRREGULAR_VERBS)) {
    if (verb === conj.action) return 'action'
    if (verb === conj.activity) return 'activity'
    if (verb === conj.event) return 'event'
  }

  // Activity form: ends in -ing
  if (verb.endsWith('ing') && verb.length > 3) {
    return 'activity'
  }

  // Event form: ends in -ed, -ied, or known irregular past
  if (verb.endsWith('ed') || verb.endsWith('ied')) {
    return 'event'
  }

  // Default to action form (base/imperative)
  return 'action'
}

// ============================================================================
// VERB FORM PARSING
// ============================================================================

/**
 * Parses a verb form into its components: form, type, and base verb.
 */
export function parseVerbForm(verb: string): VerbFormState {
  const type = getVerbFormType(verb)

  let baseVerb: string
  switch (type) {
    case 'activity':
      baseVerb = extractBaseFromActivity(verb)
      break
    case 'event':
      baseVerb = extractBaseFromEvent(verb)
      break
    case 'action':
    default:
      baseVerb = verb
  }

  return {
    form: verb,
    type,
    baseVerb,
  }
}

// ============================================================================
// STATE TRANSITIONS
// ============================================================================

/**
 * Valid transitions between verb form states
 */
const VALID_TRANSITIONS: Record<VerbFormType, Record<string, VerbFormType>> = {
  action: {
    start: 'activity', // action -> activity (begin work)
    complete: 'event', // action -> event (immediate completion)
  },
  activity: {
    complete: 'event', // activity -> event (finish work)
    cancel: 'action', // activity -> action (cancel, return to pending)
  },
  event: {
    // Events are final - no valid transitions out
  },
}

/**
 * Transitions a verb from its current form to a new form based on the transition type.
 *
 * @param verb - The current verb form
 * @param transition - The transition to apply: 'start', 'complete', or 'cancel'
 * @returns The new verb form after the transition
 * @throws Error if the transition is not valid for the current verb form
 */
export function transitionVerbForm(verb: string, transition: 'start' | 'complete' | 'cancel'): string {
  const parsed = parseVerbForm(verb)
  const validTransitions = VALID_TRANSITIONS[parsed.type]

  if (!validTransitions || !(transition in validTransitions)) {
    throw new Error(
      `Invalid transition '${transition}' from ${parsed.type} form '${verb}'. ` +
        `Valid transitions: ${Object.keys(validTransitions || {}).join(', ') || 'none'}`
    )
  }

  const targetType = validTransitions[transition]!
  const baseVerb = parsed.baseVerb

  switch (targetType) {
    case 'action':
      return baseVerb
    case 'activity':
      return conjugateToActivity(baseVerb)
    case 'event':
      return conjugateToEvent(baseVerb)
  }
}

// ============================================================================
// EDGE STATE MANAGEMENT
// ============================================================================

/**
 * Gets the implied state of an edge based on its verb form.
 */
export function getEdgeState(edge: VerbFormEdge): 'pending' | 'in_progress' | 'completed' {
  const type = getVerbFormType(edge.verb)

  switch (type) {
    case 'action':
      return 'pending'
    case 'activity':
      return 'in_progress'
    case 'event':
      return 'completed'
  }
}

/**
 * Transitions an edge to a new state.
 *
 * @param edge - The edge to transition
 * @param transition - The transition to apply
 * @param resultTo - For 'complete' transitions, the result URL to set as 'to'
 * @returns A new edge object with updated verb and to fields
 */
export function transitionEdge(
  edge: VerbFormEdge,
  transition: 'start' | 'complete' | 'cancel',
  resultTo?: string
): VerbFormEdge {
  const newVerb = transitionVerbForm(edge.verb, transition)
  const newType = getVerbFormType(newVerb)

  let newTo: string | null
  switch (newType) {
    case 'activity':
      // In-progress: to is null
      newTo = null
      break
    case 'event':
      // Completed: to is the result (required for complete transition)
      if (resultTo === undefined) {
        throw new Error('Complete transition requires resultTo parameter')
      }
      newTo = resultTo
      break
    case 'action':
      // Cancelled back to pending: restore original to or keep null
      newTo = edge.to
      break
  }

  return {
    ...edge,
    verb: newVerb,
    to: newTo,
  }
}

// ============================================================================
// QUERY BY VERB FORM STATE
// ============================================================================

/**
 * Maps semantic state names to verb form types
 */
const STATE_TO_TYPE: Record<'pending' | 'in_progress' | 'completed', VerbFormType> = {
  pending: 'action',
  in_progress: 'activity',
  completed: 'event',
}

/**
 * Filters edges by their implied state based on verb form.
 *
 * @param edges - The edges to filter
 * @param state - The state to filter by: 'pending', 'in_progress', or 'completed'
 * @param filter - Optional additional filters
 * @returns Edges matching the specified state
 */
export function queryByVerbFormState(
  edges: VerbFormEdge[],
  state: 'pending' | 'in_progress' | 'completed',
  filter?: { baseVerb?: string }
): VerbFormEdge[] {
  const targetType = STATE_TO_TYPE[state]

  return edges.filter((edge) => {
    const parsed = parseVerbForm(edge.verb)

    // Check verb form type matches state
    if (parsed.type !== targetType) {
      return false
    }

    // Check base verb filter if provided
    if (filter?.baseVerb && parsed.baseVerb !== filter.baseVerb) {
      return false
    }

    return true
  })
}

// ============================================================================
// VERB FORM STATE MACHINE CLASS
// ============================================================================

/**
 * A state machine for a specific verb that manages transitions between forms.
 */
export class VerbFormStateMachine {
  readonly action: string
  readonly activity: string
  readonly event: string
  private readonly inverse?: string

  constructor(conjugation: VerbConjugation) {
    this.action = conjugation.action
    this.activity = conjugation.activity
    this.event = conjugation.event
    this.inverse = conjugation.inverse
  }

  /**
   * Creates a state machine from a base verb, auto-conjugating to all forms.
   */
  static fromBaseVerb(verb: string): VerbFormStateMachine {
    // Check if it's a known irregular verb
    const irregular = IRREGULAR_VERBS[verb]
    if (irregular) {
      return new VerbFormStateMachine(irregular)
    }

    return new VerbFormStateMachine({
      action: verb,
      activity: conjugateToActivity(verb),
      event: conjugateToEvent(verb),
    })
  }

  /**
   * Gets the semantic state for a given verb form.
   * Returns null if the verb form doesn't belong to this verb family.
   */
  getState(verbForm: string): 'pending' | 'in_progress' | 'completed' | null {
    if (verbForm === this.action) return 'pending'
    if (verbForm === this.activity) return 'in_progress'
    if (verbForm === this.event) return 'completed'
    return null
  }

  /**
   * Checks if a transition is valid from the given verb form.
   */
  canTransition(currentForm: string, transition: 'start' | 'complete' | 'cancel'): boolean {
    const state = this.getState(currentForm)
    if (state === null) return false

    switch (state) {
      case 'pending':
        return transition === 'start' || transition === 'complete'
      case 'in_progress':
        return transition === 'complete' || transition === 'cancel'
      case 'completed':
        return false // No transitions from completed state
    }
  }

  /**
   * Performs a state transition and returns the new verb form.
   * Throws if the transition is not valid.
   */
  transition(currentForm: string, transition: 'start' | 'complete' | 'cancel'): string {
    if (!this.canTransition(currentForm, transition)) {
      const state = this.getState(currentForm)
      throw new Error(
        `Invalid transition '${transition}' from ${state ?? 'unknown'} state (${currentForm})`
      )
    }

    const state = this.getState(currentForm)!

    switch (transition) {
      case 'start':
        return this.activity
      case 'complete':
        return this.event
      case 'cancel':
        return this.action
    }
  }

  /**
   * Gets the inverse verb (if defined) for undo operations.
   */
  getInverse(): string | undefined {
    return this.inverse
  }
}
