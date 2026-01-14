import { defineNoun } from '../types'
import { SiteSchema } from 'digital-products'

export const Site = defineNoun({
  noun: 'Site',
  plural: 'Sites',
  $type: 'https://schema.org.ai/Site',
  schema: SiteSchema,
})
