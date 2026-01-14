import { defineNoun } from '../types'
import { ProductSchema } from 'digital-products'

export const Product = defineNoun({
  noun: 'Product',
  plural: 'Products',
  $type: 'https://schema.org.ai/Product',
  schema: ProductSchema,
})
