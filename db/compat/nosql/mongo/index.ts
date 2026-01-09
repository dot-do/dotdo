/**
 * @dotdo/mongo
 * MongoDB SDK compatibility layer
 * Drop-in replacement for mongodb driver backed by DO SQLite with JSON storage.
 *
 * @see https://www.mongodb.com/docs/drivers/node/current/
 *
 * @example
 * ```typescript
 * import { createClient, ObjectId } from '@dotdo/compat/mongo'
 *
 * const client = createClient('mongodb://localhost:27017', {
 *   doNamespace: env.MONGO,
 * })
 *
 * const db = client.db('mydb')
 * const collection = db.collection('users')
 *
 * // Insert
 * const result = await collection.insertOne({
 *   name: 'John',
 *   email: 'john@example.com'
 * })
 *
 * // Find
 * const user = await collection.findOne({ _id: result.insertedId })
 *
 * // Query
 * const users = await collection.find({ age: { $gt: 18 } }).toArray()
 * ```
 */

// Re-export types
export * from './types'

// Re-export implementation
export * from './mongo'
