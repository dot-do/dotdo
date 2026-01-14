/**
 * Tests for WebSocket subscription management
 *
 * These tests verify the SubscriptionManager class that handles
 * WebSocket connections subscribing to file system paths for
 * watch notifications.
 *
 * Test cases:
 * - Subscribe message adds path to subscription map
 * - Unsubscribe message removes path from subscription map
 * - Subscribe to multiple paths
 * - Unsubscribe from non-existent path (graceful handling)
 * - Invalid message format handling
 * - Connection cleanup on close
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SubscriptionManager } from './subscription'

/**
 * Mock WebSocket for testing
 */
class MockWebSocket {
  readyState: number = 1 // OPEN
  sentMessages: string[] = []
  closeCallCount = 0

  send(message: string): void {
    this.sentMessages.push(message)
  }

  close(): void {
    this.readyState = 3 // CLOSED
    this.closeCallCount++
  }
}

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager
  let ws1: MockWebSocket
  let ws2: MockWebSocket

  beforeEach(() => {
    manager = new SubscriptionManager()
    ws1 = new MockWebSocket()
    ws2 = new MockWebSocket()
  })

  describe('subscribe', () => {
    it('should add path to subscription map for a connection', () => {
      // Act
      manager.subscribe(ws1 as unknown as WebSocket, '/home/user')

      // Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/home/user')).toBe(true)
    })

    it('should allow subscribing to multiple paths', () => {
      // Act
      manager.subscribe(ws1 as unknown as WebSocket, '/home/user')
      manager.subscribe(ws1 as unknown as WebSocket, '/var/log')
      manager.subscribe(ws1 as unknown as WebSocket, '/etc/config')

      // Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/home/user')).toBe(true)
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/var/log')).toBe(true)
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/etc/config')).toBe(true)
    })

    it('should handle multiple connections subscribing to same path', () => {
      // Act
      manager.subscribe(ws1 as unknown as WebSocket, '/shared/data')
      manager.subscribe(ws2 as unknown as WebSocket, '/shared/data')

      // Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/shared/data')).toBe(true)
      expect(manager.isSubscribed(ws2 as unknown as WebSocket, '/shared/data')).toBe(true)
    })

    it('should handle duplicate subscriptions gracefully', () => {
      // Act - subscribe to same path twice
      manager.subscribe(ws1 as unknown as WebSocket, '/home/user')
      manager.subscribe(ws1 as unknown as WebSocket, '/home/user')

      // Assert - should still be subscribed, no error
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/home/user')).toBe(true)
      expect(manager.getSubscriptionCount(ws1 as unknown as WebSocket)).toBe(1)
    })

    it('should return true when subscription is added', () => {
      // Act & Assert
      expect(manager.subscribe(ws1 as unknown as WebSocket, '/new/path')).toBe(true)
    })

    it('should return false for duplicate subscription', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/existing/path')

      // Act & Assert
      expect(manager.subscribe(ws1 as unknown as WebSocket, '/existing/path')).toBe(false)
    })
  })

  describe('unsubscribe', () => {
    it('should remove path from subscription map', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/home/user')
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/home/user')).toBe(true)

      // Act
      manager.unsubscribe(ws1 as unknown as WebSocket, '/home/user')

      // Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/home/user')).toBe(false)
    })

    it('should handle unsubscribe from non-existent path gracefully', () => {
      // Act - should not throw
      expect(() => {
        manager.unsubscribe(ws1 as unknown as WebSocket, '/non/existent')
      }).not.toThrow()
    })

    it('should handle unsubscribe from unknown connection gracefully', () => {
      // Act - should not throw
      expect(() => {
        manager.unsubscribe(ws1 as unknown as WebSocket, '/some/path')
      }).not.toThrow()
    })

    it('should only remove specified path, keeping others', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/path/a')
      manager.subscribe(ws1 as unknown as WebSocket, '/path/b')
      manager.subscribe(ws1 as unknown as WebSocket, '/path/c')

      // Act
      manager.unsubscribe(ws1 as unknown as WebSocket, '/path/b')

      // Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/path/a')).toBe(true)
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/path/b')).toBe(false)
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/path/c')).toBe(true)
    })

    it('should return true when path was actually unsubscribed', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/existing/path')

      // Act & Assert
      expect(manager.unsubscribe(ws1 as unknown as WebSocket, '/existing/path')).toBe(true)
    })

    it('should return false when path was not subscribed', () => {
      // Act & Assert
      expect(manager.unsubscribe(ws1 as unknown as WebSocket, '/non/existent')).toBe(false)
    })
  })

  describe('isSubscribed', () => {
    it('should return false for unknown connection', () => {
      // Act & Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/any/path')).toBe(false)
    })

    it('should return false for unknown path on known connection', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/known/path')

      // Act & Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/unknown/path')).toBe(false)
    })

    it('should return true for subscribed path', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/subscribed/path')

      // Act & Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/subscribed/path')).toBe(true)
    })
  })

  describe('getSubscriptions', () => {
    it('should return empty array for unknown connection', () => {
      // Act & Assert
      expect(manager.getSubscriptions(ws1 as unknown as WebSocket)).toEqual([])
    })

    it('should return all subscribed paths for a connection', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/path/a')
      manager.subscribe(ws1 as unknown as WebSocket, '/path/b')

      // Act
      const subscriptions = manager.getSubscriptions(ws1 as unknown as WebSocket)

      // Assert
      expect(subscriptions).toHaveLength(2)
      expect(subscriptions).toContain('/path/a')
      expect(subscriptions).toContain('/path/b')
    })
  })

  describe('getSubscriptionCount', () => {
    it('should return 0 for unknown connection', () => {
      // Act & Assert
      expect(manager.getSubscriptionCount(ws1 as unknown as WebSocket)).toBe(0)
    })

    it('should return correct count', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/path/a')
      manager.subscribe(ws1 as unknown as WebSocket, '/path/b')
      manager.subscribe(ws1 as unknown as WebSocket, '/path/c')

      // Act & Assert
      expect(manager.getSubscriptionCount(ws1 as unknown as WebSocket)).toBe(3)
    })
  })

  describe('getSubscribersForPath', () => {
    it('should return empty array when no subscribers', () => {
      // Act & Assert
      expect(manager.getSubscribersForPath('/any/path')).toEqual([])
    })

    it('should return all connections subscribed to a path', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/shared/path')
      manager.subscribe(ws2 as unknown as WebSocket, '/shared/path')

      // Act
      const subscribers = manager.getSubscribersForPath('/shared/path')

      // Assert
      expect(subscribers).toHaveLength(2)
      expect(subscribers).toContain(ws1)
      expect(subscribers).toContain(ws2)
    })

    it('should not include connections subscribed to different paths', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/path/a')
      manager.subscribe(ws2 as unknown as WebSocket, '/path/b')

      // Act & Assert
      expect(manager.getSubscribersForPath('/path/a')).toEqual([ws1])
      expect(manager.getSubscribersForPath('/path/b')).toEqual([ws2])
    })
  })

  describe('removeConnection', () => {
    it('should remove all subscriptions for a connection', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/path/a')
      manager.subscribe(ws1 as unknown as WebSocket, '/path/b')
      manager.subscribe(ws1 as unknown as WebSocket, '/path/c')

      // Act
      manager.removeConnection(ws1 as unknown as WebSocket)

      // Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/path/a')).toBe(false)
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/path/b')).toBe(false)
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/path/c')).toBe(false)
      expect(manager.getSubscriptionCount(ws1 as unknown as WebSocket)).toBe(0)
    })

    it('should not affect other connections', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/shared/path')
      manager.subscribe(ws2 as unknown as WebSocket, '/shared/path')

      // Act
      manager.removeConnection(ws1 as unknown as WebSocket)

      // Assert
      expect(manager.isSubscribed(ws2 as unknown as WebSocket, '/shared/path')).toBe(true)
    })

    it('should handle removing unknown connection gracefully', () => {
      // Act - should not throw
      expect(() => {
        manager.removeConnection(ws1 as unknown as WebSocket)
      }).not.toThrow()
    })
  })

  describe('handleMessage', () => {
    it('should handle subscribe message', () => {
      // Act
      const result = manager.handleMessage(ws1 as unknown as WebSocket, JSON.stringify({
        type: 'subscribe',
        path: '/home/user',
      }))

      // Assert
      expect(result.success).toBe(true)
      expect(result.type).toBe('subscribe')
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/home/user')).toBe(true)
    })

    it('should handle unsubscribe message', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/home/user')

      // Act
      const result = manager.handleMessage(ws1 as unknown as WebSocket, JSON.stringify({
        type: 'unsubscribe',
        path: '/home/user',
      }))

      // Assert
      expect(result.success).toBe(true)
      expect(result.type).toBe('unsubscribe')
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/home/user')).toBe(false)
    })

    it('should return error for invalid JSON', () => {
      // Act
      const result = manager.handleMessage(ws1 as unknown as WebSocket, 'invalid json')

      // Assert
      expect(result.success).toBe(false)
      expect(result.error).toBe('invalid_json')
    })

    it('should return error for unknown message type', () => {
      // Act
      const result = manager.handleMessage(ws1 as unknown as WebSocket, JSON.stringify({
        type: 'unknown_type',
        path: '/some/path',
      }))

      // Assert
      expect(result.success).toBe(false)
      expect(result.error).toBe('unknown_type')
    })

    it('should return error for missing path', () => {
      // Act
      const result = manager.handleMessage(ws1 as unknown as WebSocket, JSON.stringify({
        type: 'subscribe',
      }))

      // Assert
      expect(result.success).toBe(false)
      expect(result.error).toBe('missing_path')
    })

    it('should return error for invalid path type', () => {
      // Act
      const result = manager.handleMessage(ws1 as unknown as WebSocket, JSON.stringify({
        type: 'subscribe',
        path: 123,
      }))

      // Assert
      expect(result.success).toBe(false)
      expect(result.error).toBe('invalid_path')
    })

    it('should return error for missing type', () => {
      // Act
      const result = manager.handleMessage(ws1 as unknown as WebSocket, JSON.stringify({
        path: '/some/path',
      }))

      // Assert
      expect(result.success).toBe(false)
      expect(result.error).toBe('missing_type')
    })
  })

  describe('connection count', () => {
    it('should track total connection count', () => {
      // Act
      manager.subscribe(ws1 as unknown as WebSocket, '/path/a')
      manager.subscribe(ws2 as unknown as WebSocket, '/path/b')

      // Assert
      expect(manager.getConnectionCount()).toBe(2)
    })

    it('should update count when connection is removed', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/path/a')
      manager.subscribe(ws2 as unknown as WebSocket, '/path/b')

      // Act
      manager.removeConnection(ws1 as unknown as WebSocket)

      // Assert
      expect(manager.getConnectionCount()).toBe(1)
    })

    it('should return 0 when no connections', () => {
      // Act & Assert
      expect(manager.getConnectionCount()).toBe(0)
    })
  })

  describe('path matching', () => {
    it('should normalize paths by removing trailing slashes', () => {
      // Act
      manager.subscribe(ws1 as unknown as WebSocket, '/home/user/')

      // Assert - should match both with and without trailing slash
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/home/user')).toBe(true)
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/home/user/')).toBe(true)
    })

    it('should handle root path correctly', () => {
      // Act
      manager.subscribe(ws1 as unknown as WebSocket, '/')

      // Assert
      expect(manager.isSubscribed(ws1 as unknown as WebSocket, '/')).toBe(true)
    })
  })
})

describe('SubscriptionMessage types', () => {
  it('should define subscribe message format', () => {
    const message = {
      type: 'subscribe' as const,
      path: '/home/user',
    }

    expect(message.type).toBe('subscribe')
    expect(typeof message.path).toBe('string')
  })

  it('should define unsubscribe message format', () => {
    const message = {
      type: 'unsubscribe' as const,
      path: '/home/user',
    }

    expect(message.type).toBe('unsubscribe')
    expect(typeof message.path).toBe('string')
  })
})

describe('Wildcard subscriptions', () => {
  let manager: SubscriptionManager
  let ws1: MockWebSocket
  let ws2: MockWebSocket

  beforeEach(() => {
    manager = new SubscriptionManager()
    ws1 = new MockWebSocket()
    ws2 = new MockWebSocket()
  })

  describe('single wildcard (*)', () => {
    it('should match files in a directory with /* pattern', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/home/*')

      // Act - check if subscriber matches various paths
      const matchesFile = manager.getSubscribersForPath('/home/user')
      const matchesNested = manager.getSubscribersForPath('/home/user/docs')
      const matchesRoot = manager.getSubscribersForPath('/home')

      // Assert
      expect(matchesFile).toContain(ws1)
      expect(matchesNested).not.toContain(ws1) // single * does not match nested
      expect(matchesRoot).not.toContain(ws1) // does not match parent
    })

    it('should match only direct children with * pattern', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/var/log/*')

      // Act
      const matchesDirectChild = manager.getSubscribersForPath('/var/log/app.log')
      const matchesDeepChild = manager.getSubscribersForPath('/var/log/nginx/access.log')

      // Assert
      expect(matchesDirectChild).toContain(ws1)
      expect(matchesDeepChild).not.toContain(ws1)
    })

    it('should match any segment with middle wildcard', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/home/*/documents')

      // Act
      const matchesUser1 = manager.getSubscribersForPath('/home/alice/documents')
      const matchesUser2 = manager.getSubscribersForPath('/home/bob/documents')
      const noMatch = manager.getSubscribersForPath('/home/documents')

      // Assert
      expect(matchesUser1).toContain(ws1)
      expect(matchesUser2).toContain(ws1)
      expect(noMatch).not.toContain(ws1)
    })
  })

  describe('recursive wildcard (**)', () => {
    it('should match all descendants with /** pattern', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/home/**')

      // Act
      const matchesChild = manager.getSubscribersForPath('/home/user')
      const matchesGrandchild = manager.getSubscribersForPath('/home/user/docs')
      const matchesDeep = manager.getSubscribersForPath('/home/user/docs/projects/foo/bar')
      const matchesParent = manager.getSubscribersForPath('/home')

      // Assert
      expect(matchesChild).toContain(ws1)
      expect(matchesGrandchild).toContain(ws1)
      expect(matchesDeep).toContain(ws1)
      expect(matchesParent).toContain(ws1) // ** includes the directory itself
    })

    it('should match everything with root /** pattern', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/**')

      // Act
      const matchesRoot = manager.getSubscribersForPath('/')
      const matchesFile = manager.getSubscribersForPath('/etc/config')
      const matchesDeep = manager.getSubscribersForPath('/var/log/nginx/access.log')

      // Assert
      expect(matchesRoot).toContain(ws1)
      expect(matchesFile).toContain(ws1)
      expect(matchesDeep).toContain(ws1)
    })

    it('should match nested patterns with middle **', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/home/**/config.json')

      // Act
      const matchesDirect = manager.getSubscribersForPath('/home/config.json')
      const matchesNested = manager.getSubscribersForPath('/home/user/config.json')
      const matchesDeep = manager.getSubscribersForPath('/home/user/projects/app/config.json')
      const noMatch = manager.getSubscribersForPath('/home/user/config.yaml')

      // Assert
      expect(matchesDirect).toContain(ws1)
      expect(matchesNested).toContain(ws1)
      expect(matchesDeep).toContain(ws1)
      expect(noMatch).not.toContain(ws1)
    })
  })

  describe('combined wildcards', () => {
    it('should handle patterns like /home/**/*.ts', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/src/**/*.ts')

      // Act
      const matchesRoot = manager.getSubscribersForPath('/src/index.ts')
      const matchesNested = manager.getSubscribersForPath('/src/lib/utils.ts')
      const matchesDeep = manager.getSubscribersForPath('/src/components/ui/button.ts')
      const noMatchWrongExt = manager.getSubscribersForPath('/src/index.js')
      const noMatchWrongDir = manager.getSubscribersForPath('/lib/index.ts')

      // Assert
      expect(matchesRoot).toContain(ws1)
      expect(matchesNested).toContain(ws1)
      expect(matchesDeep).toContain(ws1)
      expect(noMatchWrongExt).not.toContain(ws1)
      expect(noMatchWrongDir).not.toContain(ws1)
    })

    it('should handle patterns with multiple single wildcards', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/*/config/*')

      // Act
      const matchesApp = manager.getSubscribersForPath('/app/config/dev')
      const matchesLib = manager.getSubscribersForPath('/lib/config/prod')
      const noMatchDeep = manager.getSubscribersForPath('/app/config/env/local')

      // Assert
      expect(matchesApp).toContain(ws1)
      expect(matchesLib).toContain(ws1)
      expect(noMatchDeep).not.toContain(ws1)
    })
  })

  describe('subscription groups', () => {
    it('should support adding subscriptions to a named group', () => {
      // Act
      manager.subscribe(ws1 as unknown as WebSocket, '/home/*', { group: 'user-files' })
      manager.subscribe(ws1 as unknown as WebSocket, '/var/log/*', { group: 'logs' })

      // Assert
      const userFilesGroup = manager.getSubscriptionsByGroup(ws1 as unknown as WebSocket, 'user-files')
      const logsGroup = manager.getSubscriptionsByGroup(ws1 as unknown as WebSocket, 'logs')

      expect(userFilesGroup).toContain('/home/*')
      expect(logsGroup).toContain('/var/log/*')
    })

    it('should support unsubscribing by group', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/home/*', { group: 'user-files' })
      manager.subscribe(ws1 as unknown as WebSocket, '/home/shared/*', { group: 'user-files' })
      manager.subscribe(ws1 as unknown as WebSocket, '/var/log/*', { group: 'logs' })

      // Act
      manager.unsubscribeGroup(ws1 as unknown as WebSocket, 'user-files')

      // Assert
      const userFilesGroup = manager.getSubscriptionsByGroup(ws1 as unknown as WebSocket, 'user-files')
      const logsGroup = manager.getSubscriptionsByGroup(ws1 as unknown as WebSocket, 'logs')

      expect(userFilesGroup).toHaveLength(0)
      expect(logsGroup).toContain('/var/log/*')
    })
  })

  describe('subscription limits', () => {
    it('should enforce max subscriptions per connection', () => {
      // Arrange
      const limitedManager = new SubscriptionManager({ maxSubscriptionsPerConnection: 3 })

      // Act
      limitedManager.subscribe(ws1 as unknown as WebSocket, '/path/1')
      limitedManager.subscribe(ws1 as unknown as WebSocket, '/path/2')
      limitedManager.subscribe(ws1 as unknown as WebSocket, '/path/3')
      const result = limitedManager.subscribe(ws1 as unknown as WebSocket, '/path/4')

      // Assert
      expect(result).toBe(false)
      expect(limitedManager.getSubscriptionCount(ws1 as unknown as WebSocket)).toBe(3)
    })

    it('should return limit reached error in handleMessage', () => {
      // Arrange
      const limitedManager = new SubscriptionManager({ maxSubscriptionsPerConnection: 2 })
      limitedManager.subscribe(ws1 as unknown as WebSocket, '/path/1')
      limitedManager.subscribe(ws1 as unknown as WebSocket, '/path/2')

      // Act
      const result = limitedManager.handleMessage(
        ws1 as unknown as WebSocket,
        JSON.stringify({ type: 'subscribe', path: '/path/3' })
      )

      // Assert
      expect(result.success).toBe(false)
      expect(result.error).toBe('limit_reached')
    })
  })

  describe('pattern matching performance', () => {
    it('should efficiently match paths against many patterns', () => {
      // Arrange - subscribe to many patterns
      for (let i = 0; i < 100; i++) {
        manager.subscribe(ws1 as unknown as WebSocket, `/dir${i}/**`)
      }

      // Act - time the matching
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        manager.getSubscribersForPath('/dir50/nested/path/file.txt')
      }
      const elapsed = performance.now() - start

      // Assert - should complete quickly (under 100ms for 1000 matches)
      expect(elapsed).toBeLessThan(100)
    })
  })

  describe('hasPattern', () => {
    it('should detect if a subscription pattern is a wildcard', () => {
      // Act & Assert
      expect(manager.hasPattern('/home/*')).toBe(true)
      expect(manager.hasPattern('/home/**')).toBe(true)
      expect(manager.hasPattern('/home/*/docs')).toBe(true)
      expect(manager.hasPattern('/home/user')).toBe(false)
      expect(manager.hasPattern('/')).toBe(false)
    })
  })

  describe('getMatchingPatterns', () => {
    it('should return all patterns that match a given path', () => {
      // Arrange
      manager.subscribe(ws1 as unknown as WebSocket, '/home/**')
      manager.subscribe(ws1 as unknown as WebSocket, '/home/user/*')
      manager.subscribe(ws1 as unknown as WebSocket, '/home/user/docs')
      manager.subscribe(ws1 as unknown as WebSocket, '/var/**')

      // Act
      const patterns = manager.getMatchingPatterns(ws1 as unknown as WebSocket, '/home/user/docs')

      // Assert - should match multiple patterns
      expect(patterns).toContain('/home/**')
      expect(patterns).toContain('/home/user/*')
      expect(patterns).toContain('/home/user/docs')
      expect(patterns).not.toContain('/var/**')
    })
  })
})
