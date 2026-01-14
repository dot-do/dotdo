/**
 * Tests for glob pattern subscriptions in file watching
 *
 * TDD RED phase - these tests verify glob pattern matching for subscriptions:
 * - *.ts pattern matches .ts files
 * - **\/*.js matches nested .js files
 * - /refs/** matches refs subtree
 * - Non-matching paths don't trigger events
 * - Multiple glob subscriptions
 *
 * These tests are designed to fail until the pattern matching implementation
 * is complete. They test the SubscriptionManager's ability to match file paths
 * against glob patterns for determining which WebSocket connections should
 * receive file change notifications.
 *
 * @module tests/watch/glob-subscriptions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SubscriptionManager } from '../../core/watch/subscription'
import { createWatchEvent, type WatchEvent } from '../../core/watch/events'

// ============================================================================
// Mock WebSocket
// ============================================================================

/**
 * Mock WebSocket for testing subscription matching
 */
class MockWebSocket {
  readyState: number = 1 // OPEN
  sentMessages: string[] = []
  receivedEvents: WatchEvent[] = []
  closeCallCount = 0

  send(message: string): void {
    this.sentMessages.push(message)
    try {
      const parsed = JSON.parse(message)
      if (parsed.type && parsed.path && parsed.timestamp) {
        this.receivedEvents.push(parsed as WatchEvent)
      }
    } catch {
      // Not a JSON message
    }
  }

  close(): void {
    this.readyState = 3 // CLOSED
    this.closeCallCount++
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Simulate emitting a watch event to all matching subscribers
 */
function emitToSubscribers(
  manager: SubscriptionManager,
  event: WatchEvent
): WebSocket[] {
  const subscribers = manager.getSubscribersForPath(event.path)
  for (const ws of subscribers) {
    ws.send(JSON.stringify(event))
  }
  return subscribers
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Glob Pattern Subscriptions', () => {
  let manager: SubscriptionManager
  let ws1: MockWebSocket
  let ws2: MockWebSocket
  let ws3: MockWebSocket

  beforeEach(() => {
    manager = new SubscriptionManager()
    ws1 = new MockWebSocket()
    ws2 = new MockWebSocket()
    ws3 = new MockWebSocket()
  })

  // ==========================================================================
  // *.ts Pattern Tests - Single wildcard with extension
  // ==========================================================================

  describe('*.ts pattern matches .ts files', () => {
    it('should match .ts files in current directory with *.ts pattern', () => {
      // Subscribe to *.ts at root level
      manager.subscribe(ws1 as unknown as WebSocket, '/*.ts')

      // Act - check if various .ts files match
      const matchesRootTs = manager.getSubscribersForPath('/index.ts')
      const matchesRootTs2 = manager.getSubscribersForPath('/app.ts')
      const matchesRootTsx = manager.getSubscribersForPath('/component.tsx')
      const matchesNestedTs = manager.getSubscribersForPath('/src/index.ts')

      // Assert
      expect(matchesRootTs).toContain(ws1)
      expect(matchesRootTs2).toContain(ws1)
      // .tsx should NOT match *.ts pattern
      expect(matchesRootTsx).not.toContain(ws1)
      // Nested paths should NOT match root *.ts
      expect(matchesNestedTs).not.toContain(ws1)
    })

    it('should match .ts files in specific directory with /src/*.ts pattern', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/*.ts')

      const matchesSrcTs = manager.getSubscribersForPath('/src/index.ts')
      const matchesSrcTs2 = manager.getSubscribersForPath('/src/utils.ts')
      const matchesNestedTs = manager.getSubscribersForPath('/src/lib/helper.ts')
      const matchesRootTs = manager.getSubscribersForPath('/index.ts')

      expect(matchesSrcTs).toContain(ws1)
      expect(matchesSrcTs2).toContain(ws1)
      // Nested paths should NOT match
      expect(matchesNestedTs).not.toContain(ws1)
      // Root paths should NOT match
      expect(matchesRootTs).not.toContain(ws1)
    })

    it('should correctly distinguish *.ts from *.tsx', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/*.ts')
      manager.subscribe(ws2 as unknown as WebSocket, '/src/*.tsx')

      const tsFile = '/src/utils.ts'
      const tsxFile = '/src/Component.tsx'

      expect(manager.getSubscribersForPath(tsFile)).toContain(ws1)
      expect(manager.getSubscribersForPath(tsFile)).not.toContain(ws2)
      expect(manager.getSubscribersForPath(tsxFile)).toContain(ws2)
      expect(manager.getSubscribersForPath(tsxFile)).not.toContain(ws1)
    })

    it('should not match files without .ts extension', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/*.ts')

      const matchesJs = manager.getSubscribersForPath('/src/index.js')
      const matchesJson = manager.getSubscribersForPath('/src/config.json')
      const matchesTsInName = manager.getSubscribersForPath('/src/typescript')
      const matchesNoExt = manager.getSubscribersForPath('/src/README')

      expect(matchesJs).not.toContain(ws1)
      expect(matchesJson).not.toContain(ws1)
      expect(matchesTsInName).not.toContain(ws1)
      expect(matchesNoExt).not.toContain(ws1)
    })

    it('should emit events only to *.ts subscribers for .ts file changes', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/*.ts')
      manager.subscribe(ws2 as unknown as WebSocket, '/src/*.js')

      const tsEvent = createWatchEvent('modify', '/src/app.ts', { size: 1024 })
      const jsEvent = createWatchEvent('modify', '/src/app.js', { size: 512 })

      const tsSubscribers = emitToSubscribers(manager, tsEvent)
      const jsSubscribers = emitToSubscribers(manager, jsEvent)

      expect(tsSubscribers).toContain(ws1)
      expect(tsSubscribers).not.toContain(ws2)
      expect(jsSubscribers).toContain(ws2)
      expect(jsSubscribers).not.toContain(ws1)
    })
  })

  // ==========================================================================
  // **/*.js Pattern Tests - Recursive glob with extension
  // ==========================================================================

  describe('**/*.js matches nested .js files', () => {
    it('should match .js files at any depth with **/*.js pattern', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.js')

      // Direct child
      const matchesDirect = manager.getSubscribersForPath('/src/index.js')
      // One level deep
      const matchesOneLevel = manager.getSubscribersForPath('/src/lib/utils.js')
      // Two levels deep
      const matchesTwoLevels = manager.getSubscribersForPath('/src/lib/helpers/format.js')
      // Many levels deep
      const matchesDeep = manager.getSubscribersForPath('/src/a/b/c/d/e/f.js')

      expect(matchesDirect).toContain(ws1)
      expect(matchesOneLevel).toContain(ws1)
      expect(matchesTwoLevels).toContain(ws1)
      expect(matchesDeep).toContain(ws1)
    })

    it('should not match .js files outside the base directory', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.js')

      const matchesRoot = manager.getSubscribersForPath('/index.js')
      const matchesOtherDir = manager.getSubscribersForPath('/lib/index.js')
      const matchesParallel = manager.getSubscribersForPath('/test/app.js')

      expect(matchesRoot).not.toContain(ws1)
      expect(matchesOtherDir).not.toContain(ws1)
      expect(matchesParallel).not.toContain(ws1)
    })

    it('should not match non-.js files with **/*.js pattern', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.js')

      const matchesTs = manager.getSubscribersForPath('/src/lib/utils.ts')
      const matchesJson = manager.getSubscribersForPath('/src/config/app.json')
      const matchesMjs = manager.getSubscribersForPath('/src/index.mjs')
      const matchesJsx = manager.getSubscribersForPath('/src/components/App.jsx')

      expect(matchesTs).not.toContain(ws1)
      expect(matchesJson).not.toContain(ws1)
      expect(matchesMjs).not.toContain(ws1)
      expect(matchesJsx).not.toContain(ws1)
    })

    it('should handle root **/*.js pattern', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/**/*.js')

      const matchesRoot = manager.getSubscribersForPath('/index.js')
      const matchesNested = manager.getSubscribersForPath('/src/lib/utils.js')
      const matchesDeep = manager.getSubscribersForPath('/a/b/c/d.js')

      expect(matchesRoot).toContain(ws1)
      expect(matchesNested).toContain(ws1)
      expect(matchesDeep).toContain(ws1)
    })

    it('should emit create events to **/*.js subscribers', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.js')

      const createEvent = createWatchEvent('create', '/src/components/Button.js', {
        size: 2048,
        isDirectory: false,
      })

      const subscribers = emitToSubscribers(manager, createEvent)
      expect(subscribers).toContain(ws1)
      expect((ws1 as MockWebSocket).receivedEvents).toHaveLength(1)
      expect((ws1 as MockWebSocket).receivedEvents[0].type).toBe('create')
    })
  })

  // ==========================================================================
  // /refs/** Pattern Tests - Git refs subtree
  // ==========================================================================

  describe('/refs/** matches refs subtree', () => {
    it('should match all paths under /refs with /refs/** pattern', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/refs/**')

      // The refs directory itself
      const matchesRefsDir = manager.getSubscribersForPath('/refs')
      // Direct children
      const matchesHeads = manager.getSubscribersForPath('/refs/heads')
      const matchesTags = manager.getSubscribersForPath('/refs/tags')
      const matchesRemotes = manager.getSubscribersForPath('/refs/remotes')
      // Nested refs
      const matchesMainBranch = manager.getSubscribersForPath('/refs/heads/main')
      const matchesFeatureBranch = manager.getSubscribersForPath('/refs/heads/feature/login')
      const matchesRemoteOrigin = manager.getSubscribersForPath('/refs/remotes/origin/main')
      const matchesTag = manager.getSubscribersForPath('/refs/tags/v1.0.0')

      expect(matchesRefsDir).toContain(ws1)
      expect(matchesHeads).toContain(ws1)
      expect(matchesTags).toContain(ws1)
      expect(matchesRemotes).toContain(ws1)
      expect(matchesMainBranch).toContain(ws1)
      expect(matchesFeatureBranch).toContain(ws1)
      expect(matchesRemoteOrigin).toContain(ws1)
      expect(matchesTag).toContain(ws1)
    })

    it('should not match paths outside /refs', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/refs/**')

      const matchesRoot = manager.getSubscribersForPath('/')
      const matchesObjects = manager.getSubscribersForPath('/objects')
      const matchesHead = manager.getSubscribersForPath('/HEAD')
      const matchesConfig = manager.getSubscribersForPath('/config')
      const matchesRefsInName = manager.getSubscribersForPath('/my-refs')

      expect(matchesRoot).not.toContain(ws1)
      expect(matchesObjects).not.toContain(ws1)
      expect(matchesHead).not.toContain(ws1)
      expect(matchesConfig).not.toContain(ws1)
      expect(matchesRefsInName).not.toContain(ws1)
    })

    it('should support subscribing to specific ref types', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/refs/heads/**')
      manager.subscribe(ws2 as unknown as WebSocket, '/refs/tags/**')

      const headChange = '/refs/heads/main'
      const tagChange = '/refs/tags/v1.0.0'
      const remoteChange = '/refs/remotes/origin/main'

      expect(manager.getSubscribersForPath(headChange)).toContain(ws1)
      expect(manager.getSubscribersForPath(headChange)).not.toContain(ws2)
      expect(manager.getSubscribersForPath(tagChange)).toContain(ws2)
      expect(manager.getSubscribersForPath(tagChange)).not.toContain(ws1)
      expect(manager.getSubscribersForPath(remoteChange)).not.toContain(ws1)
      expect(manager.getSubscribersForPath(remoteChange)).not.toContain(ws2)
    })

    it('should emit modify events for ref updates', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/refs/**')

      const refUpdateEvent = createWatchEvent('modify', '/refs/heads/main', {
        size: 41, // SHA-1 hash + newline
      })

      const subscribers = emitToSubscribers(manager, refUpdateEvent)
      expect(subscribers).toContain(ws1)
      expect((ws1 as MockWebSocket).receivedEvents[0].path).toBe('/refs/heads/main')
    })

    it('should emit create events for new branches', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/refs/heads/**')

      const newBranchEvent = createWatchEvent('create', '/refs/heads/feature/new-feature', {
        size: 41,
      })

      const subscribers = emitToSubscribers(manager, newBranchEvent)
      expect(subscribers).toContain(ws1)
      expect((ws1 as MockWebSocket).receivedEvents[0].type).toBe('create')
    })

    it('should emit delete events for deleted branches', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/refs/heads/**')

      const deleteBranchEvent = createWatchEvent('delete', '/refs/heads/feature/old-feature')

      const subscribers = emitToSubscribers(manager, deleteBranchEvent)
      expect(subscribers).toContain(ws1)
      expect((ws1 as MockWebSocket).receivedEvents[0].type).toBe('delete')
    })
  })

  // ==========================================================================
  // Non-matching Paths Tests
  // ==========================================================================

  describe('non-matching paths do not trigger events', () => {
    it('should not match paths that do not fit any subscription pattern', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/*.ts')
      manager.subscribe(ws2 as unknown as WebSocket, '/test/**/*.spec.js')

      // Paths that should not match
      const noMatchPaths = [
        '/README.md',
        '/package.json',
        '/dist/bundle.js',
        '/node_modules/lodash/index.js',
        '/src/styles/main.css',
        '/test/setup.ts',
        '/src/lib/helper.ts', // nested, not matching *.ts at /src level
      ]

      for (const path of noMatchPaths) {
        const subscribers = manager.getSubscribersForPath(path)
        expect(subscribers).not.toContain(ws1)
        expect(subscribers).not.toContain(ws2)
      }
    })

    it('should not emit events to subscribers of unrelated patterns', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.ts')
      manager.subscribe(ws2 as unknown as WebSocket, '/test/**/*.ts')
      manager.subscribe(ws3 as unknown as WebSocket, '/docs/**')

      const srcEvent = createWatchEvent('modify', '/src/index.ts')
      const testEvent = createWatchEvent('modify', '/test/app.test.ts')
      const docsEvent = createWatchEvent('modify', '/docs/README.md')

      emitToSubscribers(manager, srcEvent)
      emitToSubscribers(manager, testEvent)
      emitToSubscribers(manager, docsEvent)

      // Each WebSocket should only receive events matching its pattern
      expect((ws1 as MockWebSocket).receivedEvents).toHaveLength(1)
      expect((ws1 as MockWebSocket).receivedEvents[0].path).toBe('/src/index.ts')

      expect((ws2 as MockWebSocket).receivedEvents).toHaveLength(1)
      expect((ws2 as MockWebSocket).receivedEvents[0].path).toBe('/test/app.test.ts')

      expect((ws3 as MockWebSocket).receivedEvents).toHaveLength(1)
      expect((ws3 as MockWebSocket).receivedEvents[0].path).toBe('/docs/README.md')
    })

    it('should handle case-sensitive pattern matching', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/*.TS')

      // Pattern is case-sensitive, so *.TS should not match .ts
      const matchesLowercase = manager.getSubscribersForPath('/src/index.ts')
      const matchesUppercase = manager.getSubscribersForPath('/src/INDEX.TS')

      expect(matchesLowercase).not.toContain(ws1)
      expect(matchesUppercase).toContain(ws1)
    })

    it('should not match partial path segments', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/*')

      // Should not match if path segment is only partially matching
      const matchesExact = manager.getSubscribersForPath('/src/file')
      const matchesWithExt = manager.getSubscribersForPath('/src/file.ts')
      const partialMatch = manager.getSubscribersForPath('/srcExtra/file.ts')
      const noMatch = manager.getSubscribersForPath('/source/file.ts')

      expect(matchesExact).toContain(ws1)
      expect(matchesWithExt).toContain(ws1)
      expect(partialMatch).not.toContain(ws1)
      expect(noMatch).not.toContain(ws1)
    })
  })

  // ==========================================================================
  // Multiple Glob Subscriptions Tests
  // ==========================================================================

  describe('multiple glob subscriptions', () => {
    it('should support multiple patterns for same connection', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.ts')
      manager.subscribe(ws1 as unknown as WebSocket, '/test/**/*.ts')
      manager.subscribe(ws1 as unknown as WebSocket, '/scripts/*.sh')

      const srcFile = '/src/lib/utils.ts'
      const testFile = '/test/unit/app.test.ts'
      const scriptFile = '/scripts/build.sh'
      const otherFile = '/docs/README.md'

      expect(manager.getSubscribersForPath(srcFile)).toContain(ws1)
      expect(manager.getSubscribersForPath(testFile)).toContain(ws1)
      expect(manager.getSubscribersForPath(scriptFile)).toContain(ws1)
      expect(manager.getSubscribersForPath(otherFile)).not.toContain(ws1)
    })

    it('should allow multiple connections with different patterns', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.ts')
      manager.subscribe(ws2 as unknown as WebSocket, '/src/**/*.js')
      manager.subscribe(ws3 as unknown as WebSocket, '/src/**')

      const tsFile = '/src/lib/utils.ts'
      const jsFile = '/src/lib/utils.js'

      const tsSubscribers = manager.getSubscribersForPath(tsFile)
      const jsSubscribers = manager.getSubscribersForPath(jsFile)

      // ws1 should get .ts files
      expect(tsSubscribers).toContain(ws1)
      expect(tsSubscribers).not.toContain(ws2)
      expect(tsSubscribers).toContain(ws3) // ** matches everything

      // ws2 should get .js files
      expect(jsSubscribers).not.toContain(ws1)
      expect(jsSubscribers).toContain(ws2)
      expect(jsSubscribers).toContain(ws3) // ** matches everything
    })

    it('should allow same pattern across multiple connections', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/refs/**')
      manager.subscribe(ws2 as unknown as WebSocket, '/refs/**')
      manager.subscribe(ws3 as unknown as WebSocket, '/refs/**')

      const refChange = '/refs/heads/main'
      const subscribers = manager.getSubscribersForPath(refChange)

      expect(subscribers).toContain(ws1)
      expect(subscribers).toContain(ws2)
      expect(subscribers).toContain(ws3)
      expect(subscribers).toHaveLength(3)
    })

    it('should broadcast events to all matching subscribers', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/**/*.ts')
      manager.subscribe(ws2 as unknown as WebSocket, '/src/**')
      manager.subscribe(ws3 as unknown as WebSocket, '/src/**/*.ts')

      const event = createWatchEvent('create', '/src/components/Button.ts', {
        size: 1024,
      })

      const subscribers = emitToSubscribers(manager, event)

      // All three patterns match this path
      expect(subscribers).toContain(ws1)
      expect(subscribers).toContain(ws2)
      expect(subscribers).toContain(ws3)

      expect((ws1 as MockWebSocket).receivedEvents).toHaveLength(1)
      expect((ws2 as MockWebSocket).receivedEvents).toHaveLength(1)
      expect((ws3 as MockWebSocket).receivedEvents).toHaveLength(1)
    })

    it('should handle overlapping patterns correctly', () => {
      // More specific pattern
      manager.subscribe(ws1 as unknown as WebSocket, '/src/components/*.tsx')
      // Broader pattern
      manager.subscribe(ws2 as unknown as WebSocket, '/src/**/*.tsx')
      // Even broader pattern
      manager.subscribe(ws3 as unknown as WebSocket, '/src/**')

      const directComponent = '/src/components/Button.tsx'
      const nestedComponent = '/src/components/ui/Card.tsx'

      const directSubscribers = manager.getSubscribersForPath(directComponent)
      const nestedSubscribers = manager.getSubscribersForPath(nestedComponent)

      // Direct component matches all three
      expect(directSubscribers).toContain(ws1)
      expect(directSubscribers).toContain(ws2)
      expect(directSubscribers).toContain(ws3)

      // Nested component only matches broader patterns
      expect(nestedSubscribers).not.toContain(ws1) // /*.tsx doesn't match nested
      expect(nestedSubscribers).toContain(ws2)
      expect(nestedSubscribers).toContain(ws3)
    })

    it('should correctly unsubscribe individual patterns', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.ts')
      manager.subscribe(ws1 as unknown as WebSocket, '/test/**/*.ts')

      // Unsubscribe from one pattern
      manager.unsubscribe(ws1 as unknown as WebSocket, '/src/**/*.ts')

      const srcFile = '/src/index.ts'
      const testFile = '/test/app.test.ts'

      expect(manager.getSubscribersForPath(srcFile)).not.toContain(ws1)
      expect(manager.getSubscribersForPath(testFile)).toContain(ws1)
    })
  })

  // ==========================================================================
  // Edge Cases and Special Patterns
  // ==========================================================================

  describe('edge cases and special patterns', () => {
    it('should handle pattern with multiple extensions like *.test.ts', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.test.ts')

      const matchesTestTs = manager.getSubscribersForPath('/src/lib/utils.test.ts')
      const matchesSpecTs = manager.getSubscribersForPath('/src/lib/utils.spec.ts')
      const matchesPlainTs = manager.getSubscribersForPath('/src/lib/utils.ts')

      expect(matchesTestTs).toContain(ws1)
      expect(matchesSpecTs).not.toContain(ws1)
      expect(matchesPlainTs).not.toContain(ws1)
    })

    it('should handle pattern for hidden files like /.*', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/.*')

      const matchesDotfile = manager.getSubscribersForPath('/.gitignore')
      const matchesHidden = manager.getSubscribersForPath('/.env')
      const matchesNormal = manager.getSubscribersForPath('/README')

      expect(matchesDotfile).toContain(ws1)
      expect(matchesHidden).toContain(ws1)
      expect(matchesNormal).not.toContain(ws1)
    })

    it('should handle deeply nested patterns', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/a/b/c/d/e/**/*.json')

      const matchesDeep = manager.getSubscribersForPath('/a/b/c/d/e/config.json')
      const matchesDeeperNested = manager.getSubscribersForPath('/a/b/c/d/e/f/g/h/data.json')
      const matchesWrongPath = manager.getSubscribersForPath('/a/b/c/config.json')

      expect(matchesDeep).toContain(ws1)
      expect(matchesDeeperNested).toContain(ws1)
      expect(matchesWrongPath).not.toContain(ws1)
    })

    it('should handle empty directory names in paths', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**')

      // Paths with consecutive slashes (which normalize to single slash)
      const normalPath = manager.getSubscribersForPath('/src/file.ts')

      expect(normalPath).toContain(ws1)
    })

    it('should handle subscriptions with special characters in directory names', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/[feature]/**')

      const matchesBrackets = manager.getSubscribersForPath('/src/[feature]/index.ts')
      const notMatchesDifferent = manager.getSubscribersForPath('/src/feature/index.ts')

      expect(matchesBrackets).toContain(ws1)
      expect(notMatchesDifferent).not.toContain(ws1)
    })

    it('should handle question mark wildcard for single character', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/file?.ts')

      const matchesSingleChar = manager.getSubscribersForPath('/src/file1.ts')
      const matchesAnotherChar = manager.getSubscribersForPath('/src/fileA.ts')
      const notMatchesMultiple = manager.getSubscribersForPath('/src/file12.ts')
      const notMatchesNone = manager.getSubscribersForPath('/src/file.ts')

      expect(matchesSingleChar).toContain(ws1)
      expect(matchesAnotherChar).toContain(ws1)
      expect(notMatchesMultiple).not.toContain(ws1)
      expect(notMatchesNone).not.toContain(ws1)
    })

    it('should handle character class patterns like [abc]', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/file[123].ts')

      const matches1 = manager.getSubscribersForPath('/src/file1.ts')
      const matches2 = manager.getSubscribersForPath('/src/file2.ts')
      const matches3 = manager.getSubscribersForPath('/src/file3.ts')
      const notMatches4 = manager.getSubscribersForPath('/src/file4.ts')
      const notMatchesA = manager.getSubscribersForPath('/src/fileA.ts')

      expect(matches1).toContain(ws1)
      expect(matches2).toContain(ws1)
      expect(matches3).toContain(ws1)
      expect(notMatches4).not.toContain(ws1)
      expect(notMatchesA).not.toContain(ws1)
    })
  })

  // ==========================================================================
  // Integration with Watch Events
  // ==========================================================================

  describe('integration with watch events', () => {
    it('should route create events to correct subscribers', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.ts')
      manager.subscribe(ws2 as unknown as WebSocket, '/test/**/*.ts')

      const srcCreate = createWatchEvent('create', '/src/new-file.ts', { size: 100 })
      const testCreate = createWatchEvent('create', '/test/new-test.ts', { size: 200 })

      emitToSubscribers(manager, srcCreate)
      emitToSubscribers(manager, testCreate)

      expect((ws1 as MockWebSocket).receivedEvents).toHaveLength(1)
      expect((ws1 as MockWebSocket).receivedEvents[0].path).toBe('/src/new-file.ts')

      expect((ws2 as MockWebSocket).receivedEvents).toHaveLength(1)
      expect((ws2 as MockWebSocket).receivedEvents[0].path).toBe('/test/new-test.ts')
    })

    it('should route rename events based on new path', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.ts')

      // Rename event: oldPath -> newPath
      const renameEvent = createWatchEvent('rename', '/src/old-name.ts', '/src/new-name.ts')

      const subscribers = emitToSubscribers(manager, renameEvent)

      expect(subscribers).toContain(ws1)
      expect((ws1 as MockWebSocket).receivedEvents[0].type).toBe('rename')
      expect((ws1 as MockWebSocket).receivedEvents[0].path).toBe('/src/new-name.ts')
      expect((ws1 as MockWebSocket).receivedEvents[0].oldPath).toBe('/src/old-name.ts')
    })

    it('should route delete events correctly', () => {
      manager.subscribe(ws1 as unknown as WebSocket, '/refs/heads/**')

      const deleteEvent = createWatchEvent('delete', '/refs/heads/feature/old-branch')

      const subscribers = emitToSubscribers(manager, deleteEvent)

      expect(subscribers).toContain(ws1)
      expect((ws1 as MockWebSocket).receivedEvents[0].type).toBe('delete')
    })

    it('should support watching for all file changes in a project', () => {
      // Common use case: IDE watching all source files
      manager.subscribe(ws1 as unknown as WebSocket, '/project/**')

      const events: WatchEvent[] = [
        createWatchEvent('create', '/project/src/index.ts'),
        createWatchEvent('modify', '/project/package.json'),
        createWatchEvent('delete', '/project/dist/old.js'),
        createWatchEvent('create', '/project/.env.local'),
      ]

      for (const event of events) {
        emitToSubscribers(manager, event)
      }

      expect((ws1 as MockWebSocket).receivedEvents).toHaveLength(4)
    })
  })
})

// ============================================================================
// Pattern Syntax Validation Tests
// ============================================================================

describe('Pattern Syntax Validation', () => {
  let manager: SubscriptionManager
  let ws: MockWebSocket

  beforeEach(() => {
    manager = new SubscriptionManager()
    ws = new MockWebSocket()
  })

  it('should recognize patterns containing *', () => {
    expect(manager.hasPattern('*.ts')).toBe(true)
    expect(manager.hasPattern('/src/*.ts')).toBe(true)
    expect(manager.hasPattern('/src/file.ts')).toBe(false)
  })

  it('should recognize patterns containing **', () => {
    expect(manager.hasPattern('**')).toBe(true)
    expect(manager.hasPattern('/src/**')).toBe(true)
    expect(manager.hasPattern('/src/**/*.ts')).toBe(true)
  })

  it('should get all matching patterns for a path', () => {
    manager.subscribe(ws as unknown as WebSocket, '/src/**')
    manager.subscribe(ws as unknown as WebSocket, '/src/**/*.ts')
    manager.subscribe(ws as unknown as WebSocket, '/src/lib/*')
    manager.subscribe(ws as unknown as WebSocket, '/test/**')

    const patterns = manager.getMatchingPatterns(
      ws as unknown as WebSocket,
      '/src/lib/utils.ts'
    )

    expect(patterns).toContain('/src/**')
    expect(patterns).toContain('/src/**/*.ts')
    expect(patterns).toContain('/src/lib/*')
    expect(patterns).not.toContain('/test/**')
  })
})
