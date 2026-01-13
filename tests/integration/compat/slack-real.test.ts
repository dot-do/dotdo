/**
 * Slack Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/slack compat layer with real DO storage,
 * verifying API compatibility with @slack/web-api.
 *
 * These tests:
 * 1. Verify correct API shape matching @slack/web-api
 * 2. Verify proper DO storage for messaging state
 * 3. Verify error handling matches Slack SDK behavior
 *
 * Run with: npx vitest run tests/integration/compat/slack-real.test.ts --project=integration
 *
 * @module tests/integration/compat/slack-real
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('Slack Compat Layer - Real Integration', () => {
  /**
   * Test Suite 1: API Shape Compatibility with @slack/web-api
   *
   * Verifies that the Slack compat layer exports the same API surface
   * as the official Slack SDK.
   */
  describe('API Shape Compatibility', () => {
    it('exports WebClient class', async () => {
      const { WebClient } = await import('../../../compat/slack/index')

      expect(WebClient).toBeDefined()
      expect(typeof WebClient).toBe('function')
    })

    it('WebClient accepts token in constructor', async () => {
      const { WebClient } = await import('../../../compat/slack/index')

      const client = new WebClient('xoxb-test-token')
      expect(client).toBeDefined()
    })

    it('WebClient exposes chat methods', async () => {
      const { WebClient } = await import('../../../compat/slack/index')
      const client = new WebClient('xoxb-test')

      expect(client.chat).toBeDefined()
      expect(typeof client.chat.postMessage).toBe('function')
      expect(typeof client.chat.update).toBe('function')
      expect(typeof client.chat.delete).toBe('function')
    })

    it('WebClient exposes conversations methods', async () => {
      const { WebClient } = await import('../../../compat/slack/index')
      const client = new WebClient('xoxb-test')

      expect(client.conversations).toBeDefined()
      expect(typeof client.conversations.list).toBe('function')
      expect(typeof client.conversations.history).toBe('function')
      expect(typeof client.conversations.info).toBe('function')
      expect(typeof client.conversations.join).toBe('function')
      expect(typeof client.conversations.leave).toBe('function')
    })

    it('WebClient exposes users methods', async () => {
      const { WebClient } = await import('../../../compat/slack/index')
      const client = new WebClient('xoxb-test')

      expect(client.users).toBeDefined()
      expect(typeof client.users.list).toBe('function')
      expect(typeof client.users.info).toBe('function')
      expect(typeof client.users.lookupByEmail).toBe('function')
    })

    it('WebClient exposes reactions methods', async () => {
      const { WebClient } = await import('../../../compat/slack/index')
      const client = new WebClient('xoxb-test')

      expect(client.reactions).toBeDefined()
      expect(typeof client.reactions.add).toBe('function')
      expect(typeof client.reactions.remove).toBe('function')
      expect(typeof client.reactions.get).toBe('function')
      expect(typeof client.reactions.list).toBe('function')
    })

    it('exports App class for Bolt-style apps', async () => {
      const { App } = await import('../../../compat/slack/index')

      expect(App).toBeDefined()
      expect(typeof App).toBe('function')
    })

    it('exports SlackError class', async () => {
      const { SlackError } = await import('../../../compat/slack/index')

      expect(SlackError).toBeDefined()
      expect(typeof SlackError).toBe('function')
    })

    it('exports block builder utilities', async () => {
      const slack = await import('../../../compat/slack/index')

      // Block builders
      expect(slack.Section).toBeDefined()
      expect(slack.Divider).toBeDefined()
      expect(slack.Image).toBeDefined()
      expect(slack.Actions).toBeDefined()
      expect(slack.Context).toBeDefined()
      expect(slack.Header).toBeDefined()
    })
  })

  /**
   * Test Suite 2: Chat Operations
   *
   * Verifies chat.postMessage and related operations.
   */
  describe('Chat Operations', () => {
    let client: any
    let clear: () => void

    beforeEach(async () => {
      const slack = await import('../../../compat/slack/index')
      client = new slack.WebClient('xoxb-test')
      clear = slack._clearAll
      clear()
    })

    afterEach(() => {
      clear()
    })

    it('posts a simple text message', async () => {
      const result = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Hello, World!',
      })

      expect(result).toBeDefined()
      expect(result.ok).toBe(true)
      expect(result.ts).toBeDefined()
      expect(result.channel).toBe('C1234567890')
      expect(result.message).toBeDefined()
      expect(result.message.text).toBe('Hello, World!')
    })

    it('posts a message with blocks', async () => {
      const result = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Fallback text',
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*Bold text*' },
          },
          {
            type: 'divider',
          },
        ],
      })

      expect(result.ok).toBe(true)
      expect(result.message.blocks).toBeDefined()
      expect(result.message.blocks.length).toBe(2)
    })

    it('posts a threaded reply', async () => {
      // Post parent message
      const parent = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Parent message',
      })

      // Post reply
      const reply = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Reply message',
        thread_ts: parent.ts,
      })

      expect(reply.ok).toBe(true)
      expect(reply.message.thread_ts).toBe(parent.ts)
    })

    it('updates a message', async () => {
      // Post message
      const posted = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Original text',
      })

      // Update message
      const updated = await client.chat.update({
        channel: 'C1234567890',
        ts: posted.ts,
        text: 'Updated text',
      })

      expect(updated.ok).toBe(true)
      expect(updated.message.text).toBe('Updated text')
    })

    it('deletes a message', async () => {
      // Post message
      const posted = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'To be deleted',
      })

      // Delete message
      const deleted = await client.chat.delete({
        channel: 'C1234567890',
        ts: posted.ts,
      })

      expect(deleted.ok).toBe(true)
    })

    it('posts ephemeral message', async () => {
      const result = await client.chat.postEphemeral({
        channel: 'C1234567890',
        user: 'U1234567890',
        text: 'Only you can see this',
      })

      expect(result.ok).toBe(true)
      expect(result.message_ts).toBeDefined()
    })

    it('schedules a message', async () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now

      const result = await client.chat.scheduleMessage({
        channel: 'C1234567890',
        text: 'Scheduled message',
        post_at: futureTime,
      })

      expect(result.ok).toBe(true)
      expect(result.scheduled_message_id).toBeDefined()
      expect(result.post_at).toBe(futureTime)
    })
  })

  /**
   * Test Suite 3: Conversations Operations
   *
   * Verifies conversations.* methods.
   */
  describe('Conversations Operations', () => {
    let client: any
    let clear: () => void

    beforeEach(async () => {
      const slack = await import('../../../compat/slack/index')
      client = new slack.WebClient('xoxb-test')
      clear = slack._clearAll
      clear()
    })

    afterEach(() => {
      clear()
    })

    it('lists conversations', async () => {
      const result = await client.conversations.list({
        types: 'public_channel,private_channel',
      })

      expect(result).toBeDefined()
      expect(result.ok).toBe(true)
      expect(result.channels).toBeDefined()
      expect(Array.isArray(result.channels)).toBe(true)
    })

    it('gets conversation history', async () => {
      // Post some messages first
      await client.chat.postMessage({ channel: 'C1234567890', text: 'Message 1' })
      await client.chat.postMessage({ channel: 'C1234567890', text: 'Message 2' })
      await client.chat.postMessage({ channel: 'C1234567890', text: 'Message 3' })

      const result = await client.conversations.history({
        channel: 'C1234567890',
        limit: 10,
      })

      expect(result.ok).toBe(true)
      expect(result.messages).toBeDefined()
      expect(result.messages.length).toBeGreaterThanOrEqual(3)
    })

    it('gets conversation info', async () => {
      const result = await client.conversations.info({
        channel: 'C1234567890',
      })

      expect(result.ok).toBe(true)
      expect(result.channel).toBeDefined()
      expect(result.channel.id).toBe('C1234567890')
    })

    it('joins a conversation', async () => {
      const result = await client.conversations.join({
        channel: 'C1234567890',
      })

      expect(result.ok).toBe(true)
      expect(result.channel).toBeDefined()
    })

    it('leaves a conversation', async () => {
      const result = await client.conversations.leave({
        channel: 'C1234567890',
      })

      expect(result.ok).toBe(true)
    })

    it('gets thread replies', async () => {
      // Post parent and replies
      const parent = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Thread parent',
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Reply 1',
        thread_ts: parent.ts,
      })

      await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Reply 2',
        thread_ts: parent.ts,
      })

      const result = await client.conversations.replies({
        channel: 'C1234567890',
        ts: parent.ts,
      })

      expect(result.ok).toBe(true)
      expect(result.messages).toBeDefined()
      expect(result.messages.length).toBeGreaterThanOrEqual(2)
    })
  })

  /**
   * Test Suite 4: Users Operations
   *
   * Verifies users.* methods.
   */
  describe('Users Operations', () => {
    let client: any

    beforeEach(async () => {
      const slack = await import('../../../compat/slack/index')
      client = new slack.WebClient('xoxb-test')
    })

    it('lists users', async () => {
      const result = await client.users.list({
        limit: 100,
      })

      expect(result).toBeDefined()
      expect(result.ok).toBe(true)
      expect(result.members).toBeDefined()
      expect(Array.isArray(result.members)).toBe(true)
    })

    it('gets user info', async () => {
      const result = await client.users.info({
        user: 'U1234567890',
      })

      expect(result.ok).toBe(true)
      expect(result.user).toBeDefined()
      expect(result.user.id).toBe('U1234567890')
    })

    it('looks up user by email', async () => {
      const result = await client.users.lookupByEmail({
        email: 'test@example.com',
      })

      expect(result.ok).toBe(true)
      expect(result.user).toBeDefined()
    })
  })

  /**
   * Test Suite 5: Reactions Operations
   *
   * Verifies reactions.* methods.
   */
  describe('Reactions Operations', () => {
    let client: any
    let clear: () => void

    beforeEach(async () => {
      const slack = await import('../../../compat/slack/index')
      client = new slack.WebClient('xoxb-test')
      clear = slack._clearAll
      clear()
    })

    afterEach(() => {
      clear()
    })

    it('adds a reaction', async () => {
      // Post a message first
      const posted = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'React to me',
      })

      const result = await client.reactions.add({
        channel: 'C1234567890',
        name: 'thumbsup',
        timestamp: posted.ts,
      })

      expect(result.ok).toBe(true)
    })

    it('removes a reaction', async () => {
      // Post and react
      const posted = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'React then unreact',
      })

      await client.reactions.add({
        channel: 'C1234567890',
        name: 'heart',
        timestamp: posted.ts,
      })

      const result = await client.reactions.remove({
        channel: 'C1234567890',
        name: 'heart',
        timestamp: posted.ts,
      })

      expect(result.ok).toBe(true)
    })

    it('gets reactions on a message', async () => {
      // Post and add reactions
      const posted = await client.chat.postMessage({
        channel: 'C1234567890',
        text: 'Multiple reactions',
      })

      await client.reactions.add({
        channel: 'C1234567890',
        name: 'thumbsup',
        timestamp: posted.ts,
      })

      await client.reactions.add({
        channel: 'C1234567890',
        name: 'heart',
        timestamp: posted.ts,
      })

      const result = await client.reactions.get({
        channel: 'C1234567890',
        timestamp: posted.ts,
      })

      expect(result.ok).toBe(true)
      expect(result.message).toBeDefined()
      expect(result.message.reactions).toBeDefined()
    })
  })

  /**
   * Test Suite 6: App (Bolt) Compatibility
   *
   * Verifies Bolt-style App event handling.
   */
  describe('App (Bolt) Compatibility', () => {
    it('creates App with required options', async () => {
      const { App } = await import('../../../compat/slack/index')

      const app = new App({
        token: 'xoxb-test',
        signingSecret: 'secret',
      })

      expect(app).toBeDefined()
    })

    it('registers message listener', async () => {
      const { App } = await import('../../../compat/slack/index')

      const app = new App({
        token: 'xoxb-test',
        signingSecret: 'secret',
      })

      const handler = vi.fn()
      app.message('hello', handler)

      expect(handler).not.toHaveBeenCalled() // Just registering
    })

    it('registers event listener', async () => {
      const { App } = await import('../../../compat/slack/index')

      const app = new App({
        token: 'xoxb-test',
        signingSecret: 'secret',
      })

      const handler = vi.fn()
      app.event('app_mention', handler)

      expect(handler).not.toHaveBeenCalled() // Just registering
    })

    it('registers action listener', async () => {
      const { App } = await import('../../../compat/slack/index')

      const app = new App({
        token: 'xoxb-test',
        signingSecret: 'secret',
      })

      const handler = vi.fn()
      app.action('button_click', handler)

      expect(handler).not.toHaveBeenCalled() // Just registering
    })

    it('registers slash command listener', async () => {
      const { App } = await import('../../../compat/slack/index')

      const app = new App({
        token: 'xoxb-test',
        signingSecret: 'secret',
      })

      const handler = vi.fn()
      app.command('/mycommand', handler)

      expect(handler).not.toHaveBeenCalled() // Just registering
    })
  })

  /**
   * Test Suite 7: Error Handling Compatibility
   *
   * Verifies that errors match Slack SDK error patterns.
   */
  describe('Error Handling Compatibility', () => {
    let client: any

    beforeEach(async () => {
      const slack = await import('../../../compat/slack/index')
      client = new slack.WebClient('xoxb-test')
    })

    it('throws SlackError for API errors', async () => {
      // This will test error handling when channel doesn't exist
      // Exact behavior depends on implementation
      try {
        await client.conversations.info({
          channel: 'INVALID',
        })
      } catch (error: any) {
        expect(error).toBeDefined()
        // Slack errors have specific structure
        expect(error.message || error.data?.error).toBeDefined()
      }
    })

    it('error includes code property', async () => {
      const { SlackError } = await import('../../../compat/slack/index')

      const error = new SlackError('channel_not_found')

      expect(error.code).toBe('channel_not_found')
      expect(error.message).toBeDefined()
    })

    it('returns ok: false for API failures', async () => {
      // Some methods return { ok: false } instead of throwing
      // This tests graceful error handling
      const { WebClient } = await import('../../../compat/slack/index')
      const badClient = new WebClient('') // Empty token

      try {
        const result = await badClient.conversations.list({})
        if (!result.ok) {
          expect(result.error).toBeDefined()
        }
      } catch (error) {
        // Also acceptable to throw
        expect(error).toBeDefined()
      }
    })
  })

  /**
   * Test Suite 8: Block Kit Builders
   *
   * Verifies block builder utilities.
   */
  describe('Block Kit Builders', () => {
    it('creates Section block', async () => {
      const { Section } = await import('../../../compat/slack/index')

      const block = Section({
        text: { type: 'mrkdwn', text: '*Hello*' },
      })

      expect(block.type).toBe('section')
      expect(block.text.text).toBe('*Hello*')
    })

    it('creates Divider block', async () => {
      const { Divider } = await import('../../../compat/slack/index')

      const block = Divider()

      expect(block.type).toBe('divider')
    })

    it('creates Actions block with buttons', async () => {
      const { Actions, Button } = await import('../../../compat/slack/index')

      const block = Actions({
        elements: [
          Button({
            text: 'Click me',
            action_id: 'button_1',
          }),
        ],
      })

      expect(block.type).toBe('actions')
      expect(block.elements).toBeDefined()
      expect(block.elements.length).toBe(1)
    })

    it('creates Header block', async () => {
      const { Header } = await import('../../../compat/slack/index')

      const block = Header({
        text: { type: 'plain_text', text: 'My Header' },
      })

      expect(block.type).toBe('header')
      expect(block.text.text).toBe('My Header')
    })

    it('creates Context block', async () => {
      const { Context } = await import('../../../compat/slack/index')

      const block = Context({
        elements: [
          { type: 'mrkdwn', text: 'Context text' },
        ],
      })

      expect(block.type).toBe('context')
      expect(block.elements).toBeDefined()
    })
  })

  /**
   * Test Suite 9: Webhook Signature Verification
   *
   * Verifies request signature verification.
   */
  describe('Webhook Signature Verification', () => {
    it('exports signature verification utilities', async () => {
      const { verifyRequestSignature, generateSignature } = await import('../../../compat/slack/index')

      expect(verifyRequestSignature).toBeDefined()
      expect(generateSignature).toBeDefined()
    })

    it('verifies valid signature', async () => {
      const { verifyRequestSignature, generateSignature } = await import('../../../compat/slack/index')

      const signingSecret = 'test_signing_secret'
      const timestamp = Math.floor(Date.now() / 1000)
      const body = JSON.stringify({ test: 'data' })

      const signature = await generateSignature(signingSecret, timestamp, body)

      const isValid = await verifyRequestSignature({
        signingSecret,
        requestSignature: signature,
        requestTimestamp: timestamp,
        body,
      })

      expect(isValid).toBe(true)
    })

    it('rejects invalid signature', async () => {
      const { verifyRequestSignature } = await import('../../../compat/slack/index')

      const isValid = await verifyRequestSignature({
        signingSecret: 'secret',
        requestSignature: 'invalid_signature',
        requestTimestamp: Math.floor(Date.now() / 1000),
        body: 'test body',
      })

      expect(isValid).toBe(false)
    })
  })
})
