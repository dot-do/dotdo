/**
 * Cross-DO Analytics Module
 *
 * Provides DuckDB-style querying capabilities across all Durable Object states
 * stored in Iceberg format. This enables analytics, debugging, and administrative
 * capabilities across the entire DO fleet.
 *
 * Features:
 * - Query single DO state by ID
 * - Query across all DOs (wildcard)
 * - Aggregations (COUNT, SUM, AVG, MIN, MAX)
 * - GROUP BY with HAVING
 * - Time-travel queries to historical snapshots
 * - Schema inference and drift detection
 *
 * @module db/do-analytics
 *
 * @example Query single DO
 * ```typescript
 * import { CrossDOQuery } from 'db/do-analytics'
 *
 * const query = new CrossDOQuery(env.R2_BUCKET)
 *
 * const result = await query.execute({
 *   doId: 'do-123',
 *   table: 'orders',
 *   where: { status: 'pending' },
 *   orderBy: [{ column: 'created_at', direction: 'desc' }],
 *   limit: 100
 * })
 * ```
 *
 * @example Query across all DOs
 * ```typescript
 * // All orders across all DOs
 * const allOrders = await query.execute({ table: 'orders' })
 *
 * // Each row includes _do_id to identify source DO
 * console.log(allOrders.rows[0]._do_id) // 'do-123'
 * ```
 *
 * @example Aggregations
 * ```typescript
 * // Total revenue by DO
 * const revenue = await query.aggregate({
 *   table: 'orders',
 *   groupBy: ['_do_id'],
 *   aggregations: [
 *     { function: 'SUM', column: 'amount', alias: 'total' },
 *     { function: 'COUNT', alias: 'order_count' }
 *   ]
 * })
 * ```
 *
 * @example Time-travel query
 * ```typescript
 * // Query historical snapshot
 * const historicalData = await query.execute({
 *   doId: 'do-123',
 *   table: 'orders',
 *   snapshotId: 'snap-abc'
 * })
 * ```
 *
 * @example Schema discovery
 * ```typescript
 * // List all tables
 * const tables = await query.listTables()
 *
 * // Get table schema
 * const schema = await query.getTableSchema('orders')
 *
 * // Detect schema drift
 * const drift = await query.detectSchemaDrift('orders')
 * if (drift.hasDrift) {
 *   console.log('Schema inconsistencies found:', drift.variants)
 * }
 * ```
 */

export { CrossDOQuery } from './cross-do-query'
