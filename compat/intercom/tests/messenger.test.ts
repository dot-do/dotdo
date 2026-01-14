/**
 * @dotdo/intercom - Messenger Tests
 *
 * Tests for both MessengerLocal (edge-native) and MessengerResource (API-backed):
 * - Widget configuration (colors, position, padding)
 * - Home screen apps and cards
 * - Help center integration
 * - Custom actions
 * - Identity verification
 * - Launcher customization
 * - Message templates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IntercomLocal } from '../local'
import { MessengerLocal } from '../messenger'
import { Client } from '../client'

// =============================================================================
// MessengerLocal Tests
// =============================================================================

describe('@dotdo/intercom - MessengerLocal', () => {
  let messenger: MessengerLocal

  beforeEach(() => {
    messenger = new MessengerLocal('test_workspace')
  })

  describe('initialization', () => {
    it('should create a messenger instance', () => {
      expect(messenger).toBeDefined()
    })
  })

  // ===========================================================================
  // Widget Configuration
  // ===========================================================================

  describe('widget configuration', () => {
    it('should configure messenger appearance', async () => {
      const config = await messenger.configureMessenger({
        color: '#0066FF',
        position: 'right',
        alignment: 'bottom',
        horizontalPadding: 20,
        verticalPadding: 20,
      })

      expect(config.color).toBe('#0066FF')
      expect(config.position).toBe('right')
      expect(config.alignment).toBe('bottom')
      expect(config.horizontalPadding).toBe(20)
      expect(config.verticalPadding).toBe(20)
      expect(config.workspaceId).toBe('test_workspace')
    })

    it('should get default messenger config', async () => {
      const config = await messenger.getMessengerConfig()

      expect(config.id).toBeDefined()
      expect(config.color).toBe('#0066FF')
      expect(config.position).toBe('right')
      expect(config.alignment).toBe('bottom')
      expect(config.launcherVisible).toBe(true)
      expect(config.showPoweredBy).toBe(true)
    })

    it('should update existing configuration', async () => {
      await messenger.configureMessenger({
        color: '#FF0000',
      })

      const updated = await messenger.configureMessenger({
        position: 'left',
      })

      expect(updated.color).toBe('#FF0000')
      expect(updated.position).toBe('left')
    })

    it('should update launcher logo', async () => {
      const config = await messenger.updateLauncherLogo('https://example.com/logo.png')
      expect(config.launcherLogo).toBe('https://example.com/logo.png')
    })

    it('should remove launcher logo', async () => {
      await messenger.updateLauncherLogo('https://example.com/logo.png')
      const config = await messenger.updateLauncherLogo(null)
      expect(config.launcherLogo).toBeNull()
    })

    it('should set launcher visibility', async () => {
      const hidden = await messenger.setLauncherVisibility(false)
      expect(hidden.launcherVisible).toBe(false)

      const visible = await messenger.setLauncherVisibility(true)
      expect(visible.launcherVisible).toBe(true)
    })
  })

  // ===========================================================================
  // Home Screen
  // ===========================================================================

  describe('home screen', () => {
    it('should configure home screen apps', async () => {
      const result = await messenger.setHomeScreenApps([
        { id: 'app_1', name: 'App 1', enabled: true, order: 0 },
        { id: 'app_2', name: 'App 2', enabled: false, order: 1 },
      ])

      expect(result.apps).toHaveLength(2)
      expect(result.apps[0].id).toBe('app_1')
      expect(result.apps[0].enabled).toBe(true)
      expect(result.apps[1].enabled).toBe(false)
    })

    it('should add home screen card', async () => {
      const card = await messenger.addHomeScreenCard({
        type: 'conversation_card',
        title: 'Talk to Sales',
        body: 'Get help from our team',
        action: { type: 'start_conversation' },
      })

      expect(card.id).toBeDefined()
      expect(card.type).toBe('conversation_card')
      expect(card.title).toBe('Talk to Sales')
      expect(card.body).toBe('Get help from our team')
      expect(card.action?.type).toBe('start_conversation')
      expect(card.enabled).toBe(true)
      expect(card.order).toBe(0)
    })

    it('should add multiple home screen cards', async () => {
      const card1 = await messenger.addHomeScreenCard({
        type: 'conversation_card',
        title: 'Card 1',
        body: 'Body 1',
      })

      const card2 = await messenger.addHomeScreenCard({
        type: 'article_card',
        title: 'Card 2',
        body: 'Body 2',
      })

      expect(card1.order).toBe(0)
      expect(card2.order).toBe(1)

      const cards = await messenger.getHomeScreenCards()
      expect(cards).toHaveLength(2)
    })

    it('should remove home screen card', async () => {
      const card = await messenger.addHomeScreenCard({
        type: 'conversation_card',
        title: 'To Remove',
        body: 'Will be removed',
      })

      const result = await messenger.removeHomeScreenCard(card.id)
      expect(result.id).toBe(card.id)
      expect(result.deleted).toBe(true)

      const cards = await messenger.getHomeScreenCards()
      expect(cards).toHaveLength(0)
    })

    it('should throw when removing non-existent card', async () => {
      await expect(messenger.removeHomeScreenCard('nonexistent')).rejects.toThrow(
        'Card not found: nonexistent'
      )
    })

    it('should reorder home screen cards', async () => {
      const card1 = await messenger.addHomeScreenCard({
        type: 'conversation_card',
        title: 'First',
        body: 'First card',
      })

      const card2 = await messenger.addHomeScreenCard({
        type: 'article_card',
        title: 'Second',
        body: 'Second card',
      })

      const card3 = await messenger.addHomeScreenCard({
        type: 'help_center_card',
        title: 'Third',
        body: 'Third card',
      })

      // Reorder: Third, First, Second
      const result = await messenger.reorderHomeScreenCards([card3.id, card1.id, card2.id])

      expect(result.cards[0].id).toBe(card3.id)
      expect(result.cards[0].order).toBe(0)
      expect(result.cards[1].id).toBe(card1.id)
      expect(result.cards[1].order).toBe(1)
      expect(result.cards[2].id).toBe(card2.id)
      expect(result.cards[2].order).toBe(2)
    })

    it('should add card with icon', async () => {
      const card = await messenger.addHomeScreenCard({
        type: 'custom_card',
        title: 'Custom',
        body: 'Custom card',
        icon: 'https://example.com/icon.png',
      })

      expect(card.icon).toBe('https://example.com/icon.png')
    })

    it('should add disabled card', async () => {
      const card = await messenger.addHomeScreenCard({
        type: 'news_card',
        title: 'Disabled Card',
        body: 'This card is disabled',
        enabled: false,
      })

      expect(card.enabled).toBe(false)
    })
  })

  // ===========================================================================
  // Help Center Integration
  // ===========================================================================

  describe('help center', () => {
    it('should enable help center', async () => {
      const config = await messenger.enableHelpCenter()
      expect(config.enabled).toBe(true)
      expect(config.collectionIds).toBeNull()
    })

    it('should enable help center with specific collections', async () => {
      const config = await messenger.enableHelpCenter(['collection_1', 'collection_2'])
      expect(config.enabled).toBe(true)
      expect(config.collectionIds).toEqual(['collection_1', 'collection_2'])
    })

    it('should disable help center', async () => {
      await messenger.enableHelpCenter()
      const config = await messenger.disableHelpCenter()
      expect(config.enabled).toBe(false)
    })

    it('should set help center locale', async () => {
      const config = await messenger.setHelpCenterLocale('es')
      expect(config.locale).toBe('es')
    })

    it('should get help center config', async () => {
      await messenger.enableHelpCenter(['collection_1'])
      await messenger.setHelpCenterLocale('fr')

      const config = await messenger.getHelpCenterConfig()
      expect(config.enabled).toBe(true)
      expect(config.collectionIds).toEqual(['collection_1'])
      expect(config.locale).toBe('fr')
      expect(config.showSearch).toBe(true)
    })

    it('should search help articles (stub returns empty)', async () => {
      const results = await messenger.searchHelpArticles('getting started')
      expect(results.type).toBe('list')
      expect(results.data).toHaveLength(0)
    })
  })

  // ===========================================================================
  // Custom Actions
  // ===========================================================================

  describe('custom actions', () => {
    it('should register custom action', async () => {
      const action = await messenger.registerCustomAction('book_demo', {
        label: 'Book a Demo',
        description: 'Schedule a product demo',
        icon: 'https://example.com/demo-icon.png',
      })

      expect(action.id).toBe('book_demo')
      expect(action.label).toBe('Book a Demo')
      expect(action.description).toBe('Schedule a product demo')
      expect(action.icon).toBe('https://example.com/demo-icon.png')
      expect(action.enabled).toBe(true)
    })

    it('should register custom action with handler', async () => {
      const handler = vi.fn()

      await messenger.registerCustomAction('test_action', {
        label: 'Test Action',
        handler,
      })

      await messenger.triggerCustomAction('test_action', {
        userId: 'user_123',
        email: 'user@example.com',
      })

      expect(handler).toHaveBeenCalledWith({
        userId: 'user_123',
        email: 'user@example.com',
      })
    })

    it('should trigger custom action', async () => {
      await messenger.registerCustomAction('trigger_test', {
        label: 'Trigger Test',
      })

      const result = await messenger.triggerCustomAction('trigger_test', {
        userId: 'user_456',
        data: { key: 'value' },
      })

      expect(result.triggered).toBe(true)
      expect(result.actionId).toBe('trigger_test')
    })

    it('should throw when triggering non-existent action', async () => {
      await expect(
        messenger.triggerCustomAction('nonexistent', { userId: 'user_1' })
      ).rejects.toThrow('Custom action not found: nonexistent')
    })

    it('should unregister custom action', async () => {
      await messenger.registerCustomAction('to_remove', {
        label: 'To Remove',
      })

      const result = await messenger.unregisterCustomAction('to_remove')
      expect(result.id).toBe('to_remove')
      expect(result.deleted).toBe(true)

      // Should now throw when trying to trigger
      await expect(messenger.triggerCustomAction('to_remove', {})).rejects.toThrow(
        'Custom action not found: to_remove'
      )
    })

    it('should throw when unregistering non-existent action', async () => {
      await expect(messenger.unregisterCustomAction('nonexistent')).rejects.toThrow(
        'Custom action not found: nonexistent'
      )
    })

    it('should get custom action', async () => {
      await messenger.registerCustomAction('get_test', {
        label: 'Get Test',
      })

      const action = await messenger.getCustomAction('get_test')
      expect(action?.id).toBe('get_test')
      expect(action?.label).toBe('Get Test')
    })

    it('should return null for non-existent action', async () => {
      const action = await messenger.getCustomAction('nonexistent')
      expect(action).toBeNull()
    })

    it('should list all custom actions', async () => {
      await messenger.registerCustomAction('action_1', { label: 'Action 1' })
      await messenger.registerCustomAction('action_2', { label: 'Action 2' })

      const actions = await messenger.listCustomActions()
      expect(actions).toHaveLength(2)
      expect(actions.map((a) => a.id)).toContain('action_1')
      expect(actions.map((a) => a.id)).toContain('action_2')
    })
  })

  // ===========================================================================
  // Identity Verification
  // ===========================================================================

  describe('identity verification', () => {
    it('should set identity verification', async () => {
      const verification = await messenger.setIdentityVerification({
        userId: 'user_123',
        userHash: 'hmac_hash_abc123',
        email: 'user@example.com',
        name: 'John Doe',
      })

      expect(verification.userId).toBe('user_123')
      expect(verification.verified).toBe(true)
      expect(verification.verifiedAt).toBeDefined()
      expect(verification.email).toBe('user@example.com')
      expect(verification.name).toBe('John Doe')
    })

    it('should verify identity with HMAC', async () => {
      // Valid HMAC (32+ characters)
      const result = await messenger.verifyIdentity(
        'abc123def456ghi789jkl012mno345pqr678'
      )
      expect(result.verified).toBe(true)
    })

    it('should reject invalid HMAC', async () => {
      const result = await messenger.verifyIdentity('short')
      expect(result.verified).toBe(false)
    })

    it('should clear identity', async () => {
      await messenger.setIdentityVerification({
        userId: 'user_to_clear',
        userHash: 'hmac_hash_abc123def456ghi789jkl',
      })

      const result = await messenger.clearIdentity()
      expect(result.cleared).toBe(true)
    })

    it('should get identity verification for user', async () => {
      await messenger.setIdentityVerification({
        userId: 'user_get',
        userHash: 'hmac_hash',
        email: 'get@example.com',
      })

      const verification = await messenger.getIdentityVerification('user_get')
      expect(verification?.userId).toBe('user_get')
      expect(verification?.email).toBe('get@example.com')
    })

    it('should return null for non-verified user', async () => {
      const verification = await messenger.getIdentityVerification('nonexistent')
      expect(verification).toBeNull()
    })
  })

  // ===========================================================================
  // Launcher Customization
  // ===========================================================================

  describe('launcher customization', () => {
    it('should set custom launcher', async () => {
      const config = await messenger.setCustomLauncher({
        icon: 'https://example.com/custom-icon.png',
        badge: 5,
        tooltip: 'Need help?',
      })

      expect(config.icon).toBe('https://example.com/custom-icon.png')
      expect(config.badge).toBe(5)
      expect(config.tooltip).toBe('Need help?')
    })

    it('should get custom launcher config', async () => {
      await messenger.setCustomLauncher({
        icon: 'https://example.com/icon.png',
      })

      const config = await messenger.getCustomLauncher()
      expect(config.icon).toBe('https://example.com/icon.png')
    })

    it('should show launcher', async () => {
      await messenger.hideLauncher()
      const result = await messenger.showLauncher()
      expect(result.visible).toBe(true)

      const isVisible = await messenger.isLauncherVisible()
      expect(isVisible).toBe(true)
    })

    it('should hide launcher', async () => {
      const result = await messenger.hideLauncher()
      expect(result.visible).toBe(false)

      const isVisible = await messenger.isLauncherVisible()
      expect(isVisible).toBe(false)
    })

    it('should open messenger', async () => {
      const result = await messenger.openMessenger()
      expect(result.opened).toBe(true)

      const isOpen = await messenger.isMessengerOpen()
      expect(isOpen).toBe(true)
    })

    it('should open messenger with options', async () => {
      const result = await messenger.openMessenger({
        message: 'I need help with my order',
        articleId: 'article_123',
      })

      expect(result.opened).toBe(true)
    })

    it('should close messenger', async () => {
      await messenger.openMessenger()

      const result = await messenger.closeMessenger()
      expect(result.closed).toBe(true)

      const isOpen = await messenger.isMessengerOpen()
      expect(isOpen).toBe(false)
    })
  })

  // ===========================================================================
  // Message Templates
  // ===========================================================================

  describe('message templates', () => {
    it('should create message template', async () => {
      const template = await messenger.createMessageTemplate({
        name: 'Welcome Template',
        content: 'Hello {{name}}, welcome to {{company}}!',
      })

      expect(template.id).toBeDefined()
      expect(template.name).toBe('Welcome Template')
      expect(template.content).toBe('Hello {{name}}, welcome to {{company}}!')
      expect(template.variables).toContain('name')
      expect(template.variables).toContain('company')
    })

    it('should create template with attachments', async () => {
      const template = await messenger.createMessageTemplate({
        name: 'With Attachment',
        content: 'Check out our product!',
        attachments: [
          { type: 'image', url: 'https://example.com/product.png', name: 'product.png' },
        ],
      })

      expect(template.attachments).toHaveLength(1)
      expect(template.attachments?.[0].type).toBe('image')
    })

    it('should list message templates', async () => {
      await messenger.createMessageTemplate({ name: 'Template 1', content: 'Content 1' })
      await messenger.createMessageTemplate({ name: 'Template 2', content: 'Content 2' })

      const result = await messenger.listMessageTemplates()
      expect(result.type).toBe('list')
      expect(result.data).toHaveLength(2)
    })

    it('should get message template', async () => {
      const created = await messenger.createMessageTemplate({
        name: 'Get Test',
        content: 'Get test content',
      })

      const template = await messenger.getMessageTemplate(created.id)
      expect(template?.id).toBe(created.id)
      expect(template?.name).toBe('Get Test')
    })

    it('should return null for non-existent template', async () => {
      const template = await messenger.getMessageTemplate('nonexistent')
      expect(template).toBeNull()
    })

    it('should delete message template', async () => {
      const created = await messenger.createMessageTemplate({
        name: 'To Delete',
        content: 'Will be deleted',
      })

      const result = await messenger.deleteMessageTemplate(created.id)
      expect(result.id).toBe(created.id)
      expect(result.deleted).toBe(true)

      const template = await messenger.getMessageTemplate(created.id)
      expect(template).toBeNull()
    })

    it('should throw when deleting non-existent template', async () => {
      await expect(messenger.deleteMessageTemplate('nonexistent')).rejects.toThrow(
        'Template not found: nonexistent'
      )
    })

    it('should send from template', async () => {
      const template = await messenger.createMessageTemplate({
        name: 'Send Test',
        content: 'Hello {{name}}!',
      })

      const result = await messenger.sendFromTemplate(template.id, 'contact_123', {
        name: 'John',
      })

      expect(result.sent).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('should throw when sending from non-existent template', async () => {
      await expect(
        messenger.sendFromTemplate('nonexistent', 'contact_123')
      ).rejects.toThrow('Template not found: nonexistent')
    })

    it('should render template with variables', async () => {
      const template = await messenger.createMessageTemplate({
        name: 'Render Test',
        content: 'Hello {{name}}, your order {{orderId}} is ready!',
      })

      const rendered = await messenger.renderTemplate(template.id, {
        name: 'Alice',
        orderId: 'ORD-12345',
      })

      expect(rendered.content).toBe('Hello Alice, your order ORD-12345 is ready!')
    })

    it('should extract unique variables from template', async () => {
      const template = await messenger.createMessageTemplate({
        name: 'Duplicate Vars',
        content: 'Hello {{name}}, {{name}} you have {{count}} items',
      })

      expect(template.variables).toHaveLength(2)
      expect(template.variables).toContain('name')
      expect(template.variables).toContain('count')
    })
  })
})

// =============================================================================
// IntercomLocal with Messenger Tests
// =============================================================================

describe('@dotdo/intercom - IntercomLocal with Messenger', () => {
  let client: IntercomLocal

  beforeEach(() => {
    client = new IntercomLocal({
      workspaceId: 'test_workspace',
    })
  })

  it('should have messenger resource', () => {
    expect(client.messenger).toBeDefined()
    expect(client.messenger).toBeInstanceOf(MessengerLocal)
  })

  it('should configure messenger through client', async () => {
    const config = await client.messenger.configureMessenger({
      color: '#FF5500',
      position: 'left',
    })

    expect(config.color).toBe('#FF5500')
    expect(config.position).toBe('left')
  })

  it('should register custom actions through client', async () => {
    const handler = vi.fn()

    await client.messenger.registerCustomAction('client_action', {
      label: 'Client Action',
      handler,
    })

    await client.messenger.triggerCustomAction('client_action', {
      userId: 'user_from_client',
    })

    expect(handler).toHaveBeenCalled()
  })
})

// =============================================================================
// MessengerResource (API Client) Tests
// =============================================================================

describe('@dotdo/intercom - MessengerResource (API Client)', () => {
  it('should have messenger resource on Client', () => {
    const mockFetch = vi.fn()
    const client = new Client({
      tokenAuth: { token: 'test_token' },
      fetch: mockFetch,
    })

    expect(client.messenger).toBeDefined()
  })

  it('should configure messenger via API', async () => {
    const mockResponse = {
      id: 'config_123',
      workspaceId: 'ws_123',
      primary_color: '#0066FF',
      launcher_position: 'right',
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    })

    const client = new Client({
      tokenAuth: { token: 'test_token' },
      fetch: mockFetch,
    })

    const result = await client.messenger.configureMessenger({
      color: '#0066FF',
      position: 'right',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.intercom.io/messenger/settings',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"primary_color":"#0066FF"'),
      })
    )

    expect(result.primary_color).toBe('#0066FF')
  })

  it('should add home screen card via API', async () => {
    const mockResponse = {
      id: 'card_123',
      type: 'conversation_card',
      title: 'Talk to Sales',
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    })

    const client = new Client({
      tokenAuth: { token: 'test_token' },
      fetch: mockFetch,
    })

    const result = await client.messenger.addHomeScreenCard({
      type: 'conversation_card',
      title: 'Talk to Sales',
      body: 'Get help from our team',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.intercom.io/messenger/home/cards',
      expect.objectContaining({
        method: 'POST',
      })
    )

    expect(result.type).toBe('conversation_card')
  })

  it('should register custom action via API', async () => {
    const mockResponse = {
      id: 'book_demo',
      label: 'Book a Demo',
      enabled: true,
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    })

    const client = new Client({
      tokenAuth: { token: 'test_token' },
      fetch: mockFetch,
    })

    const result = await client.messenger.registerCustomAction('book_demo', {
      label: 'Book a Demo',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.intercom.io/messenger/custom_actions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"label":"Book a Demo"'),
      })
    )

    expect(result.label).toBe('Book a Demo')
  })

  it('should set identity verification via API', async () => {
    const mockResponse = {
      userId: 'user_123',
      verified: true,
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    })

    const client = new Client({
      tokenAuth: { token: 'test_token' },
      fetch: mockFetch,
    })

    const result = await client.messenger.setIdentityVerification({
      userId: 'user_123',
      userHash: 'hmac_hash',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.intercom.io/messenger/identity_verification',
      expect.objectContaining({
        method: 'POST',
      })
    )

    expect(result.verified).toBe(true)
  })

  it('should send from template via API', async () => {
    const mockResponse = {
      sent: true,
      messageId: 'msg_123',
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    })

    const client = new Client({
      tokenAuth: { token: 'test_token' },
      fetch: mockFetch,
    })

    const result = await client.messenger.sendFromTemplate(
      'template_123',
      'contact_456',
      { name: 'John' }
    )

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.intercom.io/messenger/templates/template_123/send',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"recipient_id":"contact_456"'),
      })
    )

    expect(result.sent).toBe(true)
  })
})
