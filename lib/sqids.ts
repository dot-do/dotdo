import Sqids from 'sqids'

/**
 * Tag enum for self-describing sqid references
 *
 * Tags are grouped by purpose:
 * - Core reference tags (1-10): NS, TYPE, THING, BRANCH, VERSION
 * - 5W+H tags (11-20): ACTOR, VERB, TIMESTAMP, LOCATION
 * - HOW detail tags (21-30): METHOD, MODEL, CHANNEL, TOOL
 * - Experiment tags (31-40): EXPERIMENT, VARIANT, METRIC
 */
export enum Tag {
  // Core reference tags (1-10)
  NS = 1,
  TYPE = 2,
  THING = 3,
  BRANCH = 4,
  VERSION = 5,

  // 5W+H tags (11-20)
  ACTOR = 11,
  VERB = 12,
  TIMESTAMP = 13,
  LOCATION = 14,

  // HOW detail tags (21-30)
  METHOD = 21,
  MODEL = 22,
  CHANNEL = 23,
  TOOL = 24,

  // Experiment tags (31-40)
  EXPERIMENT = 31,
  VARIANT = 32,
  METRIC = 33,
}

// Reverse lookup: tag value -> tag name
const tagNames: Record<number, string> = {
  [Tag.NS]: 'NS',
  [Tag.TYPE]: 'TYPE',
  [Tag.THING]: 'THING',
  [Tag.BRANCH]: 'BRANCH',
  [Tag.VERSION]: 'VERSION',
  [Tag.ACTOR]: 'ACTOR',
  [Tag.VERB]: 'VERB',
  [Tag.TIMESTAMP]: 'TIMESTAMP',
  [Tag.LOCATION]: 'LOCATION',
  [Tag.METHOD]: 'METHOD',
  [Tag.MODEL]: 'MODEL',
  [Tag.CHANNEL]: 'CHANNEL',
  [Tag.TOOL]: 'TOOL',
  [Tag.EXPERIMENT]: 'EXPERIMENT',
  [Tag.VARIANT]: 'VARIANT',
  [Tag.METRIC]: 'METRIC',
}

// Singleton sqids instance
const sqidsInstance = new Sqids()

/**
 * Encode tag-value pairs into a sqid string
 *
 * @param values - Array of [tag, value, ...] pairs (must have even length)
 * @returns URL-safe sqid string
 * @throws Error if array is empty or has odd length
 *
 * @example
 * sqids.encode([Tag.THING, 42])
 * sqids.encode([Tag.THING, 42, Tag.BRANCH, 7])
 */
function encode(values: number[]): string {
  if (values.length === 0) {
    throw new Error('Cannot encode empty array')
  }
  if (values.length % 2 !== 0) {
    throw new Error('Values array must have even length (tag-value pairs)')
  }
  return sqidsInstance.encode(values)
}

/**
 * Decode a sqid string into a self-describing object
 *
 * @param id - The sqid string to decode
 * @returns Object with tag names as keys and values as numbers
 *
 * @example
 * sqids.decode('abc123') // { THING: 42, BRANCH: 7 }
 */
function decode(id: string): Record<string, number> {
  if (!id) {
    return {}
  }

  const numbers = sqidsInstance.decode(id)

  if (numbers.length === 0 || numbers.length % 2 !== 0) {
    return {}
  }

  const result: Record<string, number> = {}

  for (let i = 0; i < numbers.length; i += 2) {
    const tag = numbers[i]!
    const value = numbers[i + 1]!
    const tagName = tagNames[tag]

    if (tagName) {
      result[tagName] = value
    }
  }

  return result
}

/**
 * Sqids utilities for tagged field encoding/decoding
 */
export const sqids = {
  encode,
  decode,
}
