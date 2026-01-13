/**
 * Simple DO RPC Test
 *
 * Tests Workers RPC with a minimal DO that directly extends DurableObject.
 * This verifies Workers RPC works at all before testing with DOBase.
 *
 * @module objects/tests/simple-do-rpc.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

interface SimpleStub extends DurableObjectStub {
  createThing(type: string, name: string): Promise<{ id: string; type: string; name: string }>
  getThing(id: string): Promise<{ id: string; type: string; name: string } | null>
  listThings(): Promise<Array<{ id: string; type: string; name: string }>>
  echo(value: string): Promise<string>
  ns: Promise<string>
}

let testCounter = 0
function uniqueNs(): string {
  return `simple-${Date.now()}-${++testCounter}`
}

describe('Simple DO RPC', () => {
  let stub: SimpleStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { SIMPLE_DO: DurableObjectNamespace }).SIMPLE_DO.idFromName(ns)
    stub = (env as { SIMPLE_DO: DurableObjectNamespace }).SIMPLE_DO.get(id) as SimpleStub
  })

  it('calls echo RPC method', async () => {
    const result = await stub.echo('hello')
    expect(result).toBe('Echo: hello')
  })

  it('creates a thing via RPC', async () => {
    const result = await stub.createThing('Customer', 'Alice')
    expect(result.id).toBeDefined()
    expect(result.type).toBe('Customer')
    expect(result.name).toBe('Alice')
  })

  it('gets a thing via RPC', async () => {
    const created = await stub.createThing('Product', 'Widget')
    const retrieved = await stub.getThing(created.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.name).toBe('Widget')
  })

  it('lists things via RPC', async () => {
    await stub.createThing('Order', 'Order 1')
    await stub.createThing('Order', 'Order 2')
    const list = await stub.listThings()
    expect(list.length).toBeGreaterThanOrEqual(2)
  })

  it('accesses ns property via RPC', async () => {
    const doNs = await stub.ns
    expect(doNs).toBe('simple-do')
  })
})
