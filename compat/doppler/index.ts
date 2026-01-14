/**
 * @dotdo/doppler - Doppler Secrets Management Compat Layer
 *
 * API-compatible SDK for Doppler secrets management platform.
 * Backed by Durable Objects for persistence and edge execution.
 *
 * @see https://docs.doppler.com/reference/api
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Doppler Config represents an environment configuration (dev, staging, prod)
 * or a branch config that inherits from a root config.
 */
export interface Config {
  /** Config name (e.g., 'dev', 'staging', 'prd', 'dev_feature_branch') */
  name: string
  /** Project identifier */
  project: string
  /** Environment identifier (e.g., 'development', 'staging', 'production') */
  environment: string
  /** Whether this is a root config (true) or branch config (false) */
  root: boolean
  /** Whether the config is locked (prevents modifications) */
  locked?: boolean
  /** Timestamp of first secret fetch */
  initial_fetch_at?: string
  /** Timestamp of most recent secret fetch */
  last_fetch_at?: string
  /** Creation timestamp */
  created_at?: string
}

// Config List
export interface ConfigListOptions {
  project: string
  environment?: string
  root?: boolean
  page?: number
  per_page?: number
}

export interface ConfigListResponse {
  configs: Config[]
  page?: number
  per_page?: number
  total?: number
}

// Config Get
export interface ConfigGetOptions {
  project: string
  config: string
}

export interface ConfigGetResponse {
  config: Config
}

// Config Create
export interface ConfigCreateOptions {
  project: string
  environment: string
  name: string
}

export interface ConfigCreateResponse {
  config: Config
}

// Config Update
export interface ConfigUpdateOptions {
  project: string
  config: string
  name?: string
}

export interface ConfigUpdateResponse {
  config: Config
}

// Config Delete
export interface ConfigDeleteOptions {
  project: string
  config: string
}

export interface ConfigDeleteResponse {
  success: boolean
}

// Config Clone
export interface ConfigCloneOptions {
  project: string
  config: string
  name: string
}

export interface ConfigCloneResponse {
  config: Config
}

// Config Lock
export interface ConfigLockOptions {
  project: string
  config: string
}

export interface ConfigLockResponse {
  config: Config
}

// Config Unlock
export interface ConfigUnlockOptions {
  project: string
  config: string
}

export interface ConfigUnlockResponse {
  config: Config
}

// =============================================================================
// Config Logs (Audit/History)
// =============================================================================

export interface ConfigLogDiff {
  name: string
  added?: string
  removed?: string
}

export interface ConfigLogUser {
  name: string
  email?: string
}

export interface ConfigLog {
  id: string
  config: string
  project: string
  created_at?: string
  user?: ConfigLogUser
  diff?: ConfigLogDiff[]
  secrets?: Record<string, string>
  rollback?: boolean
}

export interface ConfigLogListOptions {
  project: string
  config: string
  page?: number
  per_page?: number
}

export interface ConfigLogListResponse {
  logs: ConfigLog[]
  page?: number
  per_page?: number
}

export interface ConfigLogGetOptions {
  project: string
  config: string
  log: string
}

export interface ConfigLogGetResponse {
  log: ConfigLog
}

export interface ConfigLogRollbackOptions {
  project: string
  config: string
  log: string
}

export interface ConfigLogRollbackResponse {
  success: boolean
}

// =============================================================================
// Client
// =============================================================================

export interface DopplerClientOptions {
  token: string
  baseUrl?: string
  apiVersion?: string
  timeout?: number
}

export interface DopplerClient {
  token: string
  baseUrl: string
  apiVersion: string
  timeout?: number
  configs: ConfigsAPI
  configLogs: ConfigLogsAPI
  secrets: SecretsAPI
}

export interface ConfigsAPI {
  list(options: ConfigListOptions): Promise<ConfigListResponse>
  get(options: ConfigGetOptions): Promise<ConfigGetResponse>
  create(options: ConfigCreateOptions): Promise<ConfigCreateResponse>
  update(options: ConfigUpdateOptions): Promise<ConfigUpdateResponse>
  delete(options: ConfigDeleteOptions): Promise<ConfigDeleteResponse>
  clone(options: ConfigCloneOptions): Promise<ConfigCloneResponse>
  lock(options: ConfigLockOptions): Promise<ConfigLockResponse>
  unlock(options: ConfigUnlockOptions): Promise<ConfigUnlockResponse>
  listTrustedIps(options: { project: string; config: string }): Promise<{ ips: string[] }>
  addTrustedIp(options: { project: string; config: string; ip: string }): Promise<{ ips: string[] }>
  removeTrustedIp(options: { project: string; config: string; ip: string }): Promise<{ ips: string[] }>
  listInheritable(options: { project: string; config: string }): Promise<{ secrets: Array<{ name: string; overridden: boolean }> }>
}

export interface ConfigLogsAPI {
  list(options: ConfigLogListOptions): Promise<ConfigLogListResponse>
  get(options: ConfigLogGetOptions): Promise<ConfigLogGetResponse>
  rollback(options: ConfigLogRollbackOptions): Promise<ConfigLogRollbackResponse>
}

export interface SecretsAPI {
  list(options: { project: string; config: string }): Promise<{ secrets: Record<string, string> }>
  set(options: { project: string; config: string; secrets: Record<string, string> }): Promise<{ secrets: Record<string, string> }>
}

// =============================================================================
// Factory Functions (NOT IMPLEMENTED - TDD RED PHASE)
// =============================================================================

/**
 * Create a Doppler client with the given options.
 * @throws {Error} Not implemented - TDD RED phase
 */
export function createClient(_options: DopplerClientOptions): DopplerClient {
  throw new Error('Not implemented - TDD RED phase')
}

/**
 * Create a test client with mock data for testing.
 * @throws {Error} Not implemented - TDD RED phase
 */
export function createTestClient(_mockData?: {
  configs?: Partial<Config>[]
  secrets?: Record<string, Record<string, string>>
  configLogs?: Partial<ConfigLog>[]
  trustedIps?: Record<string, string[]>
  rateLimit?: boolean
  networkError?: boolean
}): DopplerClient {
  throw new Error('Not implemented - TDD RED phase')
}

/**
 * Clear all test state.
 * @throws {Error} Not implemented - TDD RED phase
 */
export function _clear(): void {
  // No-op for now, will be implemented in GREEN phase
}
