import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * Site schema for websites (Zod v4 compatible)
 */
export const SiteSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Site'),
  name: z.string(),
  description: z.string().optional(),
  url: z.string().optional(),
  domain: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type SiteType = z.infer<typeof SiteSchema>

export const Site = defineNoun({
  noun: 'Site',
  plural: 'Sites',
  $type: 'https://schema.org.ai/Site',
  schema: SiteSchema,
})
