/**
 * Search Tool Example
 *
 * Demonstrates the MCP search tool for querying Things in a DO
 */

import { createMCPServer } from '../server'
import { createThingsStore } from '@dotdo/db/things'
import { createSearchTool } from '../search'

async function main() {
  // Create a Things store and populate with sample data
  const store = createThingsStore()

  console.log('Seeding sample data...')
  await store.create({ $type: 'User', name: 'Alice Smith', email: 'alice@example.com', role: 'admin', age: 30 })
  await store.create({ $type: 'User', name: 'Bob Jones', email: 'bob@example.com', role: 'user', age: 25 })
  await store.create({ $type: 'User', name: 'Charlie Brown', email: 'charlie@example.com', role: 'user', age: 35 })
  await store.create({ $type: 'Order', total: 100, status: 'pending', userId: 'alice-id' })
  await store.create({ $type: 'Order', total: 200, status: 'completed', userId: 'bob-id' })
  await store.create({ $type: 'Product', name: 'Widget', price: 29.99, category: 'tools' })
  await store.create({ $type: 'Product', name: 'Gadget', price: 49.99, category: 'electronics' })

  // Create MCP server with search tool
  const server = createMCPServer({ name: 'dotdo-search-example', version: '1.0.0' })
  server.addTool(createSearchTool(store))

  console.log('\n--- Example 1: Search all Users ---')
  const req1 = new Request('http://localhost/mcp/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'search',
      arguments: { $type: 'User' }
    })
  })
  const res1 = await server.fetch(req1)
  const result1 = await res1.json()
  console.log(JSON.stringify(result1, null, 2))

  console.log('\n--- Example 2: Search Users by role ---')
  const req2 = new Request('http://localhost/mcp/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'search',
      arguments: {
        $type: 'User',
        where: { role: 'admin' }
      }
    })
  })
  const res2 = await server.fetch(req2)
  const result2 = await res2.json()
  console.log(JSON.stringify(result2, null, 2))

  console.log('\n--- Example 3: Full-text search ---')
  const req3 = new Request('http://localhost/mcp/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'search',
      arguments: {
        $type: 'User',
        query: 'alice'
      }
    })
  })
  const res3 = await server.fetch(req3)
  const result3 = await res3.json()
  console.log(JSON.stringify(result3, null, 2))

  console.log('\n--- Example 4: Paginated search with sorting ---')
  const req4 = new Request('http://localhost/mcp/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'search',
      arguments: {
        $type: 'User',
        orderBy: 'age',
        order: 'asc',
        limit: 2,
        offset: 0
      }
    })
  })
  const res4 = await server.fetch(req4)
  const result4 = await res4.json()
  console.log(JSON.stringify(result4, null, 2))

  console.log('\n--- Example 5: Field selection ---')
  const req5 = new Request('http://localhost/mcp/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'search',
      arguments: {
        $type: 'User',
        select: ['name', 'email']
      }
    })
  })
  const res5 = await server.fetch(req5)
  const result5 = await res5.json()
  console.log(JSON.stringify(result5, null, 2))

  console.log('\n--- Example 6: Combined filters ---')
  const req6 = new Request('http://localhost/mcp/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'search',
      arguments: {
        $type: 'User',
        where: { role: 'user' },
        query: 'example.com',
        orderBy: 'age',
        order: 'desc',
        limit: 1
      }
    })
  })
  const res6 = await server.fetch(req6)
  const result6 = await res6.json()
  console.log(JSON.stringify(result6, null, 2))
}

main().catch(console.error)
