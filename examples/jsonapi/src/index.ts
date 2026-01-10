/**
 * Example: JSON:API with dotdo
 *
 * This gives you a jsonapi.org compliant REST API:
 *
 * GET /my-app/articles/
 * {
 *   "jsonapi": { "version": "1.1" },
 *   "data": [
 *     {
 *       "type": "Article",
 *       "id": "hello-world",
 *       "attributes": {
 *         "title": "Hello World",
 *         "body": "..."
 *       },
 *       "relationships": {
 *         "author": {
 *           "links": { "related": "/my-app/articles/hello-world/author" }
 *         }
 *       },
 *       "links": { "self": "/my-app/articles/hello-world" }
 *     }
 *   ],
 *   "links": {
 *     "self": "/my-app/articles",
 *     "first": "/my-app/articles?page[number]=1",
 *     "next": "/my-app/articles?page[number]=2"
 *   }
 * }
 *
 * Supports:
 * - Sparse fieldsets: ?fields[Article]=title,body
 * - Includes: ?include=author,comments
 * - Pagination: ?page[number]=2&page[size]=10
 */

import { DO } from 'dotdo'

export class MyApp extends DO {
  static readonly $type = 'MyApp'

  // Your domain logic
}

// Re-export the JSON:API worker as default
export { default } from 'dotdo/workers/jsonapi'
