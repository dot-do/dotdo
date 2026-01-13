/**
 * Tests for Auth0 Rules and Actions Engine
 *
 * Tests the Auth0-compatible Rules (legacy) and Actions (modern) execution engines
 * for authentication hooks and custom code execution.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { RulesEngine } from '../rules-engine'
import { ActionsEngine } from '../actions-engine'
import type {
  User,
  RuleContext,
  PostLoginEvent,
} from '../types'

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTestUser(): User {
  return {
    user_id: 'auth0|test123',
    email: 'test@example.com',
    email_verified: true,
    name: 'Test User',
    nickname: 'test',
    picture: 'https://example.com/avatar.png',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    logins_count: 5,
    user_metadata: { theme: 'dark' },
    app_metadata: { roles: ['user'] },
    identities: [
      {
        connection: 'Username-Password-Authentication',
        provider: 'auth0',
        user_id: 'test123',
        isSocial: false,
      },
    ],
  }
}

function createTestRuleContext(): RuleContext {
  return {
    clientID: 'client123',
    clientName: 'Test App',
    connection: 'Username-Password-Authentication',
    connectionStrategy: 'auth0',
    protocol: 'oauth2-resource-owner',
    request: {
      userAgent: 'Mozilla/5.0',
      ip: '192.168.1.1',
      hostname: 'example.auth0.com',
      query: {},
      body: {},
    },
    stats: {
      loginsCount: 5,
    },
  }
}

function createTestPostLoginEvent(): PostLoginEvent {
  const user = createTestUser()
  return {
    transaction: {
      id: 'txn_123',
      requested_scopes: ['openid', 'profile', 'email'],
      locale: 'en',
      acr_values: [],
      ui_locales: ['en'],
      protocol: 'oauth2-resource-owner',
    },
    user: {
      user_id: user.user_id,
      name: user.name,
      nickname: user.nickname,
      email: user.email,
      email_verified: user.email_verified,
      picture: user.picture,
      created_at: user.created_at,
      updated_at: user.updated_at,
      identities: user.identities!,
      user_metadata: user.user_metadata,
      app_metadata: user.app_metadata,
    },
    connection: {
      id: 'con_123',
      name: 'Username-Password-Authentication',
      strategy: 'auth0',
    },
    client: {
      client_id: 'client123',
      name: 'Test App',
    },
    request: {
      ip: '192.168.1.1',
      method: 'POST',
      hostname: 'example.auth0.com',
      user_agent: 'Mozilla/5.0',
      query: {},
      body: {},
    },
    stats: {
      logins_count: 5,
    },
  }
}

// ============================================================================
// RULES ENGINE TESTS
// ============================================================================

describe('RulesEngine', () => {
  let engine: RulesEngine

  beforeEach(() => {
    engine = new RulesEngine()
  })

  describe('CRUD Operations', () => {
    it('should create a rule', () => {
      const rule = engine.create({
        name: 'Test Rule',
        script: `
          function testRule(user, context, callback) {
            callback(null, user, context);
          }
        `,
      })

      expect(rule.id).toMatch(/^rul_/)
      expect(rule.name).toBe('Test Rule')
      expect(rule.enabled).toBe(true)
      expect(rule.stage).toBe('login_success')
      expect(rule.order).toBe(1)
    })

    it('should get a rule by ID', () => {
      const created = engine.create({
        name: 'Test Rule',
        script: 'function test(u, c, cb) { cb(null, u, c); }',
      })

      const retrieved = engine.get(created.id)
      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent rule', () => {
      const rule = engine.get('rul_nonexistent')
      expect(rule).toBeNull()
    })

    it('should get all rules sorted by order', () => {
      engine.create({ name: 'Rule C', script: 'function c(u,c,cb){cb(null,u,c);}', order: 3 })
      engine.create({ name: 'Rule A', script: 'function a(u,c,cb){cb(null,u,c);}', order: 1 })
      engine.create({ name: 'Rule B', script: 'function b(u,c,cb){cb(null,u,c);}', order: 2 })

      const rules = engine.getAll()
      expect(rules.map((r) => r.name)).toEqual(['Rule A', 'Rule B', 'Rule C'])
    })

    it('should filter rules by enabled status', () => {
      engine.create({ name: 'Enabled', script: 'function e(u,c,cb){cb(null,u,c);}', enabled: true })
      engine.create({ name: 'Disabled', script: 'function d(u,c,cb){cb(null,u,c);}', enabled: false })

      const enabledRules = engine.getAll({ enabled: true })
      expect(enabledRules).toHaveLength(1)
      expect(enabledRules[0].name).toBe('Enabled')
    })

    it('should filter rules by stage', () => {
      engine.create({ name: 'Login', script: 'function l(u,c,cb){cb(null,u,c);}', stage: 'login_success' })
      engine.create({ name: 'Pre-auth', script: 'function p(u,c,cb){cb(null,u,c);}', stage: 'pre_authorize' })

      const preAuthRules = engine.getAll({ stage: 'pre_authorize' })
      expect(preAuthRules).toHaveLength(1)
      expect(preAuthRules[0].name).toBe('Pre-auth')
    })

    it('should update a rule', () => {
      const rule = engine.create({
        name: 'Original',
        script: 'function orig(u,c,cb){cb(null,u,c);}',
      })

      const updated = engine.update(rule.id, {
        name: 'Updated',
        enabled: false,
      })

      expect(updated.name).toBe('Updated')
      expect(updated.enabled).toBe(false)
      expect(updated.updated_at).not.toBe(rule.updated_at)
    })

    it('should throw on duplicate rule name', () => {
      engine.create({ name: 'Unique', script: 'function u(u,c,cb){cb(null,u,c);}' })

      expect(() =>
        engine.create({ name: 'Unique', script: 'function u2(u,c,cb){cb(null,u,c);}' })
      ).toThrow('A rule with this name already exists')
    })

    it('should delete a rule', () => {
      const rule = engine.create({
        name: 'To Delete',
        script: 'function d(u,c,cb){cb(null,u,c);}',
      })

      engine.delete(rule.id)
      expect(engine.get(rule.id)).toBeNull()
    })

    it('should enable and disable a rule', () => {
      const rule = engine.create({
        name: 'Toggle',
        script: 'function t(u,c,cb){cb(null,u,c);}',
        enabled: false,
      })

      const enabled = engine.enable(rule.id)
      expect(enabled.enabled).toBe(true)

      const disabled = engine.disable(rule.id)
      expect(disabled.enabled).toBe(false)
    })
  })

  describe('Configuration', () => {
    it('should set and get configuration', () => {
      engine.setConfiguration({ API_KEY: 'secret123' })
      const config = engine.getConfiguration()
      expect(config.API_KEY).toBe('secret123')
    })

    it('should set individual configuration values', () => {
      engine.setConfigurationValue('KEY1', 'value1')
      engine.setConfigurationValue('KEY2', 'value2')

      const config = engine.getConfiguration()
      expect(config.KEY1).toBe('value1')
      expect(config.KEY2).toBe('value2')
    })

    it('should delete configuration values', () => {
      engine.setConfiguration({ KEY: 'value' })
      engine.deleteConfigurationValue('KEY')

      const config = engine.getConfiguration()
      expect(config.KEY).toBeUndefined()
    })
  })

  describe('Rule Execution', () => {
    it('should execute a simple rule', async () => {
      engine.create({
        name: 'Simple Rule',
        script: `
          function simpleRule(user, context, callback) {
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].success).toBe(true)
    })

    it('should modify user in rule', async () => {
      engine.create({
        name: 'Modify User',
        script: `
          function modifyUser(user, context, callback) {
            user.app_metadata = user.app_metadata || {};
            user.app_metadata.modified = true;
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect(result.user.app_metadata?.modified).toBe(true)
    })

    it('should modify context in rule', async () => {
      engine.create({
        name: 'Add Claims',
        script: `
          function addClaims(user, context, callback) {
            context.accessToken = context.accessToken || {};
            context.accessToken['https://example.com/claim'] = 'value';
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect(result.context.accessToken?.['https://example.com/claim']).toBe('value')
    })

    it('should execute rules in order', async () => {
      const order: string[] = []

      engine.create({
        name: 'Rule 2',
        script: `
          function rule2(user, context, callback) {
            user.order = user.order || [];
            user.order.push('rule2');
            callback(null, user, context);
          }
        `,
        order: 2,
      })

      engine.create({
        name: 'Rule 1',
        script: `
          function rule1(user, context, callback) {
            user.order = user.order || [];
            user.order.push('rule1');
            callback(null, user, context);
          }
        `,
        order: 1,
      })

      const user = createTestUser() as User & { order?: string[] }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect((result.user as User & { order?: string[] }).order).toEqual(['rule1', 'rule2'])
    })

    it('should handle rule errors', async () => {
      engine.create({
        name: 'Failing Rule',
        script: `
          function failingRule(user, context, callback) {
            callback(new Error('Rule failed'));
          }
        `,
      })

      const user = createTestUser()
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Rule failed')
    })

    it('should skip disabled rules', async () => {
      engine.create({
        name: 'Disabled Rule',
        script: `
          function disabledRule(user, context, callback) {
            user.shouldNotExist = true;
            callback(null, user, context);
          }
        `,
        enabled: false,
      })

      const user = createTestUser() as User & { shouldNotExist?: boolean }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(0)
      expect((result.user as User & { shouldNotExist?: boolean }).shouldNotExist).toBeUndefined()
    })

    it('should stop pipeline on error', async () => {
      engine.create({
        name: 'Failing',
        script: `
          function failing(user, context, callback) {
            callback(new Error('Stop here'));
          }
        `,
        order: 1,
      })

      engine.create({
        name: 'After Failure',
        script: `
          function afterFailure(user, context, callback) {
            user.shouldNotRun = true;
            callback(null, user, context);
          }
        `,
        order: 2,
      })

      const user = createTestUser() as User & { shouldNotRun?: boolean }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(false)
      expect(result.results).toHaveLength(1)
      expect((result.user as User & { shouldNotRun?: boolean }).shouldNotRun).toBeUndefined()
    })
  })
})

// ============================================================================
// ACTIONS ENGINE TESTS
// ============================================================================

describe('ActionsEngine', () => {
  let engine: ActionsEngine

  beforeEach(() => {
    engine = new ActionsEngine()
  })

  describe('CRUD Operations', () => {
    it('should create an action', () => {
      const action = engine.create({
        name: 'Test Action',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            console.log('Test action executed');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      expect(action.id).toMatch(/^act_/)
      expect(action.name).toBe('Test Action')
      expect(action.status).toBe('pending')
      expect(action.supported_triggers).toHaveLength(1)
      expect(action.supported_triggers[0].id).toBe('post-login')
    })

    it('should get an action by ID', () => {
      const created = engine.create({
        name: 'Test Action',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      const retrieved = engine.get(created.id)
      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent action', () => {
      const action = engine.get('act_nonexistent')
      expect(action).toBeNull()
    })

    it('should get all actions', () => {
      engine.create({
        name: 'Action A',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })
      engine.create({
        name: 'Action B',
        code: 'exports.onExecutePreUserRegistration = async () => {};',
        supported_triggers: [{ id: 'pre-user-registration' }],
      })

      const actions = engine.getAll()
      expect(actions).toHaveLength(2)
    })

    it('should filter actions by trigger', () => {
      engine.create({
        name: 'Post Login',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })
      engine.create({
        name: 'Pre Registration',
        code: 'exports.onExecutePreUserRegistration = async () => {};',
        supported_triggers: [{ id: 'pre-user-registration' }],
      })

      const postLoginActions = engine.getAll({ trigger: 'post-login' })
      expect(postLoginActions).toHaveLength(1)
      expect(postLoginActions[0].name).toBe('Post Login')
    })

    it('should update an action', () => {
      const action = engine.create({
        name: 'Original',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      const updated = engine.update(action.id, {
        name: 'Updated',
        code: 'exports.onExecutePostLogin = async () => { console.log("updated"); };',
      })

      expect(updated.name).toBe('Updated')
      expect(updated.status).toBe('pending') // Reset on code change
    })

    it('should throw on duplicate action name', () => {
      engine.create({
        name: 'Unique',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      expect(() =>
        engine.create({
          name: 'Unique',
          code: 'exports.onExecutePostLogin = async () => {};',
          supported_triggers: [{ id: 'post-login' }],
        })
      ).toThrow('An action with this name already exists')
    })

    it('should delete an action', () => {
      const action = engine.create({
        name: 'To Delete',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.delete(action.id)
      expect(engine.get(action.id)).toBeNull()
    })

    it('should deploy an action', () => {
      const action = engine.create({
        name: 'To Deploy',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      const deployed = engine.deploy(action.id)
      expect(deployed.status).toBe('deployed')
      expect(deployed.deployed_version).toBeDefined()
      expect(deployed.deployed_version?.number).toBe(1)
    })
  })

  describe('Trigger Bindings', () => {
    it('should set and get bindings', () => {
      const action = engine.create({
        name: 'Bound Action',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.setBindings('post-login', [action.id])
      const bindings = engine.getBindings('post-login')

      expect(bindings).toEqual([action.id])
    })

    it('should add a binding', () => {
      const action1 = engine.create({
        name: 'Action 1',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })
      const action2 = engine.create({
        name: 'Action 2',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.addBinding('post-login', action1.id)
      engine.addBinding('post-login', action2.id)

      const bindings = engine.getBindings('post-login')
      expect(bindings).toEqual([action1.id, action2.id])
    })

    it('should add binding at specific position', () => {
      const action1 = engine.create({
        name: 'Action 1',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })
      const action2 = engine.create({
        name: 'Action 2',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })
      const action3 = engine.create({
        name: 'Action 3',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.addBinding('post-login', action1.id)
      engine.addBinding('post-login', action3.id)
      engine.addBinding('post-login', action2.id, 1) // Insert at position 1

      const bindings = engine.getBindings('post-login')
      expect(bindings).toEqual([action1.id, action2.id, action3.id])
    })

    it('should remove a binding', () => {
      const action = engine.create({
        name: 'To Remove',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.addBinding('post-login', action.id)
      engine.removeBinding('post-login', action.id)

      const bindings = engine.getBindings('post-login')
      expect(bindings).toEqual([])
    })

    it('should throw on invalid binding', () => {
      const action = engine.create({
        name: 'Wrong Trigger',
        code: 'exports.onExecutePreUserRegistration = async () => {};',
        supported_triggers: [{ id: 'pre-user-registration' }],
      })

      expect(() => engine.setBindings('post-login', [action.id])).toThrow(
        'does not support trigger post-login'
      )
    })
  })

  describe('Secrets Management', () => {
    it('should set and use secrets', () => {
      const action = engine.create({
        name: 'With Secrets',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
        secrets: [{ name: 'API_KEY', value: 'secret123' }],
      })

      expect(action.secrets).toHaveLength(1)
      expect(action.secrets[0].name).toBe('API_KEY')
      // Value should not be exposed
      expect(action.secrets[0].value).toBeUndefined()
    })

    it('should add secrets after creation', () => {
      const action = engine.create({
        name: 'Action',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.setSecret(action.id, 'NEW_SECRET', 'value')

      const updated = engine.get(action.id)
      expect(updated?.secrets).toHaveLength(1)
      expect(updated?.secrets[0].name).toBe('NEW_SECRET')
    })

    it('should delete secrets', () => {
      const action = engine.create({
        name: 'Action',
        code: 'exports.onExecutePostLogin = async () => {};',
        supported_triggers: [{ id: 'post-login' }],
        secrets: [{ name: 'TO_DELETE', value: 'value' }],
      })

      engine.deleteSecret(action.id, 'TO_DELETE')

      const updated = engine.get(action.id)
      expect(updated?.secrets).toHaveLength(0)
    })
  })

  describe('Action Execution', () => {
    it('should execute a simple post-login action', async () => {
      const action = engine.create({
        name: 'Simple Action',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            console.log('Action executed for', event.user.email);
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].success).toBe(true)
      expect(result.logs).toContain('Action executed for test@example.com')
    })

    it('should capture setCustomClaim commands', async () => {
      const action = engine.create({
        name: 'Add Claims',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            api.accessToken.setCustomClaim('https://example.com/roles', ['admin']);
            api.idToken.setCustomClaim('name', event.user.name);
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.commands).toHaveLength(2)
      expect(result.commands[0]).toEqual({
        type: 'setCustomClaim',
        target: 'accessToken',
        name: 'https://example.com/roles',
        value: ['admin'],
      })
      expect(result.commands[1]).toEqual({
        type: 'setCustomClaim',
        target: 'idToken',
        name: 'name',
        value: 'Test User',
      })
    })

    it('should capture metadata commands', async () => {
      const action = engine.create({
        name: 'Set Metadata',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            api.user.setAppMetadata('loginCount', event.stats.logins_count);
            api.user.setUserMetadata('lastLogin', new Date().toISOString());
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      const metadataCommands = result.commands.filter(
        (c) => c.type === 'setAppMetadata' || c.type === 'setUserMetadata'
      )
      expect(metadataCommands).toHaveLength(2)
    })

    it('should handle access denial', async () => {
      const action = engine.create({
        name: 'Deny Access',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            if (!event.user.email_verified) {
              api.access.deny('Email not verified');
            }
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      event.user.email_verified = false
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(false)
      expect(result.denied).toBe(true)
      expect(result.denialReason).toBe('Email not verified')
    })

    it('should capture redirect commands', async () => {
      const action = engine.create({
        name: 'Redirect',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            api.redirect.sendUserTo('https://example.com/consent', {
              query: { user_id: event.user.user_id },
            });
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.redirectUrl).toContain('https://example.com/consent')
      expect(result.redirectUrl).toContain('user_id=auth0')
    })

    it('should execute actions in binding order', async () => {
      const action1 = engine.create({
        name: 'Action 1',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            console.log('action1');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      const action2 = engine.create({
        name: 'Action 2',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            console.log('action2');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action1.id)
      engine.deploy(action2.id)
      engine.addBinding('post-login', action1.id)
      engine.addBinding('post-login', action2.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.logs).toEqual(['action1', 'action2'])
    })

    it('should skip non-deployed actions', async () => {
      const action = engine.create({
        name: 'Not Deployed',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            console.log('should not run');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      // Don't deploy
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(0)
    })

    it('should handle action errors', async () => {
      const action = engine.create({
        name: 'Failing Action',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            throw new Error('Action failed');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Action failed')
    })

    it('should stop flow on denial', async () => {
      const action1 = engine.create({
        name: 'Denier',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            api.access.deny('Blocked');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      const action2 = engine.create({
        name: 'After Deny',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            console.log('should not run');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action1.id)
      engine.deploy(action2.id)
      engine.addBinding('post-login', action1.id)
      engine.addBinding('post-login', action2.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.denied).toBe(true)
      expect(result.results).toHaveLength(1)
      expect(result.logs).not.toContain('should not run')
    })

    it('should capture MFA commands', async () => {
      const action = engine.create({
        name: 'Enable MFA',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            if (event.stats.logins_count === 1) {
              api.multifactor.enable('any', { allowRememberBrowser: true });
            }
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      event.stats.logins_count = 1
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      const mfaCommand = result.commands.find((c) => c.type === 'enableMfa')
      expect(mfaCommand).toEqual({
        type: 'enableMfa',
        provider: 'any',
        options: { allowRememberBrowser: true },
      })
    })

    it('should capture scope commands', async () => {
      const action = engine.create({
        name: 'Modify Scopes',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            api.accessToken.addScope('admin:read');
            api.accessToken.removeScope('profile');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.commands).toContainEqual({ type: 'addScope', scope: 'admin:read' })
      expect(result.commands).toContainEqual({ type: 'removeScope', scope: 'profile' })
    })
  })

  // ============================================================================
  // TDD RED PHASE - FAILING TESTS FOR ACTIONS (Modern)
  // These tests document missing functionality that needs to be implemented
  // ============================================================================

  describe('Action Versioning [RED]', () => {
    it('should track version history for an action', () => {
      const action = engine.create({
        name: 'Versioned Action',
        code: 'exports.onExecutePostLogin = async () => { /* v1 */ };',
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)

      // Update code and redeploy
      engine.update(action.id, {
        code: 'exports.onExecutePostLogin = async () => { /* v2 */ };',
      })
      engine.deploy(action.id)

      // Should have version history
      const versions = engine.getVersions(action.id)
      expect(versions).toHaveLength(2)
      expect(versions[0].number).toBe(1)
      expect(versions[1].number).toBe(2)
    })

    it('should roll back to previous version', () => {
      const action = engine.create({
        name: 'Rollback Action',
        code: 'exports.onExecutePostLogin = async () => { /* v1 */ };',
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)

      engine.update(action.id, {
        code: 'exports.onExecutePostLogin = async () => { /* v2 - broken */ };',
      })
      engine.deploy(action.id)

      // Roll back to v1
      engine.rollback(action.id, 1)

      const current = engine.get(action.id)
      expect(current?.code).toContain('v1')
      expect(current?.deployed_version?.number).toBe(3) // New version deployed
    })

    it('should get a specific version by number', () => {
      const action = engine.create({
        name: 'Version Query',
        code: 'exports.onExecutePostLogin = async () => { console.log("v1"); };',
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)

      engine.update(action.id, {
        code: 'exports.onExecutePostLogin = async () => { console.log("v2"); };',
      })
      engine.deploy(action.id)

      const v1 = engine.getVersion(action.id, 1)
      expect(v1?.code).toContain('v1')

      const v2 = engine.getVersion(action.id, 2)
      expect(v2?.code).toContain('v2')
    })
  })

  describe('Other Action Triggers [RED]', () => {
    it('should execute pre-user-registration trigger', async () => {
      const action = engine.create({
        name: 'Pre Registration',
        code: `
          exports.onExecutePreUserRegistration = async (event, api) => {
            if (event.user.email?.endsWith('@blocked.com')) {
              api.access.deny('BLOCKED_DOMAIN', 'Registration from this domain is not allowed');
            }
            api.user.setAppMetadata('registeredFrom', event.request.ip);
          };
        `,
        supported_triggers: [{ id: 'pre-user-registration' }],
      })

      engine.deploy(action.id)
      engine.addBinding('pre-user-registration', action.id)

      const event = {
        user: { email: 'user@blocked.com' },
        connection: { id: 'con_123', name: 'Username-Password', strategy: 'auth0' },
        client: { client_id: 'client123', name: 'Test App' },
        request: { ip: '192.168.1.1', user_agent: 'Mozilla', hostname: 'example.com', query: {}, body: {} },
      }

      const result = await engine.executePreUserRegistration(event)
      expect(result.denied).toBe(true)
      expect(result.denialReason).toContain('BLOCKED_DOMAIN')
    })

    it('should execute post-user-registration trigger', async () => {
      const action = engine.create({
        name: 'Post Registration',
        code: `
          exports.onExecutePostUserRegistration = async (event, api) => {
            console.log('New user registered:', event.user.email);
            api.user.setAppMetadata('welcomeEmailSent', true);
          };
        `,
        supported_triggers: [{ id: 'post-user-registration' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-user-registration', action.id)

      const event = {
        user: {
          user_id: 'auth0|new123',
          email: 'new@example.com',
          created_at: new Date().toISOString(),
          identities: [{ connection: 'Username-Password', provider: 'auth0', user_id: 'new123', isSocial: false }],
        },
        connection: { id: 'con_123', name: 'Username-Password', strategy: 'auth0' },
        client: { client_id: 'client123', name: 'Test App' },
        request: { ip: '192.168.1.1', user_agent: 'Mozilla', hostname: 'example.com' },
      }

      const result = await engine.executePostUserRegistration(event)
      expect(result.success).toBe(true)
      expect(result.logs).toContain('New user registered: new@example.com')
      expect(result.commands).toContainEqual({
        type: 'setAppMetadata',
        key: 'welcomeEmailSent',
        value: true,
      })
    })

    it('should execute post-change-password trigger', async () => {
      const action = engine.create({
        name: 'Post Password Change',
        code: `
          exports.onExecutePostChangePassword = async (event, api) => {
            console.log('Password changed for:', event.user.email);
            api.user.setAppMetadata('passwordChangedAt', new Date().toISOString());
          };
        `,
        supported_triggers: [{ id: 'post-change-password' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-change-password', action.id)

      const event = {
        user: {
          user_id: 'auth0|user123',
          email: 'user@example.com',
        },
        connection: { id: 'con_123', name: 'Username-Password', strategy: 'auth0' },
        request: { ip: '192.168.1.1', user_agent: 'Mozilla', hostname: 'example.com' },
      }

      const result = await engine.executePostChangePassword(event)
      expect(result.success).toBe(true)
      expect(result.logs).toContain('Password changed for: user@example.com')
    })

    it('should execute send-phone-message trigger', async () => {
      const action = engine.create({
        name: 'Send SMS',
        code: `
          exports.onExecuteSendPhoneMessage = async (event, api) => {
            // Custom SMS provider integration
            console.log('Sending SMS to:', event.recipient);
            api.message.send({
              to: event.recipient,
              body: event.message_options.body,
            });
          };
        `,
        supported_triggers: [{ id: 'send-phone-message' }],
      })

      engine.deploy(action.id)
      engine.addBinding('send-phone-message', action.id)

      const event = {
        recipient: '+1234567890',
        message_options: {
          body: 'Your verification code is: 123456',
          message_type: 'sms',
        },
        request: { ip: '192.168.1.1', user_agent: 'Mozilla', hostname: 'example.com' },
      }

      const result = await engine.executeSendPhoneMessage(event)
      expect(result.success).toBe(true)
      expect(result.commands).toContainEqual({
        type: 'sendMessage',
        to: '+1234567890',
        body: 'Your verification code is: 123456',
      })
    })

    it('should execute credentials-exchange trigger (M2M)', async () => {
      const action = engine.create({
        name: 'M2M Auth',
        code: `
          exports.onExecuteCredentialsExchange = async (event, api) => {
            // Add custom claims for M2M tokens
            api.accessToken.setCustomClaim('https://example.com/client_type', 'service');
            if (event.client.metadata?.tier === 'premium') {
              api.accessToken.addScope('premium:access');
            }
          };
        `,
        supported_triggers: [{ id: 'credentials-exchange' }],
      })

      engine.deploy(action.id)
      engine.addBinding('credentials-exchange', action.id)

      const event = {
        client: {
          client_id: 'service-client-123',
          name: 'Backend Service',
          metadata: { tier: 'premium' },
        },
        request: {
          ip: '10.0.0.1',
          hostname: 'api.example.com',
        },
        transaction: {
          requested_scopes: ['read:data', 'write:data'],
        },
      }

      const result = await engine.executeCredentialsExchange(event)
      expect(result.success).toBe(true)
      expect(result.commands).toContainEqual({
        type: 'setCustomClaim',
        target: 'accessToken',
        name: 'https://example.com/client_type',
        value: 'service',
      })
      expect(result.commands).toContainEqual({ type: 'addScope', scope: 'premium:access' })
    })
  })

  describe('Action Dependencies [RED]', () => {
    it('should install and use npm dependencies', async () => {
      const action = engine.create({
        name: 'With Dependencies',
        code: `
          const lodash = require('lodash');

          exports.onExecutePostLogin = async (event, api) => {
            const roles = lodash.get(event, 'user.app_metadata.roles', []);
            api.accessToken.setCustomClaim('https://example.com/roles', roles);
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
        dependencies: [{ name: 'lodash', version: '4.17.21' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      event.user.app_metadata = { roles: ['admin', 'user'] }
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.commands).toContainEqual({
        type: 'setCustomClaim',
        target: 'accessToken',
        name: 'https://example.com/roles',
        value: ['admin', 'user'],
      })
    })

    it('should validate dependency versions', () => {
      expect(() =>
        engine.create({
          name: 'Invalid Dep',
          code: 'exports.onExecutePostLogin = async () => {};',
          supported_triggers: [{ id: 'post-login' }],
          dependencies: [{ name: 'nonexistent-package-xyz', version: '99.99.99' }],
        })
      ).toThrow('Dependency validation failed')
    })
  })

  describe('Action Secrets in Execution [RED]', () => {
    it('should access secrets in action code', async () => {
      const action = engine.create({
        name: 'With Secrets',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            const apiKey = event.secrets.API_KEY;
            console.log('API Key length:', apiKey?.length);

            if (!apiKey) {
              throw new Error('API_KEY secret not found');
            }
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
        secrets: [{ name: 'API_KEY', value: 'secret-api-key-123' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.logs).toContain('API Key length: 18')
    })
  })

  describe('Action Continue/Redirect Flow [RED]', () => {
    it('should continue after redirect with validated token', async () => {
      const action = engine.create({
        name: 'Redirect Flow',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            // Check if this is a continue after redirect
            const payload = api.redirect.validateToken({ secret: 'my-secret' });

            if (payload && payload.consent_accepted) {
              api.user.setAppMetadata('consentAccepted', true);
              return;
            }

            // First time - redirect for consent
            api.redirect.sendUserTo('https://consent.example.com', {
              query: { user_id: event.user.user_id },
            });
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      // First execution - should redirect
      const event1 = createTestPostLoginEvent()
      const result1 = await engine.executePostLogin(event1)

      expect(result1.redirectUrl).toContain('https://consent.example.com')

      // Continue execution with token
      const event2 = createTestPostLoginEvent()
      event2.request.query = { session_token: 'valid-jwt-token' }
      const result2 = await engine.executePostLogin(event2, {
        continueToken: 'valid-jwt-token',
      })

      expect(result2.success).toBe(true)
      expect(result2.commands).toContainEqual({
        type: 'setAppMetadata',
        key: 'consentAccepted',
        value: true,
      })
    })
  })

  describe('Action Execution Timeout [RED]', () => {
    it('should timeout long-running actions', async () => {
      const shortTimeoutEngine = new ActionsEngine({ timeout: 100 })

      const action = shortTimeoutEngine.create({
        name: 'Slow Action',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            await new Promise(resolve => setTimeout(resolve, 5000));
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      shortTimeoutEngine.deploy(action.id)
      shortTimeoutEngine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await shortTimeoutEngine.executePostLogin(event)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })
  })

  describe('Action Logs and Debugging [RED]', () => {
    it('should capture console.error separately from console.log', async () => {
      const action = engine.create({
        name: 'Logging Action',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            console.log('Info message');
            console.warn('Warning message');
            console.error('Error message');
            console.debug('Debug message');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.logLevels).toBeDefined()
      expect(result.logLevels?.info).toContain('Info message')
      expect(result.logLevels?.warn).toContain('Warning message')
      expect(result.logLevels?.error).toContain('Error message')
      expect(result.logLevels?.debug).toContain('Debug message')
    })

    it('should capture execution metrics', async () => {
      const action = engine.create({
        name: 'Metrics Action',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            console.log('Executed');
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      const result = await engine.executePostLogin(event)

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.memoryUsed).toBeDefined()
      expect(result.metrics?.cpuTime).toBeDefined()
    })
  })

  describe('Action SAML Response [RED]', () => {
    it('should set SAML response attributes', async () => {
      const action = engine.create({
        name: 'SAML Action',
        code: `
          exports.onExecutePostLogin = async (event, api) => {
            if (api.samlResponse) {
              api.samlResponse.setAttribute('department', event.user.app_metadata?.department || 'default');
              api.samlResponse.setAttribute('roles', ['user', 'reader']);
              api.samlResponse.setAudience('https://sp.example.com');
              api.samlResponse.setLifetimeInSeconds(3600);
            }
          };
        `,
        supported_triggers: [{ id: 'post-login' }],
      })

      engine.deploy(action.id)
      engine.addBinding('post-login', action.id)

      const event = createTestPostLoginEvent()
      event.user.app_metadata = { department: 'Engineering' }
      event.transaction.protocol = 'samlp'

      const result = await engine.executePostLogin(event)

      expect(result.success).toBe(true)
      expect(result.samlCommands).toBeDefined()
      expect(result.samlCommands).toContainEqual({
        type: 'setAttribute',
        name: 'department',
        value: 'Engineering',
      })
      expect(result.samlCommands).toContainEqual({
        type: 'setAudience',
        audience: 'https://sp.example.com',
      })
    })
  })
})

// ============================================================================
// TDD RED PHASE - FAILING TESTS FOR RULES (Legacy)
// These tests document missing functionality that needs to be implemented
// ============================================================================

describe('RulesEngine Advanced [RED]', () => {
  let engine: RulesEngine

  beforeEach(() => {
    engine = new RulesEngine()
  })

  describe('Rule Access to Global Configuration [RED]', () => {
    it('should make configuration available in rule execution', async () => {
      engine.setConfiguration({
        API_ENDPOINT: 'https://api.example.com',
        API_KEY: 'secret-key-123',
      })

      engine.create({
        name: 'Config Rule',
        script: `
          function configRule(user, context, callback) {
            // configuration is a global object in Auth0 rules
            user.apiEndpoint = configuration.API_ENDPOINT;
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser() as User & { apiEndpoint?: string }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect((result.user as User & { apiEndpoint?: string }).apiEndpoint).toBe('https://api.example.com')
    })
  })

  describe('Rule Redirect Flow [RED]', () => {
    it('should handle redirect in rules', async () => {
      engine.create({
        name: 'Redirect Rule',
        script: `
          function redirectRule(user, context, callback) {
            context.redirect = {
              url: 'https://consent.example.com?user=' + user.user_id
            };
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect(result.context.redirect?.url).toContain('https://consent.example.com')
      expect(result.context.redirect?.url).toContain(user.user_id)
    })

    it('should continue after redirect with session token', async () => {
      engine.create({
        name: 'Continue Rule',
        script: `
          function continueRule(user, context, callback) {
            // Check for session token indicating return from redirect
            if (context.protocol === 'redirect-callback') {
              user.app_metadata = user.app_metadata || {};
              user.app_metadata.consentGiven = true;
              callback(null, user, context);
              return;
            }

            // First pass - redirect
            context.redirect = { url: 'https://consent.example.com' };
            callback(null, user, context);
          }
        `,
      })

      // First execution
      const user1 = createTestUser()
      const context1 = createTestRuleContext()
      const result1 = await engine.execute(user1, context1)
      expect(result1.context.redirect).toBeDefined()

      // Continue after redirect
      const user2 = createTestUser()
      const context2 = createTestRuleContext()
      context2.protocol = 'redirect-callback'
      const result2 = await engine.execute(user2, context2)

      expect(result2.success).toBe(true)
      expect(result2.user.app_metadata?.consentGiven).toBe(true)
    })
  })

  describe('Rule MFA Enforcement [RED]', () => {
    it('should trigger MFA via context.multifactor', async () => {
      engine.create({
        name: 'MFA Rule',
        script: `
          function mfaRule(user, context, callback) {
            // Require MFA for admin users
            if (user.app_metadata && user.app_metadata.roles && user.app_metadata.roles.includes('admin')) {
              context.multifactor = {
                provider: 'any',
                allowRememberBrowser: false
              };
            }
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      user.app_metadata = { roles: ['admin', 'user'] }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect(result.context.multifactor).toBeDefined()
      expect(result.context.multifactor?.provider).toBe('any')
      expect(result.context.multifactor?.allowRememberBrowser).toBe(false)
    })
  })

  describe('Rule Async Operations [RED]', () => {
    it('should support async/await in modern rule syntax', async () => {
      engine.create({
        name: 'Async Rule',
        script: `
          async function asyncRule(user, context, callback) {
            // Simulate async operation
            const data = await Promise.resolve({ verified: true });
            user.asyncVerified = data.verified;
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser() as User & { asyncVerified?: boolean }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect((result.user as User & { asyncVerified?: boolean }).asyncVerified).toBe(true)
    })
  })

  describe('Rule Stage Execution [RED]', () => {
    it('should execute pre_authorize rules before login_success', async () => {
      const executionOrder: string[] = []

      engine.create({
        name: 'Pre Auth',
        script: `
          function preAuth(user, context, callback) {
            user.executionOrder = user.executionOrder || [];
            user.executionOrder.push('pre_authorize');
            callback(null, user, context);
          }
        `,
        stage: 'pre_authorize',
        order: 1,
      })

      engine.create({
        name: 'Login Success',
        script: `
          function loginSuccess(user, context, callback) {
            user.executionOrder = user.executionOrder || [];
            user.executionOrder.push('login_success');
            callback(null, user, context);
          }
        `,
        stage: 'login_success',
        order: 1,
      })

      const user = createTestUser() as User & { executionOrder?: string[] }
      const context = createTestRuleContext()

      // Execute pre_authorize first
      await engine.execute(user, context, 'pre_authorize')
      // Then login_success
      const result = await engine.execute(user, context, 'login_success')

      expect((result.user as User & { executionOrder?: string[] }).executionOrder).toEqual([
        'pre_authorize',
        'login_success',
      ])
    })

    it('should execute login_failure rules on authentication failure', async () => {
      engine.create({
        name: 'Failure Handler',
        script: `
          function failureHandler(user, context, callback) {
            // Log failed attempt
            user.lastFailedLogin = new Date().toISOString();
            callback(null, user, context);
          }
        `,
        stage: 'login_failure',
      })

      const user = createTestUser() as User & { lastFailedLogin?: string }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context, 'login_failure')

      expect(result.success).toBe(true)
      expect((result.user as User & { lastFailedLogin?: string }).lastFailedLogin).toBeDefined()
    })
  })

  describe('Rule Sandbox Security [RED]', () => {
    it('should prevent access to Node.js fs module', async () => {
      engine.create({
        name: 'Malicious Rule',
        script: `
          function maliciousRule(user, context, callback) {
            const fs = require('fs');
            fs.readFileSync('/etc/passwd');
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('not available')
    })

    it('should prevent access to process.env', async () => {
      engine.create({
        name: 'Env Access Rule',
        script: `
          function envRule(user, context, callback) {
            user.secret = process.env.SECRET_KEY;
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser() as User & { secret?: string }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      // Should either fail or not expose process.env
      expect(
        result.success === false || (result.user as User & { secret?: string }).secret === undefined
      ).toBe(true)
    })

    it('should prevent infinite loops with timeout', async () => {
      const shortTimeoutEngine = new RulesEngine({ timeout: 100 })

      shortTimeoutEngine.create({
        name: 'Infinite Loop',
        script: `
          function infiniteLoop(user, context, callback) {
            while (true) {}
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      const context = createTestRuleContext()
      const result = await shortTimeoutEngine.execute(user, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })
  })

  describe('Rule Built-in Modules [RED]', () => {
    it('should provide crypto module for hashing', async () => {
      engine.create({
        name: 'Crypto Rule',
        script: `
          function cryptoRule(user, context, callback) {
            const crypto = require('crypto');
            const hash = crypto.createHash('sha256').update(user.email).digest('hex');
            user.emailHash = hash;
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser() as User & { emailHash?: string }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect((result.user as User & { emailHash?: string }).emailHash).toBeDefined()
      expect((result.user as User & { emailHash?: string }).emailHash?.length).toBe(64) // SHA256 hex length
    })

    it('should provide request module for HTTP calls', async () => {
      engine.create({
        name: 'Request Rule',
        script: `
          function requestRule(user, context, callback) {
            const request = require('request');

            // Mock response for testing
            user.externalData = { fetched: true };
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser() as User & { externalData?: { fetched: boolean } }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect((result.user as User & { externalData?: { fetched: boolean } }).externalData?.fetched).toBe(true)
    })
  })

  describe('Rule Webtask Compatibility [RED]', () => {
    it('should support webtask context object', async () => {
      engine.create({
        name: 'Webtask Rule',
        script: `
          function webtaskRule(user, context, callback) {
            // Auth0 rules have access to webtask context in some environments
            if (global.webtask) {
              user.webtaskEnv = global.webtask.secrets.MY_SECRET;
            }
            callback(null, user, context);
          }
        `,
      })

      // Configure webtask context
      engine.setWebtaskContext({
        secrets: { MY_SECRET: 'secret-value' },
      })

      const user = createTestUser() as User & { webtaskEnv?: string }
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect((result.user as User & { webtaskEnv?: string }).webtaskEnv).toBe('secret-value')
    })
  })

  describe('Rule Execution Metrics [RED]', () => {
    it('should track execution time per rule', async () => {
      engine.create({
        name: 'Fast Rule',
        script: `
          function fastRule(user, context, callback) {
            callback(null, user, context);
          }
        `,
        order: 1,
      })

      engine.create({
        name: 'Slow Rule',
        script: `
          function slowRule(user, context, callback) {
            // Simulate some work
            let sum = 0;
            for (let i = 0; i < 1000000; i++) sum += i;
            user.sum = sum;
            callback(null, user, context);
          }
        `,
        order: 2,
      })

      const user = createTestUser()
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect(result.results[0].executionTimeMs).toBeDefined()
      expect(result.results[1].executionTimeMs).toBeDefined()
      expect(result.results[1].executionTimeMs).toBeGreaterThan(result.results[0].executionTimeMs)
    })

    it('should report memory usage', async () => {
      engine.create({
        name: 'Memory Rule',
        script: `
          function memoryRule(user, context, callback) {
            // Allocate some memory
            const arr = new Array(10000).fill('x');
            user.arrLength = arr.length;
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(true)
      expect(result.results[0].memoryUsedBytes).toBeDefined()
      expect(result.results[0].memoryUsedBytes).toBeGreaterThan(0)
    })
  })

  describe('Rule Error Handling [RED]', () => {
    it('should capture UnauthorizedError for access denial', async () => {
      engine.create({
        name: 'Deny Rule',
        script: `
          function denyRule(user, context, callback) {
            if (user.blocked) {
              callback(new UnauthorizedError('User is blocked'));
              return;
            }
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      user.blocked = true
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(false)
      expect(result.errorType).toBe('UnauthorizedError')
      expect(result.error).toBe('User is blocked')
    })

    it('should provide ValidationError for input validation', async () => {
      engine.create({
        name: 'Validation Rule',
        script: `
          function validationRule(user, context, callback) {
            if (!user.email) {
              callback(new ValidationError('email_required', 'Email is required'));
              return;
            }
            callback(null, user, context);
          }
        `,
      })

      const user = createTestUser()
      delete user.email
      const context = createTestRuleContext()
      const result = await engine.execute(user, context)

      expect(result.success).toBe(false)
      expect(result.errorType).toBe('ValidationError')
      expect(result.errorCode).toBe('email_required')
    })
  })
})
