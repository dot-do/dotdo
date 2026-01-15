/**
 * Worker Layer Types
 *
 * Type definitions for routing, sharding, and replication patterns.
 *
 * @module workers/types
 */

/**
 * Parsed URL route info extracted from request
 */
export interface RouteInfo {
  ns: string           // Namespace (tenant)
  type?: string        // Resource type (e.g., 'customers')
  id?: string          // Resource ID (e.g., '123')
  remainingPath: string // Path after extraction
}

/**
 * Worker routing configuration
 */
export interface RoutingConfig {
  mode: 'subdomain' | 'path' | 'path-base'
  rootDomain?: string
  basePath?: string    // e.g., '/v1' for versioned APIs
}

/**
 * RPC proxy configuration
 */
export interface RPCProxyConfig {
  authenticate: (request: Request) => Promise<{ valid: boolean; identity?: string }>
  authorize?: (identity: string, method: string) => Promise<boolean>
}

/**
 * Consistent hash ring for sharding
 */
export interface ConsistentHashRing {
  addNode(node: string): void
  removeNode(node: string): void
  getNode(key: string): string
  getNodes(): string[]
  getVirtualNodeCount(): number
}

/**
 * Shard configuration
 */
export interface ShardConfig {
  shardCount: number
  virtualNodes?: number  // Default 150 for even distribution
  replicationFactor?: number
}

/**
 * Replication configuration
 */
export interface ReplicationConfig {
  mode: 'primary-replica' | 'multi-primary'
  replicaCount: number
  readPreference: 'primary' | 'replica' | 'nearest'
}

/**
 * Request intent for replication routing
 */
export type RequestIntent = 'read' | 'write' | 'unknown'

/**
 * Worker preset configuration
 */
export interface WorkerPreset {
  type: 'single' | 'typed' | 'sharded' | 'replicated'
  config: Record<string, unknown>
}

/**
 * RPC proxy instance
 */
export interface RPCProxy {
  handleRequest: (request: Request, env: unknown) => Promise<Response>
}

/**
 * Replica router instance
 */
export interface ReplicaRouter {
  route: (request: Request) => { target: 'primary' | 'replica'; replicaIndex?: number }
}

/**
 * Worker preset instance
 */
export interface WorkerPresetInstance {
  handleRequest: (request: Request, env: unknown) => Promise<Response>
  getConfig: () => Record<string, unknown>
}
