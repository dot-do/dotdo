/**
 * Tools Domain Nouns
 *
 * This module exports noun definitions for the tools domain:
 * - Tool: Generic capabilities that workers can use
 * - Integration: External service connections
 * - Capability: Internal system permissions and abilities
 *
 * All nouns use Zod schemas from the digital-tools package
 * for runtime validation.
 */

export { Tool } from './Tool'
export { Integration } from './Integration'
export { Capability } from './Capability'
