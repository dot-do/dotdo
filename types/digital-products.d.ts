/**
 * Type declarations for digital-products module
 *
 * Digital product schema types for apps and sites.
 *
 * @module digital-products
 */

import { z } from 'zod'

declare module 'digital-products' {
  /**
   * App schema for digital applications
   */
  export const AppSchema: z.ZodObject<{
    $id: z.ZodString
    $type: z.ZodLiteral<'https://schema.org.ai/App'>
    name: z.ZodString
    description: z.ZodOptional<z.ZodString>
    version: z.ZodOptional<z.ZodString>
    platforms: z.ZodOptional<z.ZodArray<z.ZodString>>
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>
  }>

  /**
   * Site schema for websites
   */
  export const SiteSchema: z.ZodObject<{
    $id: z.ZodString
    $type: z.ZodLiteral<'https://schema.org.ai/Site'>
    name: z.ZodString
    description: z.ZodOptional<z.ZodString>
    url: z.ZodOptional<z.ZodString>
    domain: z.ZodOptional<z.ZodString>
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>
  }>

  export type App = z.infer<typeof AppSchema>
  export type Site = z.infer<typeof SiteSchema>
}
