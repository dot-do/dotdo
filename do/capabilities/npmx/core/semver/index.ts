/**
 * Semver - Semantic Versioning for Edge Runtimes
 *
 * npm-compatible semver parsing, comparison, and range resolution.
 */

// Types
export type {
  ParseOptions,
  SatisfiesOptions,
  PrereleaseIdentifier,
  BuildIdentifier,
  SemVerObject,
  ReleaseType,
  ComparatorOperator,
  CompareResult,
  Comparator,
  Range,
} from './types'

// Parsing
export { parse, valid, clean, coerce, SemVer } from './parse'

// Comparison
export {
  compare,
  rcompare,
  lt,
  gt,
  eq,
  neq,
  lte,
  gte,
  compareBuild,
  sort,
  rsort,
  diff,
  major,
  minor,
  patch,
  prerelease,
} from './compare'

// Range resolution
export {
  satisfies,
  maxSatisfying,
  minSatisfying,
  validRange,
  parseRange,
  intersects,
  clearCaches,
} from './range'
