// Custom test assertion helpers for @dotdo
// See do-xewn - Add custom assertion helpers for testing

import { expect } from 'vitest'
import type { Thing, BaseThing } from '../db/things'
import type { Event, BaseEvent } from '../db/events'
import type { Relationship, BaseRelationship } from '../db/relationships'
import type { RPCError, RPCErrorCode } from '../rpc/errors'
import type { HATEOASResponse, Link } from '../api/hateoas'

// ============================================================================
// Entity Assertions
// ============================================================================

/**
 * Assert that a value is a valid Thing entity with required system fields.
 *
 * Validates:
 * - $id is a non-empty string
 * - $type is a non-empty string
 * - $createdAt is a valid timestamp (number > 0)
 * - $updatedAt is a valid timestamp (number > 0)
 * - $updatedAt >= $createdAt
 *
 * @example
 * ```typescript
 * const result = await doInstance.things.create({ $type: 'Customer', name: 'Alice' })
 * expectValidEntity(result)
 * expect(result.$type).toBe('Customer')
 * expect(result.name).toBe('Alice')
 * ```
 */
export function expectValidEntity(thing: unknown): asserts thing is Thing {
  expect(thing).toBeDefined()
  expect(thing).not.toBeNull()
  expect(typeof thing).toBe('object')

  const obj = thing as Record<string, unknown>

  // Required system fields
  expect(obj.$id).toBeDefined()
  expect(typeof obj.$id).toBe('string')
  expect((obj.$id as string).length).toBeGreaterThan(0)

  expect(obj.$type).toBeDefined()
  expect(typeof obj.$type).toBe('string')
  expect((obj.$type as string).length).toBeGreaterThan(0)

  expect(obj.$createdAt).toBeDefined()
  expect(typeof obj.$createdAt).toBe('number')
  expect(obj.$createdAt).toBeGreaterThan(0)

  expect(obj.$updatedAt).toBeDefined()
  expect(typeof obj.$updatedAt).toBe('number')
  expect(obj.$updatedAt).toBeGreaterThan(0)

  // $updatedAt should be >= $createdAt
  expect(obj.$updatedAt).toBeGreaterThanOrEqual(obj.$createdAt as number)
}

/**
 * Assert that a value is a valid Event with required system fields.
 *
 * Validates:
 * - $id is a non-empty string
 * - type is a non-empty string
 * - $timestamp is a valid timestamp (number > 0)
 * - payload is defined (can be any JSON value)
 *
 * @example
 * ```typescript
 * const event = await eventsStore.emit({ type: 'Order.placed', payload: { total: 100 } })
 * expectValidEvent(event)
 * expect(event.type).toBe('Order.placed')
 * ```
 */
export function expectValidEvent(event: unknown): asserts event is Event {
  expect(event).toBeDefined()
  expect(event).not.toBeNull()
  expect(typeof event).toBe('object')

  const obj = event as Record<string, unknown>

  // Required system fields
  expect(obj.$id).toBeDefined()
  expect(typeof obj.$id).toBe('string')
  expect((obj.$id as string).length).toBeGreaterThan(0)

  expect(obj.type).toBeDefined()
  expect(typeof obj.type).toBe('string')
  expect((obj.type as string).length).toBeGreaterThan(0)

  expect(obj.$timestamp).toBeDefined()
  expect(typeof obj.$timestamp).toBe('number')
  expect(obj.$timestamp).toBeGreaterThan(0)

  // Payload must be present (can be any JSON value including null)
  expect('payload' in obj).toBe(true)
}

/**
 * Assert that a value is a valid Relationship with required fields.
 *
 * Validates:
 * - subject is a non-empty string
 * - predicate is a non-empty string
 * - object is a non-empty string
 * - $createdAt is a valid timestamp (number > 0)
 *
 * @example
 * ```typescript
 * const rel = await relationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
 * expectValidRelationship(rel)
 * expect(rel.predicate).toBe('owns')
 * ```
 */
export function expectValidRelationship(rel: unknown): asserts rel is Relationship {
  expect(rel).toBeDefined()
  expect(rel).not.toBeNull()
  expect(typeof rel).toBe('object')

  const obj = rel as Record<string, unknown>

  // Required fields
  expect(obj.subject).toBeDefined()
  expect(typeof obj.subject).toBe('string')
  expect((obj.subject as string).length).toBeGreaterThan(0)

  expect(obj.predicate).toBeDefined()
  expect(typeof obj.predicate).toBe('string')
  expect((obj.predicate as string).length).toBeGreaterThan(0)

  expect(obj.object).toBeDefined()
  expect(typeof obj.object).toBe('string')
  expect((obj.object as string).length).toBeGreaterThan(0)

  expect(obj.$createdAt).toBeDefined()
  expect(typeof obj.$createdAt).toBe('number')
  expect(obj.$createdAt).toBeGreaterThan(0)
}

// ============================================================================
// RPC Assertions
// ============================================================================

/**
 * Assert that an error is an RPCError with a specific error code.
 *
 * Validates:
 * - error is an instance of Error
 * - error has the name 'RPCError' or a subclass name
 * - error has the expected code
 * - error has a message property
 *
 * @example
 * ```typescript
 * try {
 *   await rpcClient.someMethod()
 * } catch (error) {
 *   expectRPCError(error, 'NOT_FOUND')
 *   expect(error.message).toContain('Resource not found')
 * }
 * ```
 */
export function expectRPCError(error: unknown, code: string): asserts error is RPCError {
  expect(error).toBeDefined()
  expect(error).toBeInstanceOf(Error)

  const err = error as Error & { code?: string; details?: unknown; httpStatus?: number }

  // Should have standard Error properties
  expect(err.message).toBeDefined()
  expect(typeof err.message).toBe('string')

  // Should have RPC-specific code
  expect(err.code).toBeDefined()
  expect(err.code).toBe(code)

  // Name should indicate RPC error type
  expect(err.name).toBeDefined()
  expect(typeof err.name).toBe('string')
}

/**
 * Assert that an error is an RPCError of a specific type (by name).
 *
 * @example
 * ```typescript
 * expectRPCErrorType(error, 'NotFoundError')
 * expectRPCErrorType(error, 'ValidationError')
 * ```
 */
export function expectRPCErrorType(error: unknown, typeName: string): asserts error is RPCError {
  expect(error).toBeDefined()
  expect(error).toBeInstanceOf(Error)

  const err = error as Error
  expect(err.name).toBe(typeName)
}

// ============================================================================
// Response Assertions
// ============================================================================

/**
 * Assert that a Response is valid JSON and return the parsed body.
 *
 * Validates:
 * - Response status is successful (2xx) unless expectedStatus is provided
 * - Response content-type is application/json
 * - Response body can be parsed as JSON
 *
 * @example
 * ```typescript
 * const response = await doInstance.fetch(request)
 * const body = await expectJsonResponse(response)
 * expect(body.name).toBe('Alice')
 * ```
 */
export async function expectJsonResponse(
  response: Response,
  expectedStatus?: number
): Promise<unknown> {
  expect(response).toBeDefined()
  expect(response).toBeInstanceOf(Response)

  if (expectedStatus !== undefined) {
    expect(response.status).toBe(expectedStatus)
  } else {
    // Default: expect success status (2xx)
    expect(response.ok).toBe(true)
  }

  // Verify content type
  const contentType = response.headers.get('content-type')
  expect(contentType).toBeDefined()
  expect(contentType).toContain('application/json')

  // Parse and return body
  const body = await response.json()
  return body
}

/**
 * Assert that a Response is a valid HATEOAS response with data and _links.
 *
 * Validates:
 * - Response is valid JSON
 * - Response has 'data' property
 * - Response has '_links' property
 * - _links contains at least a 'self' link
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/users/123')
 * const hateoas = await expectHATEOASResponse(response)
 * expect(hateoas.data.name).toBe('Alice')
 * expect(hateoas._links.self.href).toContain('/users/123')
 * ```
 */
export async function expectHATEOASResponse<T = unknown>(
  response: Response,
  expectedStatus?: number
): Promise<HATEOASResponse<T>> {
  const body = await expectJsonResponse(response, expectedStatus)

  expect(body).toBeDefined()
  expect(typeof body).toBe('object')

  const hateoasBody = body as Record<string, unknown>

  // Must have data property
  expect('data' in hateoasBody).toBe(true)

  // Must have _links property
  expect('_links' in hateoasBody).toBe(true)
  expect(typeof hateoasBody._links).toBe('object')

  const links = hateoasBody._links as Record<string, unknown>

  // Should have at least a self link
  expect('self' in links).toBe(true)

  const selfLink = links.self as Record<string, unknown>
  expect(selfLink.href).toBeDefined()
  expect(typeof selfLink.href).toBe('string')

  return hateoasBody as unknown as HATEOASResponse<T>
}

/**
 * Assert that a Response is an error response with expected status.
 *
 * Validates:
 * - Response status matches expectedStatus
 * - Response body contains error information
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/users/nonexistent')
 * const error = await expectErrorResponse(response, 404)
 * expect(error.code).toBe('NOT_FOUND')
 * ```
 */
export async function expectErrorResponse(
  response: Response,
  expectedStatus: number
): Promise<{ code?: string; message: string; details?: unknown }> {
  expect(response).toBeDefined()
  expect(response.status).toBe(expectedStatus)

  const contentType = response.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    const body = await response.json()
    expect(body).toBeDefined()
    expect(typeof body).toBe('object')

    const errorBody = body as Record<string, unknown>
    expect(errorBody.message || errorBody.error).toBeDefined()

    const result: { code?: string; message: string; details?: unknown } = {
      message: (errorBody.message || errorBody.error) as string,
    }
    if (errorBody.code !== undefined) {
      result.code = errorBody.code as string
    }
    if (errorBody.details !== undefined) {
      result.details = errorBody.details
    }
    return result
  }

  // Plain text error
  const text = await response.text()
  return { message: text }
}

// ============================================================================
// Collection Assertions
// ============================================================================

/**
 * Assert that a value is a non-empty array of valid Things.
 *
 * @example
 * ```typescript
 * const things = await doInstance.things.list()
 * expectValidEntityList(things, 2)
 * ```
 */
export function expectValidEntityList(things: unknown, minLength = 1): asserts things is Thing[] {
  expect(things).toBeDefined()
  expect(Array.isArray(things)).toBe(true)

  const arr = things as unknown[]
  expect(arr.length).toBeGreaterThanOrEqual(minLength)

  // Validate each item
  for (const item of arr) {
    expectValidEntity(item)
  }
}

/**
 * Assert that a value is a non-empty array of valid Events.
 *
 * @example
 * ```typescript
 * const events = await eventsStore.query({ type: 'Order.placed' })
 * expectValidEventList(events, 1)
 * ```
 */
export function expectValidEventList(events: unknown, minLength = 1): asserts events is Event[] {
  expect(events).toBeDefined()
  expect(Array.isArray(events)).toBe(true)

  const arr = events as unknown[]
  expect(arr.length).toBeGreaterThanOrEqual(minLength)

  // Validate each item
  for (const item of arr) {
    expectValidEvent(item)
  }
}

/**
 * Assert that a value is a non-empty array of valid Relationships.
 *
 * @example
 * ```typescript
 * const rels = await relationships.find({ subject: 'user-1' })
 * expectValidRelationshipList(rels, 2)
 * ```
 */
export function expectValidRelationshipList(
  rels: unknown,
  minLength = 1
): asserts rels is Relationship[] {
  expect(rels).toBeDefined()
  expect(Array.isArray(rels)).toBe(true)

  const arr = rels as unknown[]
  expect(arr.length).toBeGreaterThanOrEqual(minLength)

  // Validate each item
  for (const item of arr) {
    expectValidRelationship(item)
  }
}

// ============================================================================
// Link Assertions
// ============================================================================

/**
 * Assert that a link object is valid with required fields.
 *
 * @example
 * ```typescript
 * const links = generateLinks('users', '123', baseUrl)
 * expectValidLink(links.self, 'self', 'GET')
 * ```
 */
export function expectValidLink(
  link: unknown,
  expectedRel?: string,
  expectedMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
): asserts link is Link {
  expect(link).toBeDefined()
  expect(typeof link).toBe('object')

  const linkObj = link as Record<string, unknown>

  // href is required
  expect(linkObj.href).toBeDefined()
  expect(typeof linkObj.href).toBe('string')
  expect((linkObj.href as string).length).toBeGreaterThan(0)

  // rel is required
  expect(linkObj.rel).toBeDefined()
  expect(typeof linkObj.rel).toBe('string')

  if (expectedRel) {
    expect(linkObj.rel).toBe(expectedRel)
  }

  if (expectedMethod) {
    expect(linkObj.method).toBe(expectedMethod)
  }
}

// ============================================================================
// Timestamp Assertions
// ============================================================================

/**
 * Assert that a timestamp is valid and within an expected range.
 *
 * @example
 * ```typescript
 * const before = Date.now()
 * const thing = await things.create({ $type: 'Test' })
 * const after = Date.now()
 * expectValidTimestamp(thing.$createdAt, before, after)
 * ```
 */
export function expectValidTimestamp(
  timestamp: unknown,
  minTime?: number,
  maxTime?: number
): asserts timestamp is number {
  expect(timestamp).toBeDefined()
  expect(typeof timestamp).toBe('number')
  expect(timestamp).toBeGreaterThan(0)

  const ts = timestamp as number

  if (minTime !== undefined) {
    expect(ts).toBeGreaterThanOrEqual(minTime)
  }

  if (maxTime !== undefined) {
    expect(ts).toBeLessThanOrEqual(maxTime)
  }
}

/**
 * Assert that a timestamp is approximately now (within tolerance).
 * Default tolerance is 5000ms (5 seconds).
 *
 * @example
 * ```typescript
 * const thing = await things.create({ $type: 'Test' })
 * expectTimestampNear(thing.$createdAt)
 * ```
 */
export function expectTimestampNear(
  timestamp: unknown,
  toleranceMs = 5000
): asserts timestamp is number {
  const now = Date.now()
  expectValidTimestamp(timestamp, now - toleranceMs, now + toleranceMs)
}

// ============================================================================
// ID Assertions
// ============================================================================

/**
 * Assert that an ID is a valid non-empty string.
 *
 * @example
 * ```typescript
 * const thing = await things.create({ $type: 'Test' })
 * expectValidId(thing.$id)
 * ```
 */
export function expectValidId(id: unknown): asserts id is string {
  expect(id).toBeDefined()
  expect(typeof id).toBe('string')
  expect((id as string).length).toBeGreaterThan(0)
}

/**
 * Assert that an ID matches a specific pattern.
 *
 * @example
 * ```typescript
 * expectIdPattern(event.$id, /^evt-/)
 * expectIdPattern(thing.$id, /^[a-z0-9]+-[a-z0-9]+$/)
 * ```
 */
export function expectIdPattern(id: unknown, pattern: RegExp): asserts id is string {
  expectValidId(id)
  expect((id as string)).toMatch(pattern)
}
