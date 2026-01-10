/**
 * Cascade Reference Operators
 *
 * Four operators for cascade generation:
 * - `->` Forward Exact: Generate NEW entity, link TO it
 * - `~>` Forward Fuzzy: Semantic search existing, generate if not found
 * - `<-` Backward Exact: Generate NEW entity, link FROM it to this
 * - `<~` Backward Fuzzy: Semantic search related, link FROM found
 */
export const OPERATORS = {
  FORWARD_EXACT: '->',
  FORWARD_FUZZY: '~>',
  BACKWARD_EXACT: '<-',
  BACKWARD_FUZZY: '<~',
} as const

export type Operator = (typeof OPERATORS)[keyof typeof OPERATORS]
