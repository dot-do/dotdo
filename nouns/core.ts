import { z } from 'zod'
import { defineNoun } from './types'

/** Base Thing schema - all nouns extend this */
export const ThingSchema = z.object({
  $id: z.string(),
  $type: z.string(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
})

export const Thing = defineNoun({
  noun: 'Thing',
  plural: 'Things',
  $type: 'https://schema.org.ai/Thing',
  schema: ThingSchema,
})
