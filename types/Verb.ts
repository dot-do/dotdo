// ============================================================================
// VERB - Predicate registry entry
// ============================================================================

export interface VerbData {
  verb: string // 'create' (base action form / imperative)
  activity?: string // 'creating' (present participle / gerund)
  event?: string // 'created' (past participle)
  inverse?: string // 'delete' (opposite verb)
  description?: string
}

// Convention: given event 'created'
// - createdBy = actor
// - createdAt = timestamp
// - createdIn = context/request

export interface Verb extends VerbData {
  // Derived forms
  readonly by: string // '{event}By' - actor reference
  readonly at: string // '{event}At' - timestamp field
  readonly in: string // '{event}In' - context field
}

// ============================================================================
// STANDARD VERBS
// ============================================================================

export const StandardVerbs: Record<string, VerbData> = {
  create: {
    verb: 'create',
    activity: 'creating',
    event: 'created',
    inverse: 'delete',
  },
  update: {
    verb: 'update',
    activity: 'updating',
    event: 'updated',
  },
  delete: {
    verb: 'delete',
    activity: 'deleting',
    event: 'deleted',
    inverse: 'create',
  },
  assign: {
    verb: 'assign',
    activity: 'assigning',
    event: 'assigned',
    inverse: 'unassign',
  },
  unassign: {
    verb: 'unassign',
    activity: 'unassigning',
    event: 'unassigned',
    inverse: 'assign',
  },
  publish: {
    verb: 'publish',
    activity: 'publishing',
    event: 'published',
    inverse: 'unpublish',
  },
  archive: {
    verb: 'archive',
    activity: 'archiving',
    event: 'archived',
    inverse: 'unarchive',
  },
  approve: {
    verb: 'approve',
    activity: 'approving',
    event: 'approved',
    inverse: 'reject',
  },
  reject: {
    verb: 'reject',
    activity: 'rejecting',
    event: 'rejected',
    inverse: 'approve',
  },
  complete: {
    verb: 'complete',
    activity: 'completing',
    event: 'completed',
    inverse: 'reopen',
  },
  start: {
    verb: 'start',
    activity: 'starting',
    event: 'started',
    inverse: 'stop',
  },
  stop: {
    verb: 'stop',
    activity: 'stopping',
    event: 'stopped',
    inverse: 'start',
  },
}

// ============================================================================
// HELPER: Get derived forms
// ============================================================================

export function getVerbForms(verb: VerbData): Verb {
  const event = verb.event || verb.verb + 'ed'

  return {
    ...verb,
    event,
    by: event + 'By',
    at: event + 'At',
    in: event + 'In',
  }
}

// ============================================================================
// HELPER: Conjugate verb (simple rules)
// ============================================================================

export function conjugate(verb: string): VerbData {
  // Simple English conjugation rules
  // This is a fallback - prefer explicit definitions

  let activity: string
  let event: string

  if (verb.endsWith('e')) {
    activity = verb + 'ing'
    event = verb + 'd'
  } else if (verb.endsWith('y')) {
    activity = verb.slice(0, -1) + 'ying'
    event = verb.slice(0, -1) + 'ied'
  } else {
    activity = verb + 'ing'
    event = verb + 'ed'
  }

  return {
    verb,
    activity,
    event,
  }
}
