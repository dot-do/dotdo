import { defineNoun } from '../types'
import { ToolSchema } from 'digital-tools'

/**
 * Tool - A capability or utility that can be invoked to perform actions
 *
 * Tools are used by Workers (Human or Agent) to accomplish tasks.
 * They represent the fundamental building blocks that enable AI workers
 * to interact with external systems, perform actions, and access capabilities.
 *
 * @see https://schema.org.ai/Tool
 */
export const Tool = defineNoun({
  noun: 'Tool',
  plural: 'Tools',
  $type: 'https://schema.org.ai/Tool',
  schema: ToolSchema,
})
