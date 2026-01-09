import { type Config, type CollectionConfig } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'

export { type Config, type CollectionConfig } from 'payload'

/**
 * Options for configuring a Payload CMS instance
 */
export interface PayloadOptions {
  /** Array of collection configurations */
  collections: CollectionConfig[]
  /** Admin panel configuration */
  admin?: {
    /** Slug of the user collection for authentication */
    user?: string
    /** Metadata for the admin panel */
    meta?: { titleSuffix?: string; icons?: { rel: string; url: string }[] }
  }
  /** Secret key for encryption (defaults to PAYLOAD_SECRET env var or 'dev-secret') */
  secret?: string
  /** SQLite database URL (defaults to 'file:./db.sqlite') */
  db?: string
}

const DEFAULT_SECRET = 'dev-secret'

/**
 * Define a Payload CMS configuration.
 * Returns a Config object that can be passed to buildConfig.
 *
 * @param options - Configuration options for Payload
 * @returns A Payload Config object (input to buildConfig)
 *
 * @example
 * ```ts
 * import { definePayload } from '@dotdo/payload'
 * import { buildConfig } from 'payload'
 *
 * export default buildConfig(definePayload({
 *   collections: [Users, Posts],
 * }))
 * ```
 */
export function definePayload(options: PayloadOptions): Config {
  const { collections, admin, secret, db } = options
  const userCollection = collections.find(c => 'auth' in c && c.auth)

  const resolvedSecret = secret ?? process.env.PAYLOAD_SECRET

  const isProduction = process.env.NODE_ENV === 'production'

  if (isProduction && !resolvedSecret) {
    throw new Error(
      'PAYLOAD_SECRET is required in production. ' +
      'Set the PAYLOAD_SECRET environment variable or pass a secret to definePayload().'
    )
  }

  const finalSecret = resolvedSecret ?? DEFAULT_SECRET

  if (!isProduction && finalSecret === DEFAULT_SECRET) {
    console.warn(
      'Warning: Using default secret for development. ' +
      'Set PAYLOAD_SECRET environment variable for production.'
    )
  }

  return {
    admin: {
      user: admin?.user ?? userCollection?.slug ?? 'users',
      meta: {
        titleSuffix: ' | .do',
        ...admin?.meta,
      },
    },
    collections,
    editor: lexicalEditor(),
    db: sqliteAdapter({ client: { url: db ?? 'file:./db.sqlite' } }),
    secret: finalSecret,
  }
}

/**
 * Helper function to define a collection with type inference.
 *
 * @param config - The collection configuration
 * @returns The same configuration with proper typing
 *
 * @example
 * ```ts
 * import { collection } from '@dotdo/payload'
 *
 * export const Users = collection({
 *   slug: 'users',
 *   auth: true,
 *   fields: [],
 * })
 * ```
 */
export function collection<T extends CollectionConfig>(config: T): T {
  return config
}
