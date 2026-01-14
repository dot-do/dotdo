/**
 * @dotdo/slack - App Home Tests
 *
 * TDD tests for Slack App Home functionality including:
 * - Home tab views
 * - Modal interactions
 * - Global and message shortcuts
 * - Home tab builder utilities
 *
 * @see https://api.slack.com/surfaces/app-home
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  AppHome,
  AppHomeError,
  createAppHome,
  type AppHomeConfig,
  type HomeTabConfig,
  type HomeTabContext,
  type ModalConfig,
  type ShortcutConfig,
} from '../app-home'

import {
  SlackBot,
  BotWebClient,
  type AppHomeOpenedEvent,
  type BotEventArgs,
} from '../bot'

import {
  Blocks,
  section,
  header,
  divider,
  actions,
  button,
  plainText,
  mrkdwn,
  homeTab,
  modal,
  type HomeTabView,
  type ModalView,
} from '../blocks'

import type {
  ViewSubmissionPayload,
  ViewClosedPayload,
  GlobalShortcutPayload,
  MessageShortcutPayload,
  EventCallbackBody,
} from '../types'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockFetch(responses: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    const endpoint = url.replace('https://slack.com/api/', '')
    const response = responses[endpoint] ?? { ok: true }
    return {
      ok: true,
      json: async () => response,
      headers: new Headers(),
    }
  })
}

function createAppHomeOpenedEvent(overrides: Partial<AppHomeOpenedEvent> = {}): AppHomeOpenedEvent {
  return {
    type: 'app_home_opened',
    user: 'U123',
    channel: 'D123',
    tab: 'home',
    event_ts: '1234567890.123456',
    ...overrides,
  }
}

function createEventCallbackBody(event: AppHomeOpenedEvent): EventCallbackBody {
  return {
    type: 'event_callback',
    token: 'test-token',
    team_id: 'T123',
    api_app_id: 'A123',
    event,
    event_id: 'Ev123',
    event_time: Date.now(),
    authorizations: [
      {
        team_id: 'T123',
        user_id: 'U123',
        is_bot: true,
      },
    ],
  }
}

// ============================================================================
// APP HOME CLASS TESTS
// ============================================================================

describe('AppHome', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'views.publish': { ok: true, view: { id: 'V123', type: 'home' } },
      'views.open': { ok: true, view: { id: 'V456', type: 'modal' } },
      'views.update': { ok: true, view: { id: 'V456', type: 'modal' } },
      'views.push': { ok: true, view: { id: 'V789', type: 'modal' } },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('construction', () => {
    it('should create AppHome with token', () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      expect(appHome).toBeInstanceOf(AppHome)
    })

    it('should create AppHome with client', () => {
      const client = new BotWebClient('xoxb-test')
      const appHome = new AppHome({ client })
      expect(appHome).toBeInstanceOf(AppHome)
    })

    it('should throw error without token or client', () => {
      expect(() => new AppHome({} as AppHomeConfig)).toThrow(AppHomeError)
    })
  })

  describe('home tab publishing', () => {
    it('should publish a home tab view for a user', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const result = await appHome.publish({
        userId: 'U123',
        view: homeTab({
          blocks: [
            header({ text: plainText('Welcome!') }),
            section({ text: mrkdwn('This is your home tab.') }),
          ],
        }),
      })

      expect(result.ok).toBe(true)
      expect(result.view?.type).toBe('home')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('views.publish'),
        expect.objectContaining({
          body: expect.stringContaining('U123'),
        })
      )
    })

    it('should publish home tab with callback_id', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      await appHome.publish({
        userId: 'U123',
        view: homeTab({
          callback_id: 'home_tab_main',
          blocks: [],
        }),
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('views.publish'),
        expect.objectContaining({
          body: expect.stringContaining('home_tab_main'),
        })
      )
    })

    it('should publish home tab with private_metadata', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const metadata = JSON.stringify({ userId: 'U123', preferences: {} })

      await appHome.publish({
        userId: 'U123',
        view: homeTab({
          blocks: [],
          private_metadata: metadata,
        }),
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('views.publish'),
        expect.objectContaining({
          body: expect.stringContaining('private_metadata'),
        })
      )
    })

    it('should support hash for optimistic updates', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      await appHome.publish({
        userId: 'U123',
        view: homeTab({ blocks: [] }),
        hash: 'xyz123',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('views.publish'),
        expect.objectContaining({
          body: expect.stringContaining('xyz123'),
        })
      )
    })

    it('should throw AppHomeError on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'invalid_blocks' }),
      })

      const appHome = new AppHome({ token: 'xoxb-test' })

      await expect(
        appHome.publish({
          userId: 'U123',
          view: homeTab({ blocks: [] }),
        })
      ).rejects.toThrow(AppHomeError)
    })
  })

  describe('home tab builder', () => {
    it('should provide fluent builder for home tab', () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const view = appHome
        .buildHomeTab()
        .header('Welcome')
        .section('Hello, user!')
        .divider()
        .actions([
          button({
            text: plainText('Get Started'),
            action_id: 'get_started',
            style: 'primary',
          }),
        ])
        .build()

      expect(view.type).toBe('home')
      expect(view.blocks).toHaveLength(4)
    })

    it('should support callback_id and metadata in builder', () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const view = appHome
        .buildHomeTab()
        .callbackId('home_main')
        .metadata({ page: 1 })
        .header('Title')
        .build()

      expect(view.callback_id).toBe('home_main')
      expect(view.private_metadata).toContain('page')
    })

    it('should allow publishing directly from builder', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const result = await appHome
        .buildHomeTab()
        .header('Welcome')
        .publishTo('U123')

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('views.publish'),
        expect.any(Object)
      )
    })
  })

  describe('modal management', () => {
    it('should open a modal with trigger_id', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const result = await appHome.openModal({
        triggerId: 'trigger-123',
        view: modal({
          title: plainText('My Modal'),
          blocks: [section({ text: mrkdwn('Modal content') })],
          submit: plainText('Submit'),
        }),
      })

      expect(result.ok).toBe(true)
      expect(result.view?.type).toBe('modal')
    })

    it('should push a modal onto the stack', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const result = await appHome.pushModal({
        triggerId: 'trigger-123',
        view: modal({
          title: plainText('Nested Modal'),
          blocks: [],
        }),
      })

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('views.push'),
        expect.any(Object)
      )
    })

    it('should update an existing modal by view_id', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const result = await appHome.updateModal({
        viewId: 'V456',
        view: modal({
          title: plainText('Updated Modal'),
          blocks: [section({ text: mrkdwn('Updated content') })],
        }),
      })

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('views.update'),
        expect.objectContaining({
          body: expect.stringContaining('V456'),
        })
      )
    })

    it('should update modal with external_id', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      await appHome.updateModal({
        externalId: 'my-external-id',
        view: modal({
          title: plainText('Modal'),
          blocks: [],
        }),
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('views.update'),
        expect.objectContaining({
          body: expect.stringContaining('my-external-id'),
        })
      )
    })

    it('should throw error when neither viewId nor externalId provided', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      await expect(
        appHome.updateModal({
          view: modal({ title: plainText('Modal'), blocks: [] }),
        } as any)
      ).rejects.toThrow(AppHomeError)
    })
  })

  describe('modal builder', () => {
    it('should provide fluent builder for modals', () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const view = appHome
        .buildModal()
        .title('Create Task')
        .submit('Create')
        .close('Cancel')
        .input({
          blockId: 'task_name',
          label: 'Task Name',
          actionId: 'task_input',
        })
        .build()

      expect(view.type).toBe('modal')
      expect(view.title?.text).toBe('Create Task')
      expect(view.submit?.text).toBe('Create')
    })

    it('should support opening modal directly from builder', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const result = await appHome
        .buildModal()
        .title('Quick Modal')
        .section('Content here')
        .openWith('trigger-123')

      expect(result.ok).toBe(true)
    })

    it('should support notify_on_close and clear_on_close', () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      const view = appHome
        .buildModal()
        .title('Important')
        .notifyOnClose()
        .clearOnClose()
        .build()

      expect(view.notify_on_close).toBe(true)
      expect(view.clear_on_close).toBe(true)
    })
  })

  describe('shortcut handling', () => {
    it('should register a global shortcut handler', () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onShortcut('create_task', handler)

      // Handler should be registered
      expect(appHome.hasShortcutHandler('create_task')).toBe(true)
    })

    it('should register a message shortcut handler', () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onMessageShortcut('save_message', handler)

      expect(appHome.hasMessageShortcutHandler('save_message')).toBe(true)
    })

    it('should handle global shortcut payload', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onShortcut('create_task', handler)

      const payload: GlobalShortcutPayload = {
        type: 'shortcut',
        callback_id: 'create_task',
        trigger_id: 'trigger-123',
        user: { id: 'U123' },
        team: { id: 'T123' },
      }

      await appHome.handleShortcut(payload)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          payload,
          triggerId: 'trigger-123',
          userId: 'U123',
          openModal: expect.any(Function),
        })
      )
    })

    it('should handle message shortcut payload', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onMessageShortcut('save_message', handler)

      const payload: MessageShortcutPayload = {
        type: 'message_action',
        callback_id: 'save_message',
        trigger_id: 'trigger-456',
        user: { id: 'U123' },
        team: { id: 'T123' },
        channel: { id: 'C123' },
        message: { type: 'message', text: 'Important note', ts: '123' },
        response_url: 'https://hooks.slack.com/response/xxx',
      }

      await appHome.handleShortcut(payload)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          payload,
          message: expect.objectContaining({ text: 'Important note' }),
          respond: expect.any(Function),
        })
      )
    })

    it('should support regex patterns for shortcuts', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onShortcut(/^task_/, handler)

      const payload: GlobalShortcutPayload = {
        type: 'shortcut',
        callback_id: 'task_create',
        trigger_id: 'trigger-123',
        user: { id: 'U123' },
      }

      await appHome.handleShortcut(payload)

      expect(handler).toHaveBeenCalled()
    })
  })

  describe('view submission handling', () => {
    it('should register a view submission handler', () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onViewSubmission('feedback_modal', handler)

      expect(appHome.hasViewSubmissionHandler('feedback_modal')).toBe(true)
    })

    it('should handle view submission payload', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onViewSubmission('feedback_modal', handler)

      const payload: ViewSubmissionPayload = {
        type: 'view_submission',
        user: { id: 'U123' },
        view: {
          callback_id: 'feedback_modal',
          state: {
            values: {
              feedback_block: {
                feedback_input: { type: 'plain_text_input', value: 'Great!' },
              },
            },
          },
        },
      }

      const response = await appHome.handleViewSubmission(payload)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          view: payload.view,
          values: expect.objectContaining({
            feedback_block: expect.any(Object),
          }),
        })
      )
    })

    it('should return validation errors from handler', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      appHome.onViewSubmission('form_modal', async () => {
        return {
          response_action: 'errors',
          errors: {
            email_block: 'Please enter a valid email',
          },
        }
      })

      const payload: ViewSubmissionPayload = {
        type: 'view_submission',
        user: { id: 'U123' },
        view: {
          callback_id: 'form_modal',
          state: { values: {} },
        },
      }

      const response = await appHome.handleViewSubmission(payload)

      expect(response).toEqual({
        response_action: 'errors',
        errors: { email_block: 'Please enter a valid email' },
      })
    })

    it('should support update response action', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      appHome.onViewSubmission('wizard_step1', async () => {
        return {
          response_action: 'update',
          view: modal({
            title: plainText('Step 2'),
            blocks: [],
          }),
        }
      })

      const payload: ViewSubmissionPayload = {
        type: 'view_submission',
        user: { id: 'U123' },
        view: { callback_id: 'wizard_step1', state: { values: {} } },
      }

      const response = await appHome.handleViewSubmission(payload)

      expect(response?.response_action).toBe('update')
      expect(response?.view?.title?.text).toBe('Step 2')
    })

    it('should support push response action', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      appHome.onViewSubmission('main_modal', async () => {
        return {
          response_action: 'push',
          view: modal({
            title: plainText('Details'),
            blocks: [],
          }),
        }
      })

      const payload: ViewSubmissionPayload = {
        type: 'view_submission',
        user: { id: 'U123' },
        view: { callback_id: 'main_modal', state: { values: {} } },
      }

      const response = await appHome.handleViewSubmission(payload)

      expect(response?.response_action).toBe('push')
    })

    it('should support clear response action', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })

      appHome.onViewSubmission('delete_modal', async () => {
        return { response_action: 'clear' }
      })

      const payload: ViewSubmissionPayload = {
        type: 'view_submission',
        user: { id: 'U123' },
        view: { callback_id: 'delete_modal', state: { values: {} } },
      }

      const response = await appHome.handleViewSubmission(payload)

      expect(response?.response_action).toBe('clear')
    })
  })

  describe('view closed handling', () => {
    it('should register a view closed handler', () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onViewClosed('important_modal', handler)

      expect(appHome.hasViewClosedHandler('important_modal')).toBe(true)
    })

    it('should handle view closed payload', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onViewClosed('draft_modal', handler)

      const payload: ViewClosedPayload = {
        type: 'view_closed',
        user: { id: 'U123' },
        view: { callback_id: 'draft_modal' },
        is_cleared: false,
      }

      await appHome.handleViewClosed(payload)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          view: payload.view,
          isCleared: false,
        })
      )
    })

    it('should handle cleared views', async () => {
      const appHome = new AppHome({ token: 'xoxb-test' })
      const handler = vi.fn()

      appHome.onViewClosed('modal_stack', handler)

      const payload: ViewClosedPayload = {
        type: 'view_closed',
        user: { id: 'U123' },
        view: { callback_id: 'modal_stack' },
        is_cleared: true,
      }

      await appHome.handleViewClosed(payload)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          isCleared: true,
        })
      )
    })
  })
})

// ============================================================================
// INTEGRATION WITH SLACKBOT TESTS
// ============================================================================

describe('AppHome + SlackBot Integration', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'views.publish': { ok: true, view: { id: 'V123' } },
      'views.open': { ok: true, view: { id: 'V456' } },
      'chat.postMessage': { ok: true, ts: '123' },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should integrate with SlackBot for app_home_opened events', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })
    const bot = new SlackBot({ token: 'xoxb-test' })

    // Register app home handler through SlackBot
    bot.event('app_home_opened', async ({ event, client }) => {
      const homeOpenedEvent = event as AppHomeOpenedEvent
      if (homeOpenedEvent.tab === 'home') {
        await appHome.publish({
          userId: homeOpenedEvent.user,
          view: appHome
            .buildHomeTab()
            .header('Welcome!')
            .section(`Hello, <@${homeOpenedEvent.user}>!`)
            .build(),
        })
      }
    })

    const event = createAppHomeOpenedEvent()
    const body = createEventCallbackBody(event)

    const request = new Request('http://localhost/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    await bot.handleRequest(request)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('views.publish'),
      expect.any(Object)
    )
  })

  it('should share client between AppHome and SlackBot', async () => {
    const bot = new SlackBot({ token: 'xoxb-test' })
    const appHome = new AppHome({ client: bot.client })

    // Both should use the same client
    expect(appHome.getClient()).toBe(bot.client)
  })

  it('should handle shortcuts registered through AppHome via SlackBot', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })
    const bot = new SlackBot({ token: 'xoxb-test' })

    const shortcutHandler = vi.fn()
    appHome.onShortcut('quick_task', shortcutHandler)

    // Register with SlackBot to forward to AppHome
    bot.shortcut('quick_task', async ({ shortcut, client }) => {
      await appHome.handleShortcut(shortcut as GlobalShortcutPayload)
    })

    const payload = {
      type: 'shortcut',
      callback_id: 'quick_task',
      trigger_id: 'trigger-123',
      user: { id: 'U123' },
    }

    const request = new Request('http://localhost/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `payload=${encodeURIComponent(JSON.stringify(payload))}`,
    })

    await bot.handleRequest(request)

    expect(shortcutHandler).toHaveBeenCalled()
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createAppHome factory', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'views.publish': { ok: true, view: { id: 'V123' } },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should create AppHome with default config', () => {
    const appHome = createAppHome({ token: 'xoxb-test' })
    expect(appHome).toBeInstanceOf(AppHome)
  })

  it('should create AppHome with full config', () => {
    const appHome = createAppHome({
      token: 'xoxb-test',
      defaultHomeTab: {
        callbackId: 'home_main',
        builder: (builder) => builder.header('Default Home'),
      },
    })

    expect(appHome).toBeInstanceOf(AppHome)
  })

  it('should support auto-publishing default home tab', async () => {
    const appHome = createAppHome({
      token: 'xoxb-test',
      defaultHomeTab: {
        builder: (builder) => builder.header('Auto Home'),
      },
    })

    await appHome.publishDefault('U123')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('views.publish'),
      expect.any(Object)
    )
  })
})

// ============================================================================
// BLOCK KIT BUILDER EXTENSIONS TESTS
// ============================================================================

describe('Block Kit Home Tab and Modal helpers', () => {
  it('should create valid home tab view', () => {
    const view = homeTab({
      blocks: [
        header({ text: plainText('Home') }),
        section({ text: mrkdwn('Welcome!') }),
      ],
    })

    expect(view.type).toBe('home')
    expect(view.blocks).toHaveLength(2)
  })

  it('should create home tab with all optional fields', () => {
    const view = homeTab({
      callback_id: 'home_main',
      private_metadata: JSON.stringify({ version: 1 }),
      external_id: 'ext-123',
      blocks: [],
    })

    expect(view.callback_id).toBe('home_main')
    expect(view.private_metadata).toContain('version')
    expect(view.external_id).toBe('ext-123')
  })

  it('should create valid modal view', () => {
    const view = modal({
      title: plainText('My Modal'),
      blocks: [section({ text: mrkdwn('Content') })],
      submit: plainText('Submit'),
      close: plainText('Cancel'),
    })

    expect(view.type).toBe('modal')
    expect(view.title.text).toBe('My Modal')
    expect(view.submit?.text).toBe('Submit')
    expect(view.close?.text).toBe('Cancel')
  })

  it('should create modal with notify_on_close', () => {
    const view = modal({
      title: plainText('Important'),
      blocks: [],
      notify_on_close: true,
    })

    expect(view.notify_on_close).toBe(true)
  })

  it('should create modal with clear_on_close', () => {
    const view = modal({
      title: plainText('Form'),
      blocks: [],
      clear_on_close: true,
    })

    expect(view.clear_on_close).toBe(true)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('AppHome Error Handling', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch()
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should throw AppHomeError with error code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'invalid_blocks' }),
    })

    const appHome = new AppHome({ token: 'xoxb-test' })

    try {
      await appHome.publish({
        userId: 'U123',
        view: homeTab({ blocks: [] }),
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppHomeError)
      expect((error as AppHomeError).code).toBe('invalid_blocks')
    }
  })

  it('should handle missing shortcut handler gracefully', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const payload: GlobalShortcutPayload = {
      type: 'shortcut',
      callback_id: 'unregistered_shortcut',
      trigger_id: 'trigger-123',
      user: { id: 'U123' },
    }

    // Should not throw, just log warning
    await expect(appHome.handleShortcut(payload)).resolves.not.toThrow()
  })

  it('should handle missing view submission handler gracefully', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const payload: ViewSubmissionPayload = {
      type: 'view_submission',
      user: { id: 'U123' },
      view: { callback_id: 'unregistered_modal', state: { values: {} } },
    }

    // Should return undefined (no response)
    const response = await appHome.handleViewSubmission(payload)
    expect(response).toBeUndefined()
  })

  it('should propagate handler errors', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    appHome.onShortcut('error_shortcut', async () => {
      throw new Error('Handler error')
    })

    const payload: GlobalShortcutPayload = {
      type: 'shortcut',
      callback_id: 'error_shortcut',
      trigger_id: 'trigger-123',
      user: { id: 'U123' },
    }

    await expect(appHome.handleShortcut(payload)).rejects.toThrow('Handler error')
  })
})

// ============================================================================
// ADVANCED PATTERNS TESTS
// ============================================================================

describe('Advanced App Home Patterns', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'views.publish': { ok: true, view: { id: 'V123' } },
      'views.open': { ok: true, view: { id: 'V456' } },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should support conditional home tab based on user', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const getUserRole = (userId: string) =>
      userId === 'U_ADMIN' ? 'admin' : 'user'

    const buildHomeForUser = (userId: string) => {
      const role = getUserRole(userId)

      const builder = appHome.buildHomeTab().header('Dashboard')

      if (role === 'admin') {
        builder.section('*Admin Panel*')
        builder.actions([
          button({
            text: plainText('Manage Users'),
            action_id: 'manage_users',
          }),
        ])
      } else {
        builder.section('Welcome, user!')
      }

      return builder.build()
    }

    await appHome.publish({
      userId: 'U_ADMIN',
      view: buildHomeForUser('U_ADMIN'),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('views.publish'),
      expect.objectContaining({
        body: expect.stringContaining('Admin Panel'),
      })
    )
  })

  it('should support multi-step modal wizard', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    // Step 1 submission -> Step 2 update
    appHome.onViewSubmission('wizard_step1', async ({ values }) => {
      return {
        response_action: 'update',
        view: appHome
          .buildModal()
          .title('Step 2 of 3')
          .callbackId('wizard_step2')
          .metadata({ step1Data: values })
          .section('Continue with step 2')
          .submit('Next')
          .build(),
      }
    })

    // Step 2 submission -> Step 3 push
    appHome.onViewSubmission('wizard_step2', async ({ values, view }) => {
      const metadata = JSON.parse(view.private_metadata || '{}')
      return {
        response_action: 'push',
        view: appHome
          .buildModal()
          .title('Step 3 of 3')
          .callbackId('wizard_step3')
          .metadata({ ...metadata, step2Data: values })
          .section('Final step')
          .submit('Complete')
          .build(),
      }
    })

    // Step 3 submission -> clear
    appHome.onViewSubmission('wizard_step3', async () => {
      return { response_action: 'clear' }
    })

    expect(appHome.hasViewSubmissionHandler('wizard_step1')).toBe(true)
    expect(appHome.hasViewSubmissionHandler('wizard_step2')).toBe(true)
    expect(appHome.hasViewSubmissionHandler('wizard_step3')).toBe(true)
  })

  it('should support home tab refresh on action', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    // Track publish calls
    let publishCount = 0
    const originalPublish = appHome.publish.bind(appHome)
    appHome.publish = async (args) => {
      publishCount++
      return originalPublish(args)
    }

    // Simulate action handler refreshing home tab
    const handleRefreshAction = async (userId: string) => {
      await appHome.publish({
        userId,
        view: appHome
          .buildHomeTab()
          .header('Refreshed!')
          .section(`Last refresh: ${new Date().toISOString()}`)
          .build(),
      })
    }

    await handleRefreshAction('U123')
    await handleRefreshAction('U123')

    expect(publishCount).toBe(2)
  })

  it('should support external_id for modal tracking', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const orderId = 'order-12345'

    // Open modal with external_id for later updates
    await appHome.openModal({
      triggerId: 'trigger-123',
      view: appHome
        .buildModal()
        .title('Order Details')
        .externalId(`order_${orderId}`)
        .section(`Order: ${orderId}`)
        .build(),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('views.open'),
      expect.objectContaining({
        body: expect.stringContaining(`order_${orderId}`),
      })
    )

    // Later update by external_id
    await appHome.updateModal({
      externalId: `order_${orderId}`,
      view: appHome
        .buildModal()
        .title('Order Updated')
        .section('Status: Shipped')
        .build(),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('views.update'),
      expect.objectContaining({
        body: expect.stringContaining(`order_${orderId}`),
      })
    )
  })
})

// ============================================================================
// APP HOME OPENED EVENT TESTS
// ============================================================================

describe('App Home Opened Event Handling', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'views.publish': { ok: true, view: { id: 'V123', type: 'home' } },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should register app_home_opened handler', () => {
    const appHome = new AppHome({ token: 'xoxb-test' })
    const handler = vi.fn()

    appHome.onAppHomeOpened(handler)

    expect(appHome.hasAppHomeOpenedHandler()).toBe(true)
  })

  it('should handle app_home_opened event with custom handler', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })
    const handler = vi.fn()

    appHome.onAppHomeOpened(handler)

    const event: AppHomeOpenedEvent = {
      type: 'app_home_opened',
      user: 'U123',
      channel: 'D123',
      tab: 'home',
      event_ts: '1234567890.123456',
    }

    await appHome.handleAppHomeOpened(event)

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        event,
        userId: 'U123',
        tab: 'home',
        publish: expect.any(Function),
        buildHomeTab: expect.any(Function),
        client: expect.any(Object),
      })
    )
  })

  it('should allow publishing from handler context', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    appHome.onAppHomeOpened(async ({ publish, buildHomeTab }) => {
      await publish(
        buildHomeTab()
          .header('Welcome!')
          .section('Your personal dashboard')
      )
    })

    const event: AppHomeOpenedEvent = {
      type: 'app_home_opened',
      user: 'U123',
      channel: 'D123',
      tab: 'home',
      event_ts: '1234567890.123456',
    }

    await appHome.handleAppHomeOpened(event)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('views.publish'),
      expect.objectContaining({
        body: expect.stringContaining('Welcome!'),
      })
    )
  })

  it('should publish default home tab when no handler but defaultHomeTab configured', async () => {
    const appHome = new AppHome({
      token: 'xoxb-test',
      defaultHomeTab: {
        builder: (b) => b.header('Default Home'),
      },
    })

    const event: AppHomeOpenedEvent = {
      type: 'app_home_opened',
      user: 'U123',
      channel: 'D123',
      tab: 'home',
      event_ts: '1234567890.123456',
    }

    await appHome.handleAppHomeOpened(event)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('views.publish'),
      expect.objectContaining({
        body: expect.stringContaining('Default Home'),
      })
    )
  })

  it('should not publish when tab is not home', async () => {
    const appHome = new AppHome({
      token: 'xoxb-test',
      defaultHomeTab: {
        builder: (b) => b.header('Default Home'),
      },
    })

    const event: AppHomeOpenedEvent = {
      type: 'app_home_opened',
      user: 'U123',
      channel: 'D123',
      tab: 'messages',
      event_ts: '1234567890.123456',
    }

    await appHome.handleAppHomeOpened(event)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('should handle event callback body with app_home_opened', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })
    const handler = vi.fn()

    appHome.onAppHomeOpened(handler)

    const body: EventCallbackBody = {
      type: 'event_callback',
      token: 'test-token',
      team_id: 'T123',
      api_app_id: 'A123',
      event: {
        type: 'app_home_opened',
        user: 'U123',
        channel: 'D123',
        tab: 'home',
        event_ts: '1234567890.123456',
      } as AppHomeOpenedEvent,
      event_id: 'Ev123',
      event_time: Date.now(),
    }

    const handled = await appHome.handleEventCallback(body)

    expect(handled).toBe(true)
    expect(handler).toHaveBeenCalled()
  })

  it('should return false for non-app_home_opened events', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const body: EventCallbackBody = {
      type: 'event_callback',
      token: 'test-token',
      team_id: 'T123',
      api_app_id: 'A123',
      event: {
        type: 'message',
        user: 'U123',
        channel: 'C123',
        ts: '123',
      },
      event_id: 'Ev123',
      event_time: Date.now(),
    }

    const handled = await appHome.handleEventCallback(body)

    expect(handled).toBe(false)
  })

  it('should provide previous view in context when available', async () => {
    const appHome = new AppHome({ token: 'xoxb-test' })
    let receivedContext: any

    appHome.onAppHomeOpened(async (ctx) => {
      receivedContext = ctx
    })

    const previousView = {
      id: 'V_PREV',
      type: 'home' as const,
      blocks: [],
    }

    const event: AppHomeOpenedEvent = {
      type: 'app_home_opened',
      user: 'U123',
      channel: 'D123',
      tab: 'home',
      event_ts: '1234567890.123456',
      view: previousView,
    }

    await appHome.handleAppHomeOpened(event)

    expect(receivedContext.previousView).toEqual(previousView)
  })
})

// ============================================================================
// BUILDER ENHANCEMENTS TESTS
// ============================================================================

describe('Enhanced Home Tab Builder', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'views.publish': { ok: true, view: { id: 'V123' } },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should add image block to home tab', () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const view = appHome
      .buildHomeTab()
      .header('Gallery')
      .image('https://example.com/image.jpg', 'Sample image', 'My Photo')
      .build()

    expect(view.blocks).toHaveLength(2)
    expect(view.blocks[1]).toMatchObject({
      type: 'image',
      image_url: 'https://example.com/image.jpg',
      alt_text: 'Sample image',
      title: { type: 'plain_text', text: 'My Photo' },
    })
  })

  it('should add image block without title', () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const view = appHome
      .buildHomeTab()
      .image('https://example.com/image.jpg', 'Sample image')
      .build()

    expect(view.blocks[0]).toMatchObject({
      type: 'image',
      image_url: 'https://example.com/image.jpg',
      alt_text: 'Sample image',
    })
    expect(view.blocks[0]).not.toHaveProperty('title')
  })

  it('should add context with text elements', () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const view = appHome
      .buildHomeTab()
      .contextText('Last updated: now', 'By: Admin')
      .build()

    expect(view.blocks[0]).toMatchObject({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: 'Last updated: now' },
        { type: 'mrkdwn', text: 'By: Admin' },
      ],
    })
  })

  it('should track block count', () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const builder = appHome
      .buildHomeTab()
      .header('Title')
      .section('Content')
      .divider()

    expect(builder.blockCount).toBe(3)
  })
})

describe('Enhanced Modal Builder', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch({
      'views.open': { ok: true, view: { id: 'V456' } },
    })
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should add image block to modal', () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const view = appHome
      .buildModal()
      .title('Preview')
      .image('https://example.com/preview.jpg', 'Preview image')
      .build()

    expect(view.blocks[0]).toMatchObject({
      type: 'image',
      image_url: 'https://example.com/preview.jpg',
      alt_text: 'Preview image',
    })
  })

  it('should add context with text elements to modal', () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const view = appHome
      .buildModal()
      .title('Info')
      .contextText('Note: This is important')
      .build()

    expect(view.blocks[0]).toMatchObject({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Note: This is important' }],
    })
  })

  it('should track block count in modal builder', () => {
    const appHome = new AppHome({ token: 'xoxb-test' })

    const builder = appHome
      .buildModal()
      .title('Form')
      .section('Fill out the form')
      .input({ blockId: 'name', label: 'Name', actionId: 'name_input' })

    expect(builder.blockCount).toBe(2)
  })
})

// ============================================================================
// VALUE EXTRACTION UTILITIES TESTS
// ============================================================================

import {
  extractTextValue,
  extractSelectValue,
  extractMultiSelectValues,
  extractUserValue,
  extractMultiUserValues,
  extractChannelValue,
  extractMultiChannelValues,
  extractConversationValue,
  extractDateValue,
  extractTimeValue,
  extractAllValues,
} from '../app-home'

describe('Value Extraction Utilities', () => {
  const sampleValues: ViewState['values'] = {
    name_block: {
      name_input: { type: 'plain_text_input', value: 'John Doe' },
    },
    email_block: {
      email_input: { type: 'plain_text_input', value: 'john@example.com' },
    },
    role_block: {
      role_select: {
        type: 'static_select',
        selected_option: { text: { type: 'plain_text', text: 'Admin' }, value: 'admin' },
      },
    },
    tags_block: {
      tags_multi: {
        type: 'multi_static_select',
        selected_options: [
          { text: { type: 'plain_text', text: 'Tag 1' }, value: 'tag1' },
          { text: { type: 'plain_text', text: 'Tag 2' }, value: 'tag2' },
        ],
      },
    },
    assignee_block: {
      assignee_select: { type: 'users_select', selected_user: 'U456' },
    },
    team_block: {
      team_multi: { type: 'multi_users_select', selected_users: ['U111', 'U222'] },
    },
    channel_block: {
      channel_select: { type: 'channels_select', selected_channel: 'C789' },
    },
    channels_block: {
      channels_multi: { type: 'multi_channels_select', selected_channels: ['C111', 'C222'] },
    },
    conversation_block: {
      conv_select: { type: 'conversations_select', selected_conversation: 'G123' },
    },
    date_block: {
      date_picker: { type: 'datepicker', selected_date: '2024-01-15' },
    },
    time_block: {
      time_picker: { type: 'timepicker', selected_time: '14:30' },
    },
  }

  describe('extractTextValue', () => {
    it('should extract text input value', () => {
      const value = extractTextValue(sampleValues, 'name_block', 'name_input')
      expect(value).toBe('John Doe')
    })

    it('should return undefined for missing block', () => {
      const value = extractTextValue(sampleValues, 'nonexistent', 'input')
      expect(value).toBeUndefined()
    })

    it('should return undefined for missing action', () => {
      const value = extractTextValue(sampleValues, 'name_block', 'nonexistent')
      expect(value).toBeUndefined()
    })
  })

  describe('extractSelectValue', () => {
    it('should extract selected option value', () => {
      const value = extractSelectValue(sampleValues, 'role_block', 'role_select')
      expect(value).toBe('admin')
    })

    it('should return undefined for missing selection', () => {
      const value = extractSelectValue(sampleValues, 'name_block', 'name_input')
      expect(value).toBeUndefined()
    })
  })

  describe('extractMultiSelectValues', () => {
    it('should extract multiple selected values', () => {
      const values = extractMultiSelectValues(sampleValues, 'tags_block', 'tags_multi')
      expect(values).toEqual(['tag1', 'tag2'])
    })

    it('should return undefined for missing selection', () => {
      const values = extractMultiSelectValues(sampleValues, 'name_block', 'name_input')
      expect(values).toBeUndefined()
    })
  })

  describe('extractUserValue', () => {
    it('should extract selected user', () => {
      const value = extractUserValue(sampleValues, 'assignee_block', 'assignee_select')
      expect(value).toBe('U456')
    })
  })

  describe('extractMultiUserValues', () => {
    it('should extract multiple selected users', () => {
      const values = extractMultiUserValues(sampleValues, 'team_block', 'team_multi')
      expect(values).toEqual(['U111', 'U222'])
    })
  })

  describe('extractChannelValue', () => {
    it('should extract selected channel', () => {
      const value = extractChannelValue(sampleValues, 'channel_block', 'channel_select')
      expect(value).toBe('C789')
    })
  })

  describe('extractMultiChannelValues', () => {
    it('should extract multiple selected channels', () => {
      const values = extractMultiChannelValues(sampleValues, 'channels_block', 'channels_multi')
      expect(values).toEqual(['C111', 'C222'])
    })
  })

  describe('extractConversationValue', () => {
    it('should extract selected conversation', () => {
      const value = extractConversationValue(sampleValues, 'conversation_block', 'conv_select')
      expect(value).toBe('G123')
    })
  })

  describe('extractDateValue', () => {
    it('should extract selected date', () => {
      const value = extractDateValue(sampleValues, 'date_block', 'date_picker')
      expect(value).toBe('2024-01-15')
    })
  })

  describe('extractTimeValue', () => {
    it('should extract selected time', () => {
      const value = extractTimeValue(sampleValues, 'time_block', 'time_picker')
      expect(value).toBe('14:30')
    })
  })

  describe('extractAllValues', () => {
    it('should extract all values as flat object', () => {
      const allValues = extractAllValues(sampleValues)

      expect(allValues).toMatchObject({
        name_block: 'John Doe',
        email_block: 'john@example.com',
        role_block: 'admin',
        tags_block: ['tag1', 'tag2'],
        assignee_block: 'U456',
        team_block: ['U111', 'U222'],
        channel_block: 'C789',
        channels_block: ['C111', 'C222'],
        conversation_block: 'G123',
        date_block: '2024-01-15',
        time_block: '14:30',
      })
    })

    it('should handle empty values', () => {
      const allValues = extractAllValues({})
      expect(allValues).toEqual({})
    })
  })
})
