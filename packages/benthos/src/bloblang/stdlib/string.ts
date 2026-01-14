/**
 * String Standard Library
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 */

export const stringFunctions = {
  uppercase: {
    call: (str: string): string => str.toUpperCase()
  },
  lowercase: {
    call: (str: string): string => str.toLowerCase()
  },
  length: {
    call: (str: string): number => str.length
  },
  trim: {
    call: (str: string): string => str.trim()
  },
  replace: {
    call: (str: string, from: unknown, to: unknown): string => {
      return str.replace(String(from), String(to))
    }
  },
  replace_all: {
    call: (str: string, from: unknown, to: unknown): string => {
      return str.split(String(from)).join(String(to))
    }
  },
  split: {
    call: (str: string, delimiter: unknown): string[] => {
      return str.split(String(delimiter))
    }
  },
  slice: {
    call: (str: string, start: unknown, end?: unknown): string => {
      return str.slice(Number(start), end !== undefined ? Number(end) : undefined)
    }
  },
  contains: {
    call: (str: string, substring: unknown): boolean => {
      return str.includes(String(substring))
    }
  },
  has_prefix: {
    call: (str: string, prefix: unknown): boolean => {
      return str.startsWith(String(prefix))
    }
  },
  has_suffix: {
    call: (str: string, suffix: unknown): boolean => {
      return str.endsWith(String(suffix))
    }
  }
}
