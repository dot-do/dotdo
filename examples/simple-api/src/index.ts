/**
 * Example: Simple JSON API with dotdo
 *
 * Minimal overhead - just the data with $type and $id:
 *
 * GET /my-service/users/
 * [
 *   { "$type": "User", "$id": "alice", "name": "Alice", "role": "admin" },
 *   { "$type": "User", "$id": "bob", "name": "Bob", "role": "member" }
 * ]
 *
 * GET /my-service/users/alice
 * { "$type": "User", "$id": "alice", "name": "Alice", "role": "admin" }
 *
 * No envelope, no links, no actions - perfect for:
 * - Mobile apps that don't need HATEOAS
 * - Internal microservices
 * - High-performance scenarios
 */

import { DO } from 'dotdo'

export class MyService extends DO {
  static readonly $type = 'MyService'
}

// Re-export the simple worker as default
export { default } from 'dotdo/workers/simple'
