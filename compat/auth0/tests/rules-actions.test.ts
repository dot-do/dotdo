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
})
