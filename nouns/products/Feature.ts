import { defineNoun } from '../types'
import { FeatureSchema } from 'digital-products'

export const Feature = defineNoun({
  noun: 'Feature',
  plural: 'Features',
  $type: 'https://schema.org.ai/Feature',
  schema: FeatureSchema,
})
