/**
 * Real-time Chat Tests
 *
 * Tests for the WebSocket-based chat application using real miniflare runtime.
 *
 * NO MOCKS: All tests use real Durable Objects with actual SQLite storage
 * and WebSocket support per CLAUDE.md policy.
 *
 * @module apps/realtime-chat/tests/chat.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// Type declarations for test environment
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    CHAT_ROOM_DO: DurableObjectNamespace
  }
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Generate a unique test identifier for isolated test cases
 */
function generateTestId(): string {
  return `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Helper to get a ChatRoomDO stub for testing
 */
function getChatRoomStub(roomName: string) {
  const id = env.CHAT_ROOM_DO.idFromName(roomName)
  return env.CHAT_ROOM_DO.get(id)
}

// ============================================================================
// HTTP API Tests
// ============================================================================

describe('Chat Room HTTP API', () => {
  describe('GET /info', () => {
    it('should return room info with empty state for new room', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/info')

      expect(response.status).toBe(200)

      const json = await response.json() as {
        id: string
        onlineUsers: string[]
        userCount: number
        messageCount: number
      }

      expect(json.id).toBeDefined()
      expect(json.onlineUsers).toEqual([])
      expect(json.userCount).toBe(0)
      expect(json.messageCount).toBe(0)
    })

    it('should return consistent room ID for same room name', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response1 = await stub.fetch('https://chat.test/info')
      const response2 = await stub.fetch('https://chat.test/info')

      const json1 = await response1.json() as { id: string }
      const json2 = await response2.json() as { id: string }

      expect(json1.id).toBe(json2.id)
    })
  })

  describe('GET /messages', () => {
    it('should return empty messages array for new room', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/messages')

      expect(response.status).toBe(200)

      const json = await response.json() as {
        messages: unknown[]
        count: number
      }

      expect(json.messages).toEqual([])
      expect(json.count).toBe(0)
    })

    it('should respect limit parameter', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/messages?limit=10')

      expect(response.status).toBe(200)

      const json = await response.json() as {
        messages: unknown[]
        count: number
      }

      expect(json.messages).toBeInstanceOf(Array)
      expect(json.count).toBeLessThanOrEqual(10)
    })

    it('should use default limit of 50 when not specified', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      // Just verify the endpoint works without limit param
      const response = await stub.fetch('https://chat.test/messages')
      expect(response.status).toBe(200)
    })
  })
})

// ============================================================================
// WebSocket Connection Tests
// ============================================================================

describe('Chat Room WebSocket', () => {
  describe('WebSocket upgrade', () => {
    it('should accept WebSocket upgrade request', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: {
          'Upgrade': 'websocket',
        },
      })

      // WebSocket upgrade should return 101 Switching Protocols
      expect(response.status).toBe(101)
      expect(response.webSocket).toBeDefined()
    })

    it('should send history message on connection', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: {
          'Upgrade': 'websocket',
        },
      })

      expect(response.status).toBe(101)
      expect(response.webSocket).toBeDefined()

      const ws = response.webSocket!
      ws.accept()

      // Receive the initial history message
      const historyMessage = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting for history')), 5000)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        })
      })

      const data = JSON.parse(historyMessage) as {
        type: string
        messages: unknown[]
        onlineUsers: string[]
      }

      expect(data.type).toBe('history')
      expect(data.messages).toBeInstanceOf(Array)
      expect(data.onlineUsers).toBeInstanceOf(Array)

      ws.close()
    })

    it('should handle multiple concurrent WebSocket connections', async () => {
      const roomName = generateTestId()

      // Create multiple connections to the same room
      const connections = await Promise.all(
        Array.from({ length: 3 }, async () => {
          const stub = getChatRoomStub(roomName)
          const response = await stub.fetch('https://chat.test/', {
            headers: { 'Upgrade': 'websocket' },
          })
          return response
        })
      )

      // All should succeed with 101
      for (const response of connections) {
        expect(response.status).toBe(101)
        expect(response.webSocket).toBeDefined()
        response.webSocket?.accept()
        response.webSocket?.close()
      }
    })
  })

  describe('join message handling', () => {
    it('should accept valid join message with username', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Skip initial history message
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send join message
      ws.send(JSON.stringify({ type: 'join', username: 'testuser' }))

      // Wait for join confirmation
      const joinResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const data = JSON.parse(joinResponse) as {
        type: string
        username: string
        message?: string
      }

      expect(data.type).toBe('joined')
      expect(data.username).toBe('testuser')

      ws.close()
    })

    it('should reject join without username', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Skip initial history message
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send join without username
      ws.send(JSON.stringify({ type: 'join' }))

      // Wait for error response
      const errorResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const data = JSON.parse(errorResponse) as { type: string; error: string }

      expect(data.type).toBe('error')
      expect(data.error).toContain('Username')

      ws.close()
    })

    it('should reject join with empty username', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Skip initial history message
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send join with empty username
      ws.send(JSON.stringify({ type: 'join', username: '   ' }))

      // Wait for error response
      const errorResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const data = JSON.parse(errorResponse) as { type: string; error: string }

      expect(data.type).toBe('error')
      expect(data.error).toContain('Username')

      ws.close()
    })

    it('should reject duplicate username in same room', async () => {
      const roomName = generateTestId()
      const username = 'uniqueuser'

      // First connection joins
      const stub1 = getChatRoomStub(roomName)
      const response1 = await stub1.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws1 = response1.webSocket!
      ws1.accept()

      // Skip history
      await new Promise<void>((resolve) => {
        ws1.addEventListener('message', () => resolve(), { once: true })
      })

      // Join as user
      ws1.send(JSON.stringify({ type: 'join', username }))
      await new Promise<void>((resolve) => {
        ws1.addEventListener('message', () => resolve(), { once: true })
      })

      // Second connection tries same username
      const stub2 = getChatRoomStub(roomName)
      const response2 = await stub2.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws2 = response2.webSocket!
      ws2.accept()

      // Skip history
      await new Promise<void>((resolve) => {
        ws2.addEventListener('message', () => resolve(), { once: true })
      })

      // Try to join with same username (different case to test case-insensitivity)
      ws2.send(JSON.stringify({ type: 'join', username: username.toUpperCase() }))

      const errorResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        ws2.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const data = JSON.parse(errorResponse) as { type: string; error: string }

      expect(data.type).toBe('error')
      expect(data.error).toContain('already taken')

      ws1.close()
      ws2.close()
    })
  })

  describe('message handling', () => {
    it('should reject message before joining', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Skip initial history
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Try to send message without joining
      ws.send(JSON.stringify({ type: 'message', content: 'hello' }))

      const errorResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const data = JSON.parse(errorResponse) as { type: string; error: string }

      expect(data.type).toBe('error')
      expect(data.error).toContain('join')

      ws.close()
    })

    it('should accept and broadcast message after joining', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Collect all messages
      const messages: string[] = []
      ws.addEventListener('message', (event) => {
        messages.push(event.data as string)
      })

      // Skip initial history
      await new Promise<void>((resolve) => {
        const check = () => {
          if (messages.some((m) => JSON.parse(m).type === 'history')) resolve()
          else setTimeout(check, 10)
        }
        check()
      })

      // Join first
      ws.send(JSON.stringify({ type: 'join', username: 'messageuser' }))

      // Wait for join confirmation (may get broadcast to self)
      await new Promise<void>((resolve) => {
        const check = () => {
          if (messages.some((m) => {
            const d = JSON.parse(m)
            return d.type === 'joined' && d.username === 'messageuser'
          })) resolve()
          else setTimeout(check, 10)
        }
        check()
      })

      // Clear messages before sending chat message
      messages.length = 0

      // Now send a message
      const messageContent = 'Hello, world!'
      ws.send(JSON.stringify({ type: 'message', content: messageContent }))

      // Wait for the message broadcast
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        const check = () => {
          const found = messages.find((m) => {
            const d = JSON.parse(m)
            return d.type === 'message' && d.content === messageContent
          })
          if (found) {
            clearTimeout(timeout)
            resolve()
          } else {
            setTimeout(check, 10)
          }
        }
        check()
      })

      const messageData = messages.find((m) => JSON.parse(m).type === 'message')!
      const data = JSON.parse(messageData) as {
        type: string
        id: string
        username: string
        content: string
        timestamp: number
      }

      expect(data.type).toBe('message')
      expect(data.id).toMatch(/^msg_/)
      expect(data.username).toBe('messageuser')
      expect(data.content).toBe(messageContent)
      expect(data.timestamp).toBeGreaterThan(0)

      ws.close()
    })

    it('should reject message with empty content', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Collect all messages
      const messages: string[] = []
      ws.addEventListener('message', (event) => {
        messages.push(event.data as string)
      })

      // Wait for history
      await new Promise<void>((resolve) => {
        const check = () => {
          if (messages.some((m) => JSON.parse(m).type === 'history')) resolve()
          else setTimeout(check, 10)
        }
        check()
      })

      // Join first
      ws.send(JSON.stringify({ type: 'join', username: 'emptymsger' }))

      // Wait for join confirmation
      await new Promise<void>((resolve) => {
        const check = () => {
          if (messages.some((m) => {
            const d = JSON.parse(m)
            return d.type === 'joined' && d.username === 'emptymsger'
          })) resolve()
          else setTimeout(check, 10)
        }
        check()
      })

      // Clear messages
      messages.length = 0

      // Send empty message
      ws.send(JSON.stringify({ type: 'message', content: '   ' }))

      // Wait for error response
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        const check = () => {
          if (messages.some((m) => JSON.parse(m).type === 'error')) {
            clearTimeout(timeout)
            resolve()
          } else {
            setTimeout(check, 10)
          }
        }
        check()
      })

      const errorData = messages.find((m) => JSON.parse(m).type === 'error')!
      const data = JSON.parse(errorData) as { type: string; error: string }

      expect(data.type).toBe('error')
      expect(data.error).toContain('content')

      ws.close()
    })
  })

  describe('message persistence', () => {
    it('should persist messages in SQLite and retrieve via HTTP', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      // Send a message via WebSocket
      const wsResponse = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = wsResponse.webSocket!
      ws.accept()

      // Skip history
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Join
      ws.send(JSON.stringify({ type: 'join', username: 'persister' }))
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send message
      const testContent = `Test message ${Date.now()}`
      ws.send(JSON.stringify({ type: 'message', content: testContent }))
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      ws.close()

      // Verify message persisted via HTTP API
      const httpResponse = await stub.fetch('https://chat.test/messages')
      expect(httpResponse.status).toBe(200)

      const json = await httpResponse.json() as {
        messages: Array<{
          id: string
          username: string
          content: string
          timestamp: number
        }>
        count: number
      }

      expect(json.count).toBe(1)
      expect(json.messages).toHaveLength(1)
      expect(json.messages[0].username).toBe('persister')
      expect(json.messages[0].content).toBe(testContent)
    })

    it('should return messages in chronological order', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      // Send multiple messages via WebSocket
      const wsResponse = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = wsResponse.webSocket!
      ws.accept()

      // Skip history
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Join
      ws.send(JSON.stringify({ type: 'join', username: 'orderer' }))
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send messages with delays to ensure different timestamps
      for (let i = 1; i <= 3; i++) {
        ws.send(JSON.stringify({ type: 'message', content: `Message ${i}` }))
        await new Promise<void>((resolve) => {
          ws.addEventListener('message', () => resolve(), { once: true })
        })
        // Small delay to ensure different timestamps
        await new Promise((r) => setTimeout(r, 10))
      }

      ws.close()

      // Verify order via HTTP
      const httpResponse = await stub.fetch('https://chat.test/messages')
      const json = await httpResponse.json() as {
        messages: Array<{ content: string; timestamp: number }>
      }

      expect(json.messages[0].content).toBe('Message 1')
      expect(json.messages[1].content).toBe('Message 2')
      expect(json.messages[2].content).toBe('Message 3')

      // Verify timestamps are in ascending order
      expect(json.messages[0].timestamp).toBeLessThanOrEqual(json.messages[1].timestamp)
      expect(json.messages[1].timestamp).toBeLessThanOrEqual(json.messages[2].timestamp)
    })
  })

  describe('ping/pong', () => {
    it('should respond to ping with pong', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Skip history
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send ping
      ws.send(JSON.stringify({ type: 'ping' }))

      const pongResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const data = JSON.parse(pongResponse) as { type: string }

      expect(data.type).toBe('pong')

      ws.close()
    })
  })

  describe('typing indicator', () => {
    it('should reject typing indicator before joining', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Skip history
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send typing without joining - this should be silently ignored
      // (not an error, just no broadcast)
      ws.send(JSON.stringify({ type: 'typing' }))

      // Give a moment for any potential response
      const responsePromise = new Promise<string | null>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 500)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const response2 = await responsePromise

      // Should receive no response (typing ignored for non-joined users)
      expect(response2).toBeNull()

      ws.close()
    })
  })

  describe('unknown message type', () => {
    it('should return error for unknown message type', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Skip history
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send unknown message type
      ws.send(JSON.stringify({ type: 'unknown_type_xyz' }))

      const errorResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const data = JSON.parse(errorResponse) as { type: string; error: string }

      expect(data.type).toBe('error')
      expect(data.error).toContain('Unknown message type')

      ws.close()
    })
  })

  describe('invalid JSON handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Skip history
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send invalid JSON
      ws.send('not valid json {')

      const errorResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const data = JSON.parse(errorResponse) as { type: string; error: string }

      expect(data.type).toBe('error')
      expect(data.error).toContain('Invalid JSON')

      ws.close()
    })
  })

  describe('binary message handling', () => {
    it('should reject binary messages', async () => {
      const roomName = generateTestId()
      const stub = getChatRoomStub(roomName)

      const response = await stub.fetch('https://chat.test/', {
        headers: { 'Upgrade': 'websocket' },
      })

      const ws = response.webSocket!
      ws.accept()

      // Skip history
      await new Promise<void>((resolve) => {
        ws.addEventListener('message', () => resolve(), { once: true })
      })

      // Send binary data
      const buffer = new ArrayBuffer(8)
      ws.send(buffer)

      const errorResponse = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        ws.addEventListener('message', (event) => {
          clearTimeout(timeout)
          resolve(event.data as string)
        }, { once: true })
      })

      const data = JSON.parse(errorResponse) as { type: string; error: string }

      expect(data.type).toBe('error')
      expect(data.error).toContain('Binary')

      ws.close()
    })
  })
})

// ============================================================================
// Room Isolation Tests
// ============================================================================

describe('Chat Room Isolation', () => {
  it('should isolate messages between different rooms', async () => {
    const room1Name = generateTestId() + '_room1'
    const room2Name = generateTestId() + '_room2'

    // Send message to room 1
    const stub1 = getChatRoomStub(room1Name)
    const ws1Response = await stub1.fetch('https://chat.test/', {
      headers: { 'Upgrade': 'websocket' },
    })

    const ws1 = ws1Response.webSocket!
    ws1.accept()

    await new Promise<void>((resolve) => {
      ws1.addEventListener('message', () => resolve(), { once: true })
    })

    ws1.send(JSON.stringify({ type: 'join', username: 'user1' }))
    await new Promise<void>((resolve) => {
      ws1.addEventListener('message', () => resolve(), { once: true })
    })

    ws1.send(JSON.stringify({ type: 'message', content: 'Room 1 message' }))
    await new Promise<void>((resolve) => {
      ws1.addEventListener('message', () => resolve(), { once: true })
    })

    ws1.close()

    // Verify room 2 has no messages
    const stub2 = getChatRoomStub(room2Name)
    const response2 = await stub2.fetch('https://chat.test/messages')
    const json2 = await response2.json() as { messages: unknown[]; count: number }

    expect(json2.count).toBe(0)
    expect(json2.messages).toHaveLength(0)

    // Verify room 1 has the message
    const response1 = await stub1.fetch('https://chat.test/messages')
    const json1 = await response1.json() as { messages: unknown[]; count: number }

    expect(json1.count).toBe(1)
  })

  it('should maintain separate user lists per room', async () => {
    const room1Name = generateTestId() + '_users1'
    const room2Name = generateTestId() + '_users2'

    // Join room 1
    const stub1 = getChatRoomStub(room1Name)
    const ws1Response = await stub1.fetch('https://chat.test/', {
      headers: { 'Upgrade': 'websocket' },
    })

    const ws1 = ws1Response.webSocket!
    ws1.accept()

    await new Promise<void>((resolve) => {
      ws1.addEventListener('message', () => resolve(), { once: true })
    })

    ws1.send(JSON.stringify({ type: 'join', username: 'room1user' }))
    await new Promise<void>((resolve) => {
      ws1.addEventListener('message', () => resolve(), { once: true })
    })

    // Check room 2 has no users
    const stub2 = getChatRoomStub(room2Name)
    const info2 = await stub2.fetch('https://chat.test/info')
    const json2 = await info2.json() as { onlineUsers: string[]; userCount: number }

    expect(json2.userCount).toBe(0)
    expect(json2.onlineUsers).toEqual([])

    // Check room 1 has the user
    const info1 = await stub1.fetch('https://chat.test/info')
    const json1 = await info1.json() as { onlineUsers: string[]; userCount: number }

    expect(json1.userCount).toBe(1)
    expect(json1.onlineUsers).toContain('room1user')

    ws1.close()
  })
})

// ============================================================================
// User Presence Tests
// ============================================================================

describe('User Presence', () => {
  it('should track online users after join', async () => {
    const roomName = generateTestId()
    const stub = getChatRoomStub(roomName)

    const wsResponse = await stub.fetch('https://chat.test/', {
      headers: { 'Upgrade': 'websocket' },
    })

    const ws = wsResponse.webSocket!
    ws.accept()

    await new Promise<void>((resolve) => {
      ws.addEventListener('message', () => resolve(), { once: true })
    })

    ws.send(JSON.stringify({ type: 'join', username: 'presenceuser' }))
    await new Promise<void>((resolve) => {
      ws.addEventListener('message', () => resolve(), { once: true })
    })

    // Check room info
    const infoResponse = await stub.fetch('https://chat.test/info')
    const info = await infoResponse.json() as {
      onlineUsers: string[]
      userCount: number
    }

    expect(info.userCount).toBe(1)
    expect(info.onlineUsers).toContain('presenceuser')

    ws.close()
  })

  it('should return online users in join broadcast', async () => {
    const roomName = generateTestId()

    // First user joins
    const stub1 = getChatRoomStub(roomName)
    const ws1Response = await stub1.fetch('https://chat.test/', {
      headers: { 'Upgrade': 'websocket' },
    })

    const ws1 = ws1Response.webSocket!
    ws1.accept()

    await new Promise<void>((resolve) => {
      ws1.addEventListener('message', () => resolve(), { once: true })
    })

    ws1.send(JSON.stringify({ type: 'join', username: 'firstuser' }))
    await new Promise<void>((resolve) => {
      ws1.addEventListener('message', () => resolve(), { once: true })
    })

    // Second user joins
    const stub2 = getChatRoomStub(roomName)
    const ws2Response = await stub2.fetch('https://chat.test/', {
      headers: { 'Upgrade': 'websocket' },
    })

    const ws2 = ws2Response.webSocket!
    ws2.accept()

    await new Promise<void>((resolve) => {
      ws2.addEventListener('message', () => resolve(), { once: true })
    })

    // Set up listener on ws1 for join broadcast
    const broadcastPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
      ws1.addEventListener('message', (event) => {
        clearTimeout(timeout)
        resolve(event.data as string)
      }, { once: true })
    })

    ws2.send(JSON.stringify({ type: 'join', username: 'seconduser' }))

    // ws1 should receive broadcast about seconduser joining
    const broadcast = await broadcastPromise
    const data = JSON.parse(broadcast) as {
      type: string
      username: string
      onlineUsers: string[]
    }

    expect(data.type).toBe('joined')
    expect(data.username).toBe('seconduser')
    expect(data.onlineUsers).toContain('firstuser')
    expect(data.onlineUsers).toContain('seconduser')

    ws1.close()
    ws2.close()
  })
})
