/**
 * Verb Derivation for Backward Cascade Resolution
 *
 * Derives reverse verbs for backward relationships:
 * - manages -> managedBy
 * - owns -> ownedBy
 * - creates -> createdBy
 * - parent_of <-> child_of (bidirectional)
 */

// Known verb pairs for bidirectional relationships
const BIDIRECTIONAL_PAIRS: Record<string, string> = {
  parent_of: 'child_of',
  child_of: 'parent_of',
}

// Common verb patterns that end with 'By' and their forward forms
const REVERSE_TO_FORWARD: Record<string, string> = {
  managedBy: 'manages',
  ownedBy: 'owns',
  createdBy: 'creates',
  reviewedBy: 'reviews',
  employedBy: 'employs',
  containedBy: 'contains',
  assignedBy: 'assigns',
}

// Forward verbs to their reverse forms
const FORWARD_TO_REVERSE: Record<string, string> = {
  manages: 'managedBy',
  owns: 'ownedBy',
  creates: 'createdBy',
  reviews: 'reviewedBy',
  employs: 'employedBy',
  contains: 'containedBy',
  assigns: 'assignedBy',
}

/**
 * Derives the reverse verb for a given forward verb.
 *
 * Examples:
 * - manages -> managedBy
 * - owns -> ownedBy
 * - creates -> createdBy
 * - parent_of -> child_of
 * - managedBy -> manages (handles already-reversed verbs)
 * - customAction -> customActionBy (unknown verbs get 'By' suffix)
 */
export function deriveReverseVerb(verb: string): string {
  // Check bidirectional pairs first
  if (verb in BIDIRECTIONAL_PAIRS) {
    return BIDIRECTIONAL_PAIRS[verb]
  }

  // Check known forward verbs
  if (verb in FORWARD_TO_REVERSE) {
    return FORWARD_TO_REVERSE[verb]
  }

  // Check if this is already a reversed verb (ends with 'By')
  if (verb in REVERSE_TO_FORWARD) {
    return REVERSE_TO_FORWARD[verb]
  }

  // Check if verb ends with 'By' - try to find its forward form
  if (verb.endsWith('By')) {
    // Check if there's a known forward form
    const forwardVerb = REVERSE_TO_FORWARD[verb]
    if (forwardVerb) {
      return forwardVerb
    }
    // Otherwise just return the base (customActionBy -> customAction)
    return verb.slice(0, -2)
  }

  // Apply standard verb transformation for third person singular verbs
  // (verbs ending in 's' like manages, owns, creates, reviews, employs, contains)
  if (verb.endsWith('s') && verb.length > 2) {
    // Remove trailing 's' to get base form, then add 'edBy'
    // manages -> manage -> managedBy
    // owns -> own -> ownedBy
    // creates -> create -> createdBy
    const base = verb.slice(0, -1)
    return base + 'dBy'
  }

  // For other verbs, just add 'By' suffix
  return verb + 'By'
}

/**
 * Derives a verb from a field name.
 *
 * Examples:
 * - manager -> manages (implies the manager manages this entity)
 * - owner -> owns
 * - creator -> creates
 */
export function deriveVerbFromFieldName(fieldName: string): string {
  const fieldToVerb: Record<string, string> = {
    manager: 'manages',
    owner: 'owns',
    creator: 'creates',
    reviewer: 'reviews',
    employer: 'employs',
    parent: 'parent_of',
    child: 'child_of',
    assignee: 'assigns',
  }

  return fieldToVerb[fieldName] || fieldName
}
