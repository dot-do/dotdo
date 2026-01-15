/**
 * Record-Replay .map() Tests (TDD RED Phase)
 *
 * These tests define the contract for the magic .map() method that uses record-replay pattern.
 *
 * The concept: callback runs once in "recording mode" with a placeholder stub.
 * Operations are captured, sent to server, and replayed on each element.
 *
 * ```typescript
 * const names = await this.Users(['alice', 'bob']).map(user => user.name)
 * // Recording mode captures: [{ type: 'property', name: 'name' }]
 * // Server replays on each user, returns ['Alice', 'Bob']
 * ```
 *
 * @see do-nbx: RED: Record-replay .map() tests
 * @see do-1ms: GREEN: Implement record-replay .map()
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import from the module that doesn't exist yet - tests should FAIL
import {
  RecordingStub,
  createRecordingStub,
  replayRecording,
  serializeRecording,
  deserializeRecording,
  type Recording,
  type RecordedOperation,
} from '../record-replay'

// ============================================================================
// TYPE DEFINITIONS FOR TESTS
// ============================================================================

interface User {
  $id: string
  name: string
  email: string
  age: number
  profile: Profile
  getOrders(): Order[]
  getProfile(): Profile
  calculateScore(multiplier: number): number
  notify(message: string, options?: { urgent?: boolean }): void
}

interface Profile {
  bio: string
  avatar: string
  settings: Settings
  getDisplayName(): string
}

interface Settings {
  theme: string
  notifications: boolean
  getPreference(key: string): unknown
}

interface Order {
  id: string
  total: number
  status: string
}

// ============================================================================
// 1. RECORDING STUB CAPTURES PROPERTY ACCESS
// ============================================================================

describe('RecordingStub: Property Access Recording', () => {
  describe('single property access', () => {
    it('captures single property access as { type: "property", name: "..." }', () => {
      const stub = createRecordingStub<User>()

      // Access a property
      const _result = stub.name

      const recording = stub.getRecording()
      expect(recording.operations).toHaveLength(1)
      expect(recording.operations[0]).toEqual({ type: 'property', name: 'name' })
    })

    it('captures different properties independently', () => {
      const stub = createRecordingStub<User>()

      // Access first property
      const _name = stub.name
      const recording1 = stub.getRecording()

      // Create fresh stub for second property
      const stub2 = createRecordingStub<User>()
      const _email = stub2.email
      const recording2 = stub2.getRecording()

      expect(recording1.operations[0]).toEqual({ type: 'property', name: 'name' })
      expect(recording2.operations[0]).toEqual({ type: 'property', name: 'email' })
    })

    it('captures numeric property access (array index style)', () => {
      const stub = createRecordingStub<User[]>()

      const _item = stub[0]

      const recording = stub.getRecording()
      expect(recording.operations[0]).toEqual({ type: 'property', name: '0' })
    })
  })

  describe('nested property access', () => {
    it('captures chained property access: stub.profile.bio', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.profile.bio

      const recording = stub.getRecording()
      expect(recording.operations).toHaveLength(2)
      expect(recording.operations[0]).toEqual({ type: 'property', name: 'profile' })
      expect(recording.operations[1]).toEqual({ type: 'property', name: 'bio' })
    })

    it('captures deeply nested property access: stub.profile.settings.theme', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.profile.settings.theme

      const recording = stub.getRecording()
      expect(recording.operations).toHaveLength(3)
      expect(recording.operations[0]).toEqual({ type: 'property', name: 'profile' })
      expect(recording.operations[1]).toEqual({ type: 'property', name: 'settings' })
      expect(recording.operations[2]).toEqual({ type: 'property', name: 'theme' })
    })

    it('allows any chain depth without error during recording', () => {
      const stub = createRecordingStub<any>()

      // This should not throw during recording, even though these properties don't exist
      const _result = stub.a.b.c.d.e.f.g.h.i.j

      const recording = stub.getRecording()
      expect(recording.operations).toHaveLength(10)
    })
  })
})

// ============================================================================
// 2. RECORDING STUB CAPTURES METHOD CALLS
// ============================================================================

describe('RecordingStub: Method Call Recording', () => {
  describe('method calls without arguments', () => {
    it('captures method call as { type: "method", name: "...", args: [] }', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.getProfile()

      const recording = stub.getRecording()
      expect(recording.operations).toHaveLength(1)
      expect(recording.operations[0]).toEqual({
        type: 'method',
        name: 'getProfile',
        args: [],
      })
    })

    it('captures method call with no args on chained property', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.profile.getDisplayName()

      const recording = stub.getRecording()
      expect(recording.operations).toHaveLength(2)
      expect(recording.operations[0]).toEqual({ type: 'property', name: 'profile' })
      expect(recording.operations[1]).toEqual({ type: 'method', name: 'getDisplayName', args: [] })
    })
  })

  describe('method calls with arguments', () => {
    it('captures method call with single primitive argument', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.calculateScore(2.5)

      const recording = stub.getRecording()
      expect(recording.operations[0]).toEqual({
        type: 'method',
        name: 'calculateScore',
        args: [2.5],
      })
    })

    it('captures method call with string argument', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.notify('Hello!')

      const recording = stub.getRecording()
      expect(recording.operations[0]).toEqual({
        type: 'method',
        name: 'notify',
        args: ['Hello!'],
      })
    })

    it('captures method call with multiple arguments', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.notify('Important', { urgent: true })

      const recording = stub.getRecording()
      expect(recording.operations[0]).toEqual({
        type: 'method',
        name: 'notify',
        args: ['Important', { urgent: true }],
      })
    })

    it('captures method call with complex object arguments', () => {
      const stub = createRecordingStub<any>()

      const complexArg = {
        nested: { deeply: { value: [1, 2, 3] } },
        array: ['a', 'b'],
        nullable: null,
      }
      const _result = stub.process(complexArg)

      const recording = stub.getRecording()
      expect(recording.operations[0].args[0]).toEqual(complexArg)
    })

    it('captures method call with undefined and null arguments', () => {
      const stub = createRecordingStub<any>()

      const _result = stub.method(undefined, null, 'value')

      const recording = stub.getRecording()
      expect(recording.operations[0].args).toEqual([undefined, null, 'value'])
    })
  })
})

// ============================================================================
// 3. RECORDING CAPTURES MULTIPLE CHAINED OPERATIONS
// ============================================================================

describe('RecordingStub: Multiple Chained Operations', () => {
  describe('property then method', () => {
    it('captures: stub.profile.getDisplayName()', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.profile.getDisplayName()

      const recording = stub.getRecording()
      expect(recording.operations).toEqual([
        { type: 'property', name: 'profile' },
        { type: 'method', name: 'getDisplayName', args: [] },
      ])
    })

    it('captures: stub.profile.settings.getPreference("theme")', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.profile.settings.getPreference('theme')

      const recording = stub.getRecording()
      expect(recording.operations).toEqual([
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'settings' },
        { type: 'method', name: 'getPreference', args: ['theme'] },
      ])
    })
  })

  describe('method then property', () => {
    it('captures: stub.getProfile().bio', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.getProfile().bio

      const recording = stub.getRecording()
      expect(recording.operations).toEqual([
        { type: 'method', name: 'getProfile', args: [] },
        { type: 'property', name: 'bio' },
      ])
    })

    it('captures: stub.getOrders()[0].total', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.getOrders()[0].total

      const recording = stub.getRecording()
      expect(recording.operations).toEqual([
        { type: 'method', name: 'getOrders', args: [] },
        { type: 'property', name: '0' },
        { type: 'property', name: 'total' },
      ])
    })
  })

  describe('multiple methods in chain', () => {
    it('captures: stub.getProfile().getDisplayName()', () => {
      const stub = createRecordingStub<User>()

      const _result = stub.getProfile().getDisplayName()

      const recording = stub.getRecording()
      expect(recording.operations).toEqual([
        { type: 'method', name: 'getProfile', args: [] },
        { type: 'method', name: 'getDisplayName', args: [] },
      ])
    })

    it('captures chain with alternating methods and properties', () => {
      const stub = createRecordingStub<any>()

      const _result = stub.a().b.c('arg').d.e().f

      const recording = stub.getRecording()
      expect(recording.operations).toEqual([
        { type: 'method', name: 'a', args: [] },
        { type: 'property', name: 'b' },
        { type: 'method', name: 'c', args: ['arg'] },
        { type: 'property', name: 'd' },
        { type: 'method', name: 'e', args: [] },
        { type: 'property', name: 'f' },
      ])
    })
  })

  describe('long chains', () => {
    it('handles very long chains without stack overflow', () => {
      const stub = createRecordingStub<any>()

      // Build a long chain
      let result: any = stub
      for (let i = 0; i < 100; i++) {
        result = result[`prop${i}`]
      }

      const recording = stub.getRecording()
      expect(recording.operations).toHaveLength(100)
    })
  })
})

// ============================================================================
// 4. SERVER-SIDE REPLAY RETURNS ARRAY OF RESULTS
// ============================================================================

describe('replayRecording: Server-Side Execution', () => {
  describe('replay on single element', () => {
    it('replays property access and returns result', () => {
      const recording: Recording = {
        operations: [{ type: 'property', name: 'name' }],
      }

      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        profile: { bio: '', avatar: '', settings: { theme: 'dark', notifications: true, getPreference: () => null }, getDisplayName: () => '' },
        getOrders: () => [],
        getProfile: () => user.profile,
        calculateScore: () => 0,
        notify: () => {},
      }

      const result = replayRecording(recording, user)

      expect(result).toBe('Alice')
    })

    it('replays nested property access', () => {
      const recording: Recording = {
        operations: [
          { type: 'property', name: 'profile' },
          { type: 'property', name: 'settings' },
          { type: 'property', name: 'theme' },
        ],
      }

      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        profile: { bio: '', avatar: '', settings: { theme: 'dark', notifications: true, getPreference: () => null }, getDisplayName: () => '' },
        getOrders: () => [],
        getProfile: () => user.profile,
        calculateScore: () => 0,
        notify: () => {},
      }

      const result = replayRecording(recording, user)

      expect(result).toBe('dark')
    })

    it('replays method call', () => {
      const recording: Recording = {
        operations: [{ type: 'method', name: 'calculateScore', args: [10] }],
      }

      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        profile: { bio: '', avatar: '', settings: { theme: 'dark', notifications: true, getPreference: () => null }, getDisplayName: () => '' },
        getOrders: () => [],
        getProfile: () => user.profile,
        calculateScore: (multiplier) => user.age * multiplier,
        notify: () => {},
      }

      const result = replayRecording(recording, user)

      expect(result).toBe(300) // 30 * 10
    })

    it('replays method then property access', () => {
      const recording: Recording = {
        operations: [
          { type: 'method', name: 'getProfile', args: [] },
          { type: 'property', name: 'bio' },
        ],
      }

      const user: User = {
        $id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        profile: { bio: 'Engineer', avatar: '', settings: { theme: 'dark', notifications: true, getPreference: () => null }, getDisplayName: () => '' },
        getOrders: () => [],
        getProfile: () => user.profile,
        calculateScore: () => 0,
        notify: () => {},
      }

      const result = replayRecording(recording, user)

      expect(result).toBe('Engineer')
    })
  })

  describe('replay on array of elements', () => {
    it('replays recording on each element and returns array of results', () => {
      const recording: Recording = {
        operations: [{ type: 'property', name: 'name' }],
      }

      const users: User[] = [
        { $id: 'u1', name: 'Alice', email: '', age: 0, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: () => 0, notify: () => {} },
        { $id: 'u2', name: 'Bob', email: '', age: 0, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: () => 0, notify: () => {} },
        { $id: 'u3', name: 'Charlie', email: '', age: 0, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: () => 0, notify: () => {} },
      ]

      const results = users.map((user) => replayRecording(recording, user))

      expect(results).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('replays complex chain on each element', () => {
      const recording: Recording = {
        operations: [
          { type: 'method', name: 'getProfile', args: [] },
          { type: 'property', name: 'settings' },
          { type: 'property', name: 'theme' },
        ],
      }

      const makeUser = (theme: string): User => ({
        $id: 'u1',
        name: 'User',
        email: '',
        age: 0,
        profile: { bio: '', avatar: '', settings: { theme, notifications: true, getPreference: () => null }, getDisplayName: () => '' },
        getOrders: () => [],
        getProfile: function() { return this.profile },
        calculateScore: () => 0,
        notify: () => {},
      })

      const users = [makeUser('dark'), makeUser('light'), makeUser('auto')]

      const results = users.map((user) => replayRecording(recording, user))

      expect(results).toEqual(['dark', 'light', 'auto'])
    })

    it('replays method with arguments on each element', () => {
      const recording: Recording = {
        operations: [{ type: 'method', name: 'calculateScore', args: [2] }],
      }

      const users: User[] = [
        { $id: 'u1', name: 'Alice', email: '', age: 10, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: (m) => 10 * m, notify: () => {} },
        { $id: 'u2', name: 'Bob', email: '', age: 20, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: (m) => 20 * m, notify: () => {} },
        { $id: 'u3', name: 'Charlie', email: '', age: 30, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: (m) => 30 * m, notify: () => {} },
      ]

      const results = users.map((user) => replayRecording(recording, user))

      expect(results).toEqual([20, 40, 60])
    })
  })
})

// ============================================================================
// 5. CHAINED OPERATIONS: user.profile.email
// ============================================================================

describe('Chained Operations: user.profile.email pattern', () => {
  it('records user.profile.email access pattern', () => {
    const stub = createRecordingStub<User>()

    const _email = stub.profile.settings.notifications

    const recording = stub.getRecording()
    expect(recording.operations).toEqual([
      { type: 'property', name: 'profile' },
      { type: 'property', name: 'settings' },
      { type: 'property', name: 'notifications' },
    ])
  })

  it('replays user.profile.email pattern correctly', () => {
    const recording: Recording = {
      operations: [
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'bio' },
      ],
    }

    const users: User[] = [
      {
        $id: 'u1', name: 'Alice', email: '', age: 0,
        profile: { bio: 'Engineer', avatar: '', settings: { theme: '', notifications: false, getPreference: () => null }, getDisplayName: () => '' },
        getOrders: () => [], getProfile: () => ({}) as any, calculateScore: () => 0, notify: () => {},
      },
      {
        $id: 'u2', name: 'Bob', email: '', age: 0,
        profile: { bio: 'Designer', avatar: '', settings: { theme: '', notifications: false, getPreference: () => null }, getDisplayName: () => '' },
        getOrders: () => [], getProfile: () => ({}) as any, calculateScore: () => 0, notify: () => {},
      },
    ]

    const results = users.map((user) => replayRecording(recording, user))

    expect(results).toEqual(['Engineer', 'Designer'])
  })

  it('handles array index access in chain: orders[0].status', () => {
    const stub = createRecordingStub<User>()

    const _status = stub.getOrders()[0].status

    const recording = stub.getRecording()
    expect(recording.operations).toEqual([
      { type: 'method', name: 'getOrders', args: [] },
      { type: 'property', name: '0' },
      { type: 'property', name: 'status' },
    ])
  })
})

// ============================================================================
// 6. CHAINED OPERATIONS: user.getProfile().email
// ============================================================================

describe('Chained Operations: user.getProfile().email pattern', () => {
  it('records user.getProfile().bio access pattern', () => {
    const stub = createRecordingStub<User>()

    const _bio = stub.getProfile().bio

    const recording = stub.getRecording()
    expect(recording.operations).toEqual([
      { type: 'method', name: 'getProfile', args: [] },
      { type: 'property', name: 'bio' },
    ])
  })

  it('replays user.getProfile().bio pattern correctly', () => {
    const recording: Recording = {
      operations: [
        { type: 'method', name: 'getProfile', args: [] },
        { type: 'property', name: 'bio' },
      ],
    }

    const makeUser = (bio: string): User => ({
      $id: 'u1', name: 'User', email: '', age: 0,
      profile: { bio, avatar: '', settings: { theme: '', notifications: false, getPreference: () => null }, getDisplayName: () => '' },
      getOrders: () => [],
      getProfile: function() { return this.profile },
      calculateScore: () => 0,
      notify: () => {},
    })

    const users = [makeUser('Engineer'), makeUser('Designer'), makeUser('Manager')]

    const results = users.map((user) => replayRecording(recording, user))

    expect(results).toEqual(['Engineer', 'Designer', 'Manager'])
  })

  it('records getProfile().settings.theme access pattern', () => {
    const stub = createRecordingStub<User>()

    const _theme = stub.getProfile().settings.theme

    const recording = stub.getRecording()
    expect(recording.operations).toEqual([
      { type: 'method', name: 'getProfile', args: [] },
      { type: 'property', name: 'settings' },
      { type: 'property', name: 'theme' },
    ])
  })

  it('records method with args then property: calculateScore(2).toString()', () => {
    const stub = createRecordingStub<any>()

    // Record accessing a method that returns something with a method
    const _result = stub.format('currency').toUpperCase()

    const recording = stub.getRecording()
    expect(recording.operations).toEqual([
      { type: 'method', name: 'format', args: ['currency'] },
      { type: 'method', name: 'toUpperCase', args: [] },
    ])
  })
})

// ============================================================================
// 7. RECORDING IS SERIALIZABLE
// ============================================================================

describe('Recording Serialization', () => {
  describe('serializeRecording', () => {
    it('serializes empty recording', () => {
      const recording: Recording = { operations: [] }

      const serialized = serializeRecording(recording)

      expect(serialized).toEqual({ operations: [] })
    })

    it('serializes property operations', () => {
      const recording: Recording = {
        operations: [
          { type: 'property', name: 'profile' },
          { type: 'property', name: 'email' },
        ],
      }

      const serialized = serializeRecording(recording)

      expect(serialized).toEqual(recording)
    })

    it('serializes method operations with args', () => {
      const recording: Recording = {
        operations: [
          { type: 'method', name: 'notify', args: ['Hello', { urgent: true }] },
        ],
      }

      const serialized = serializeRecording(recording)

      expect(serialized).toEqual(recording)
    })

    it('serialized recording is JSON-compatible', () => {
      const recording: Recording = {
        operations: [
          { type: 'property', name: 'profile' },
          { type: 'method', name: 'getPreference', args: ['theme'] },
          { type: 'property', name: 'value' },
        ],
      }

      const serialized = serializeRecording(recording)
      const jsonString = JSON.stringify(serialized)
      const parsed = JSON.parse(jsonString)

      expect(parsed).toEqual(recording)
    })

    it('serializes complex nested arguments', () => {
      const recording: Recording = {
        operations: [
          {
            type: 'method',
            name: 'process',
            args: [
              {
                nested: { deeply: { value: [1, 2, 3] } },
                date: '2024-01-15',
                nullable: null,
              },
            ],
          },
        ],
      }

      const serialized = serializeRecording(recording)
      const jsonString = JSON.stringify(serialized)
      const parsed = JSON.parse(jsonString)

      expect(parsed.operations[0].args[0].nested.deeply.value).toEqual([1, 2, 3])
    })
  })

  describe('deserializeRecording', () => {
    it('deserializes recording from JSON', () => {
      const json = {
        operations: [
          { type: 'property' as const, name: 'profile' },
          { type: 'property' as const, name: 'email' },
        ],
      }

      const recording = deserializeRecording(json)

      expect(recording.operations).toHaveLength(2)
      expect(recording.operations[0]).toEqual({ type: 'property', name: 'profile' })
    })

    it('round-trip serialization preserves data', () => {
      const original: Recording = {
        operations: [
          { type: 'property', name: 'profile' },
          { type: 'method', name: 'getSettings', args: [{ deep: true }] },
          { type: 'property', name: 'theme' },
        ],
      }

      const serialized = serializeRecording(original)
      const jsonString = JSON.stringify(serialized)
      const parsed = JSON.parse(jsonString)
      const restored = deserializeRecording(parsed)

      expect(restored).toEqual(original)
    })
  })

  describe('wire format compatibility', () => {
    it('matches expected wire format for .map() RPC call', () => {
      // The wire format for: Users(['alice', 'bob']).map(user => user.profile.email)
      // Should be: { recording: { operations: [...] }, elements: [...] }

      const stub = createRecordingStub<User>()
      const _email = stub.profile.bio

      const recording = stub.getRecording()
      const serialized = serializeRecording(recording)

      // This is what would be sent over the wire
      const wirePayload = {
        recording: serialized,
        elementIds: ['alice', 'bob'],
      }

      expect(wirePayload.recording.operations).toEqual([
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'bio' },
      ])
    })
  })
})

// ============================================================================
// 8. REPLAY EXECUTES RECORDING ON EACH ELEMENT
// ============================================================================

describe('Replay: Executes Recording on Each Element', () => {
  describe('batch replay helper', () => {
    it('replayRecordingOnAll replays on array and returns results', () => {
      // This might be a helper function or the behavior of a higher-level API
      const recording: Recording = {
        operations: [{ type: 'property', name: 'name' }],
      }

      const users = [
        { name: 'Alice', email: 'alice@test.com' },
        { name: 'Bob', email: 'bob@test.com' },
        { name: 'Charlie', email: 'charlie@test.com' },
      ]

      // Using map with replayRecording simulates batch replay
      const results = users.map((user) => replayRecording(recording, user))

      expect(results).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('maintains element order in results', () => {
      const recording: Recording = {
        operations: [{ type: 'property', name: 'value' }],
      }

      const items = [
        { value: 'first' },
        { value: 'second' },
        { value: 'third' },
        { value: 'fourth' },
      ]

      const results = items.map((item) => replayRecording(recording, item))

      expect(results).toEqual(['first', 'second', 'third', 'fourth'])
    })

    it('handles empty array', () => {
      const recording: Recording = {
        operations: [{ type: 'property', name: 'name' }],
      }

      const items: any[] = []

      const results = items.map((item) => replayRecording(recording, item))

      expect(results).toEqual([])
    })

    it('handles single element array', () => {
      const recording: Recording = {
        operations: [{ type: 'property', name: 'name' }],
      }

      const items = [{ name: 'Singleton' }]

      const results = items.map((item) => replayRecording(recording, item))

      expect(results).toEqual(['Singleton'])
    })

    it('handles large arrays efficiently', () => {
      const recording: Recording = {
        operations: [{ type: 'property', name: 'id' }],
      }

      // Create 1000 items
      const items = Array.from({ length: 1000 }, (_, i) => ({ id: i }))

      const results = items.map((item) => replayRecording(recording, item))

      expect(results).toHaveLength(1000)
      expect(results[0]).toBe(0)
      expect(results[999]).toBe(999)
    })
  })

  describe('async replay', () => {
    it('handles async method calls in recording', async () => {
      const recording: Recording = {
        operations: [{ type: 'method', name: 'fetchData', args: [] }],
      }

      const item = {
        async fetchData() {
          return 'async result'
        },
      }

      // If replayRecording can return a promise
      const result = await replayRecording(recording, item)

      expect(result).toBe('async result')
    })

    it('handles async method then property access', async () => {
      const recording: Recording = {
        operations: [
          { type: 'method', name: 'fetchProfile', args: [] },
          { type: 'property', name: 'name' },
        ],
      }

      const item = {
        async fetchProfile() {
          return { name: 'Async User', email: 'async@test.com' }
        },
      }

      const result = await replayRecording(recording, item)

      expect(result).toBe('Async User')
    })
  })
})

// ============================================================================
// 9. ERROR HANDLING DURING REPLAY
// ============================================================================

describe('Error Handling During Replay', () => {
  describe('property access errors', () => {
    it('throws meaningful error for property access on null', () => {
      const recording: Recording = {
        operations: [
          { type: 'property', name: 'profile' },
          { type: 'property', name: 'email' },
        ],
      }

      const item = { profile: null }

      expect(() => replayRecording(recording, item)).toThrow(/cannot read.*property.*email.*null/i)
    })

    it('throws meaningful error for property access on undefined', () => {
      const recording: Recording = {
        operations: [
          { type: 'property', name: 'profile' },
          { type: 'property', name: 'email' },
        ],
      }

      const item = { profile: undefined }

      expect(() => replayRecording(recording, item)).toThrow(/cannot read.*property.*email.*undefined/i)
    })

    it('includes step index in error message', () => {
      const recording: Recording = {
        operations: [
          { type: 'property', name: 'a' },
          { type: 'property', name: 'b' },
          { type: 'property', name: 'c' }, // This will fail
        ],
      }

      const item = { a: { b: null } }

      expect(() => replayRecording(recording, item)).toThrow(/step.*2/i)
    })
  })

  describe('method call errors', () => {
    it('throws meaningful error for calling non-function', () => {
      const recording: Recording = {
        operations: [{ type: 'method', name: 'notAFunction', args: [] }],
      }

      const item = { notAFunction: 'string value' }

      expect(() => replayRecording(recording, item)).toThrow(/not a function/i)
    })

    it('propagates method execution errors', () => {
      const recording: Recording = {
        operations: [{ type: 'method', name: 'throwError', args: [] }],
      }

      const item = {
        throwError() {
          throw new Error('Intentional error')
        },
      }

      expect(() => replayRecording(recording, item)).toThrow('Intentional error')
    })

    it('includes method name in error message', () => {
      const recording: Recording = {
        operations: [{ type: 'method', name: 'specificMethod', args: [] }],
      }

      const item = { specificMethod: 'not a function' }

      expect(() => replayRecording(recording, item)).toThrow(/specificMethod.*not a function/i)
    })
  })

  describe('partial replay errors', () => {
    it('errors indicate which element failed in batch replay', () => {
      const recording: Recording = {
        operations: [{ type: 'property', name: 'value' }],
      }

      const items = [
        { value: 'first' },
        null, // This will cause an error
        { value: 'third' },
      ]

      // In batch mode, we might want to know which index failed
      const replayAll = () => items.map((item, index) => {
        try {
          return replayRecording(recording, item)
        } catch (err: any) {
          throw new Error(`Replay failed at index ${index}: ${err.message}`)
        }
      })

      expect(replayAll).toThrow(/index 1/i)
    })
  })

  describe('recovery from errors', () => {
    it('allows error recovery with default values', () => {
      const recording: Recording = {
        operations: [{ type: 'property', name: 'optionalField' }],
      }

      const items = [
        { optionalField: 'exists' },
        {}, // Missing field
        { optionalField: 'also exists' },
      ]

      // Safe replay that returns undefined for missing properties
      const safeReplay = (rec: Recording, target: any) => {
        try {
          return replayRecording(rec, target)
        } catch {
          return undefined
        }
      }

      const results = items.map((item) => safeReplay(recording, item))

      expect(results).toEqual(['exists', undefined, 'also exists'])
    })
  })
})

// ============================================================================
// 10. INTEGRATION: FULL .map() WORKFLOW
// ============================================================================

describe('Integration: Full .map() Workflow', () => {
  describe('complete record-replay cycle', () => {
    it('simulates: Users.map(user => user.name)', () => {
      // Step 1: Create recording stub
      const stub = createRecordingStub<User>()

      // Step 2: Execute callback with stub (recording mode)
      const callback = (user: User) => user.name
      callback(stub as unknown as User)

      // Step 3: Get recording
      const recording = stub.getRecording()

      // Step 4: Serialize for wire
      const serialized = serializeRecording(recording)

      // Step 5: Server receives and deserializes
      const restored = deserializeRecording(serialized)

      // Step 6: Server replays on each element
      const users: User[] = [
        { $id: 'u1', name: 'Alice', email: '', age: 0, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: () => 0, notify: () => {} },
        { $id: 'u2', name: 'Bob', email: '', age: 0, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: () => 0, notify: () => {} },
      ]

      const results = users.map((user) => replayRecording(restored, user))

      // Step 7: Verify results
      expect(results).toEqual(['Alice', 'Bob'])
    })

    it('simulates: Users.map(user => user.profile.settings.theme)', () => {
      // Step 1: Create recording stub
      const stub = createRecordingStub<User>()

      // Step 2: Execute callback with stub
      const callback = (user: User) => user.profile.settings.theme
      callback(stub as unknown as User)

      // Step 3-5: Serialize and deserialize
      const recording = stub.getRecording()
      const serialized = serializeRecording(recording)
      const restored = deserializeRecording(serialized)

      // Step 6: Replay on elements
      const makeUser = (theme: string): User => ({
        $id: 'u1', name: 'User', email: '', age: 0,
        profile: { bio: '', avatar: '', settings: { theme, notifications: false, getPreference: () => null }, getDisplayName: () => '' },
        getOrders: () => [], getProfile: () => ({}) as any, calculateScore: () => 0, notify: () => {},
      })

      const users = [makeUser('dark'), makeUser('light'), makeUser('auto')]
      const results = users.map((user) => replayRecording(restored, user))

      expect(results).toEqual(['dark', 'light', 'auto'])
    })

    it('simulates: Users.map(user => user.getProfile().bio)', () => {
      const stub = createRecordingStub<User>()

      const callback = (user: User) => user.getProfile().bio
      callback(stub as unknown as User)

      const recording = stub.getRecording()
      const serialized = serializeRecording(recording)
      const restored = deserializeRecording(serialized)

      const makeUser = (bio: string): User => ({
        $id: 'u1', name: 'User', email: '', age: 0,
        profile: { bio, avatar: '', settings: { theme: '', notifications: false, getPreference: () => null }, getDisplayName: () => '' },
        getOrders: () => [],
        getProfile: function() { return this.profile },
        calculateScore: () => 0,
        notify: () => {},
      })

      const users = [makeUser('Engineer'), makeUser('Designer')]
      const results = users.map((user) => replayRecording(restored, user))

      expect(results).toEqual(['Engineer', 'Designer'])
    })

    it('simulates: Users.map(user => user.calculateScore(10))', () => {
      const stub = createRecordingStub<User>()

      const callback = (user: User) => user.calculateScore(10)
      callback(stub as unknown as User)

      const recording = stub.getRecording()
      const serialized = serializeRecording(recording)
      const restored = deserializeRecording(serialized)

      const users: User[] = [
        { $id: 'u1', name: 'Alice', email: '', age: 10, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: (m) => 10 * m, notify: () => {} },
        { $id: 'u2', name: 'Bob', email: '', age: 20, profile: {} as any, getOrders: () => [], getProfile: () => ({}) as any, calculateScore: (m) => 20 * m, notify: () => {} },
      ]

      const results = users.map((user) => replayRecording(restored, user))

      expect(results).toEqual([100, 200])
    })
  })

  describe('edge cases in full workflow', () => {
    it('handles callback that accesses multiple properties sequentially (only last recorded)', () => {
      const stub = createRecordingStub<User>()

      // In recording mode, we can only capture one chain
      // The callback might access multiple things, but we only care about the return value
      const callback = (user: User) => {
        // These intermediate accesses won't be part of the final recording
        // Only the returned value's access chain matters
        return user.name
      }
      callback(stub as unknown as User)

      const recording = stub.getRecording()

      // The recording captures all accesses, but in practice the .map() implementation
      // should only care about what the callback returns
      expect(recording.operations).toContainEqual({ type: 'property', name: 'name' })
    })

    it('handles empty callback (returns undefined)', () => {
      const stub = createRecordingStub<User>()

      // Callback doesn't access anything
      const callback = (_user: User) => undefined
      callback(stub as unknown as User)

      const recording = stub.getRecording()

      // No operations recorded
      expect(recording.operations).toHaveLength(0)
    })
  })
})

// ============================================================================
// 11. RECORDING STUB SPECIAL PROPERTIES
// ============================================================================

describe('RecordingStub: Special Properties', () => {
  describe('Symbol handling', () => {
    it('does not record Symbol.toStringTag access', () => {
      const stub = createRecordingStub<User>()

      // This is often accessed by console.log, debuggers, etc.
      const _tag = Object.prototype.toString.call(stub)

      const recording = stub.getRecording()
      // Should not have any Symbol-related operations
      expect(recording.operations.every((op) => !op.name.startsWith('Symbol'))).toBe(true)
    })

    it('has correct Symbol.toStringTag for debugging', () => {
      const stub = createRecordingStub<User>()

      expect(Object.prototype.toString.call(stub)).toBe('[object RecordingStub]')
    })
  })

  describe('Promise-like handling', () => {
    it('does not record "then" access (for Promise compatibility)', () => {
      const stub = createRecordingStub<User>()

      // Accessing .then should not be recorded
      const _then = stub.then

      const recording = stub.getRecording()
      expect(recording.operations.every((op) => op.name !== 'then')).toBe(true)
    })

    it('does not record "catch" access', () => {
      const stub = createRecordingStub<User>()

      const _catch = stub.catch

      const recording = stub.getRecording()
      expect(recording.operations.every((op) => op.name !== 'catch')).toBe(true)
    })

    it('does not record "finally" access', () => {
      const stub = createRecordingStub<User>()

      const _finally = stub.finally

      const recording = stub.getRecording()
      expect(recording.operations.every((op) => op.name !== 'finally')).toBe(true)
    })
  })

  describe('getRecording method', () => {
    it('getRecording is always accessible', () => {
      const stub = createRecordingStub<User>()

      expect(typeof stub.getRecording).toBe('function')
    })

    it('getRecording returns consistent results', () => {
      const stub = createRecordingStub<User>()

      const _name = stub.name

      const recording1 = stub.getRecording()
      const recording2 = stub.getRecording()

      expect(recording1).toEqual(recording2)
    })

    it('getRecording is not recorded as an operation', () => {
      const stub = createRecordingStub<User>()

      const _name = stub.name
      const _recording = stub.getRecording()

      const finalRecording = stub.getRecording()
      expect(finalRecording.operations).toHaveLength(1)
      expect(finalRecording.operations[0]).toEqual({ type: 'property', name: 'name' })
    })
  })
})

// ============================================================================
// 12. RECORDING ISOLATION
// ============================================================================

describe('Recording Isolation', () => {
  it('each RecordingStub has independent recording', () => {
    const stub1 = createRecordingStub<User>()
    const stub2 = createRecordingStub<User>()

    const _name = stub1.name
    const _email = stub2.email

    const recording1 = stub1.getRecording()
    const recording2 = stub2.getRecording()

    expect(recording1.operations).toEqual([{ type: 'property', name: 'name' }])
    expect(recording2.operations).toEqual([{ type: 'property', name: 'email' }])
  })

  it('chained stubs share the same recording', () => {
    const stub = createRecordingStub<User>()

    // All these access the same recording
    const chainedStub = stub.profile.settings

    // The original stub should have the full chain recorded
    const recording = stub.getRecording()
    expect(recording.operations).toHaveLength(2)
  })

  it('recording is immutable after getRecording', () => {
    const stub = createRecordingStub<User>()

    const _name = stub.name
    const recording = stub.getRecording()

    // Modifying the returned recording should not affect internal state
    recording.operations.push({ type: 'property', name: 'hacked' })

    const freshRecording = stub.getRecording()
    expect(freshRecording.operations).toHaveLength(1)
    expect(freshRecording.operations[0].name).toBe('name')
  })
})
