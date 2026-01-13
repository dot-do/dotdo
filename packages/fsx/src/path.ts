/**
 * Path utilities for fsx.do - POSIX-style path manipulation
 *
 * Re-exports from @dotdo/path-utils for backwards compatibility.
 * @see @dotdo/path-utils for the canonical implementation.
 */

export {
  // Constants
  sep,
  delimiter,

  // Functions
  normalize,
  resolve,
  basename,
  dirname,
  join,
  isAbsolute,
  extname,
  parse,
  format,
  relative,

  // Types
  type ParsedPath,
} from '@dotdo/path-utils'
