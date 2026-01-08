import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// AUTH - better-auth Drizzle schema for SQLite
// ============================================================================
//
// Schema compatible with https://www.better-auth.com/docs/adapters/drizzle
//
// Core tables:
//   - users: User accounts
//   - sessions: Authentication sessions
//   - accounts: OAuth/SSO provider links
//   - verifications: Email/password verification tokens
//
// Generate/update with: npx @better-auth/cli generate
// ============================================================================

// ============================================================================
// USERS - User accounts
// ============================================================================

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('users_email_idx').on(table.email),
])

// ============================================================================
// SESSIONS - Authentication sessions
// ============================================================================

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('sessions_user_idx').on(table.userId),
  index('sessions_token_idx').on(table.token),
])

// ============================================================================
// ACCOUNTS - OAuth/SSO provider links
// ============================================================================

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),           // ID from the SSO provider
  providerId: text('provider_id').notNull(),         // 'google', 'github', etc.
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),                        // For email/password auth
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('accounts_user_idx').on(table.userId),
  index('accounts_provider_idx').on(table.providerId, table.accountId),
])

// ============================================================================
// VERIFICATIONS - Email/password verification tokens
// ============================================================================

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),          // What's being verified (email, phone)
  value: text('value').notNull(),                    // The verification code/token
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('verifications_identifier_idx').on(table.identifier),
])
