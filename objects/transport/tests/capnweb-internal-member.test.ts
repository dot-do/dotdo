/**
 * Cap'n Web Internal Member Tests
 *
 * Tests for the isInternalMember function that determines which methods
 * and properties should be hidden from Cap'n Web RPC exposure.
 *
 * This function replaces the legacy isRpcExposed method in RPCServer
 * and is critical for security - it prevents internal lifecycle methods,
 * private fields, and protected members from being called via RPC.
 */

import { describe, it, expect } from 'vitest'
import { isInternalMember } from '../capnweb-target'

// ============================================================================
// 1. LIFECYCLE METHODS BLOCKED
// ============================================================================

describe('isInternalMember - Lifecycle Methods', () => {
  it('blocks fetch lifecycle method', () => {
    expect(isInternalMember('fetch')).toBe(true)
  })

  it('blocks alarm lifecycle method', () => {
    expect(isInternalMember('alarm')).toBe(true)
  })

  it('blocks webSocketMessage lifecycle method', () => {
    expect(isInternalMember('webSocketMessage')).toBe(true)
  })

  it('blocks webSocketClose lifecycle method', () => {
    expect(isInternalMember('webSocketClose')).toBe(true)
  })

  it('blocks webSocketError lifecycle method', () => {
    expect(isInternalMember('webSocketError')).toBe(true)
  })

  it('blocks all DO lifecycle methods', () => {
    const lifecycleMethods = [
      'fetch',
      'alarm',
      'webSocketMessage',
      'webSocketClose',
      'webSocketError',
    ]
    for (const method of lifecycleMethods) {
      expect(isInternalMember(method)).toBe(true)
    }
  })
})

// ============================================================================
// 2. UNDERSCORE-PREFIXED MEMBERS BLOCKED
// ============================================================================

describe('isInternalMember - Underscore Prefix', () => {
  it('blocks single underscore prefix', () => {
    expect(isInternalMember('_privateMethod')).toBe(true)
  })

  it('blocks double underscore prefix', () => {
    expect(isInternalMember('__dunderMethod')).toBe(true)
  })

  it('blocks underscore-only name', () => {
    expect(isInternalMember('_')).toBe(true)
  })

  it('blocks multiple underscores', () => {
    expect(isInternalMember('___tripleUnderscore')).toBe(true)
  })

  it('blocks known internal properties with underscore prefix', () => {
    const underscoreProperties = [
      '_mcpSessions',
      '_mcpHandler',
      '_rpcServer',
      '_syncEngine',
      '_currentActor',
      '_things',
      '_rels',
      '_actions',
      '_events',
      '_search',
      '_objects',
      '_dlq',
      '_typeCache',
      '_eventHandlers',
      '_handlerCounter',
      '_scheduleHandlers',
      '_scheduleManager',
      '_stepCache',
      '_currentActorContext',
      '_circuitBreakers',
    ]
    for (const prop of underscoreProperties) {
      expect(isInternalMember(prop)).toBe(true)
    }
  })

  it('blocks arbitrary underscore-prefixed names', () => {
    expect(isInternalMember('_anyArbitraryName')).toBe(true)
    expect(isInternalMember('_foo')).toBe(true)
    expect(isInternalMember('_bar123')).toBe(true)
    expect(isInternalMember('_with_underscores_in_name')).toBe(true)
  })
})

// ============================================================================
// 3. HASH-PREFIXED MEMBERS BLOCKED (ES2022 Private Fields)
// ============================================================================

describe('isInternalMember - Hash Prefix (Private Fields)', () => {
  it('blocks hash-prefixed private fields', () => {
    expect(isInternalMember('#privateField')).toBe(true)
  })

  it('blocks hash-only name', () => {
    expect(isInternalMember('#')).toBe(true)
  })

  it('blocks various hash-prefixed names', () => {
    expect(isInternalMember('#state')).toBe(true)
    expect(isInternalMember('#internal')).toBe(true)
    expect(isInternalMember('#_mixedPrefix')).toBe(true)
    expect(isInternalMember('#123numeric')).toBe(true)
    expect(isInternalMember('#with_underscores')).toBe(true)
  })

  it('blocks common private field patterns', () => {
    const privateFields = [
      '#data',
      '#cache',
      '#storage',
      '#config',
      '#handler',
      '#listeners',
      '#initialized',
    ]
    for (const field of privateFields) {
      expect(isInternalMember(field)).toBe(true)
    }
  })
})

// ============================================================================
// 4. INTERNAL_METHODS SET MEMBERS BLOCKED
// ============================================================================

describe('isInternalMember - INTERNAL_METHODS Set', () => {
  describe('DO initialization and state methods', () => {
    it('blocks initialize', () => {
      expect(isInternalMember('initialize')).toBe(true)
    })

    it('blocks handleFetch', () => {
      expect(isInternalMember('handleFetch')).toBe(true)
    })

    it('blocks handleMcp', () => {
      expect(isInternalMember('handleMcp')).toBe(true)
    })

    it('blocks handleSyncWebSocket', () => {
      expect(isInternalMember('handleSyncWebSocket')).toBe(true)
    })

    it('blocks handleIntrospectRoute', () => {
      expect(isInternalMember('handleIntrospectRoute')).toBe(true)
    })
  })

  describe('Database and storage accessors', () => {
    it('blocks db', () => {
      expect(isInternalMember('db')).toBe(true)
    })

    it('blocks ctx', () => {
      expect(isInternalMember('ctx')).toBe(true)
    })

    it('blocks storage', () => {
      expect(isInternalMember('storage')).toBe(true)
    })

    it('blocks env', () => {
      expect(isInternalMember('env')).toBe(true)
    })
  })

  describe('Constructor and Object prototype methods', () => {
    it('blocks constructor', () => {
      expect(isInternalMember('constructor')).toBe(true)
    })

    it('blocks toString', () => {
      expect(isInternalMember('toString')).toBe(true)
    })

    it('blocks toLocaleString', () => {
      expect(isInternalMember('toLocaleString')).toBe(true)
    })

    it('blocks valueOf', () => {
      expect(isInternalMember('valueOf')).toBe(true)
    })

    it('blocks hasOwnProperty', () => {
      expect(isInternalMember('hasOwnProperty')).toBe(true)
    })

    it('blocks isPrototypeOf', () => {
      expect(isInternalMember('isPrototypeOf')).toBe(true)
    })

    it('blocks propertyIsEnumerable', () => {
      expect(isInternalMember('propertyIsEnumerable')).toBe(true)
    })

    it('blocks __defineGetter__', () => {
      expect(isInternalMember('__defineGetter__')).toBe(true)
    })

    it('blocks __defineSetter__', () => {
      expect(isInternalMember('__defineSetter__')).toBe(true)
    })

    it('blocks __lookupGetter__', () => {
      expect(isInternalMember('__lookupGetter__')).toBe(true)
    })

    it('blocks __lookupSetter__', () => {
      expect(isInternalMember('__lookupSetter__')).toBe(true)
    })

    it('blocks __proto__', () => {
      expect(isInternalMember('__proto__')).toBe(true)
    })
  })

  describe('Internal workflow methods', () => {
    it('blocks send', () => {
      expect(isInternalMember('send')).toBe(true)
    })

    it('blocks try', () => {
      expect(isInternalMember('try')).toBe(true)
    })

    it('blocks do', () => {
      expect(isInternalMember('do')).toBe(true)
    })

    it('blocks createWorkflowContext', () => {
      expect(isInternalMember('createWorkflowContext')).toBe(true)
    })

    it('blocks createOnProxy', () => {
      expect(isInternalMember('createOnProxy')).toBe(true)
    })

    it('blocks createScheduleBuilder', () => {
      expect(isInternalMember('createScheduleBuilder')).toBe(true)
    })

    it('blocks createDomainProxy', () => {
      expect(isInternalMember('createDomainProxy')).toBe(true)
    })
  })

  describe('Action logging methods', () => {
    it('blocks logAction', () => {
      expect(isInternalMember('logAction')).toBe(true)
    })

    it('blocks updateActionStatus', () => {
      expect(isInternalMember('updateActionStatus')).toBe(true)
    })

    it('blocks updateActionAttempts', () => {
      expect(isInternalMember('updateActionAttempts')).toBe(true)
    })

    it('blocks completeAction', () => {
      expect(isInternalMember('completeAction')).toBe(true)
    })

    it('blocks failAction', () => {
      expect(isInternalMember('failAction')).toBe(true)
    })

    it('blocks executeAction', () => {
      expect(isInternalMember('executeAction')).toBe(true)
    })
  })

  describe('Event handling methods', () => {
    it('blocks emitEvent', () => {
      expect(isInternalMember('emitEvent')).toBe(true)
    })

    it('blocks emit', () => {
      expect(isInternalMember('emit')).toBe(true)
    })

    it('blocks emitSystemError', () => {
      expect(isInternalMember('emitSystemError')).toBe(true)
    })

    it('blocks dispatchEventToHandlers', () => {
      expect(isInternalMember('dispatchEventToHandlers')).toBe(true)
    })
  })

  describe('Cross-DO internal methods', () => {
    it('blocks invokeDomainMethod', () => {
      expect(isInternalMember('invokeDomainMethod')).toBe(true)
    })

    it('blocks invokeCrossDOMethod', () => {
      expect(isInternalMember('invokeCrossDOMethod')).toBe(true)
    })

    it('blocks fetchWithCrossDOTimeout', () => {
      expect(isInternalMember('fetchWithCrossDOTimeout')).toBe(true)
    })

    it('blocks checkCircuitBreaker', () => {
      expect(isInternalMember('checkCircuitBreaker')).toBe(true)
    })

    it('blocks recordCircuitBreakerSuccess', () => {
      expect(isInternalMember('recordCircuitBreakerSuccess')).toBe(true)
    })

    it('blocks recordCircuitBreakerFailure', () => {
      expect(isInternalMember('recordCircuitBreakerFailure')).toBe(true)
    })
  })

  describe('Resolution methods', () => {
    it('blocks resolve', () => {
      expect(isInternalMember('resolve')).toBe(true)
    })

    it('blocks resolveLocal', () => {
      expect(isInternalMember('resolveLocal')).toBe(true)
    })

    it('blocks resolveCrossDO', () => {
      expect(isInternalMember('resolveCrossDO')).toBe(true)
    })

    it('blocks resolveNounToFK', () => {
      expect(isInternalMember('resolveNounToFK')).toBe(true)
    })

    it('blocks registerNoun', () => {
      expect(isInternalMember('registerNoun')).toBe(true)
    })
  })

  describe('Visibility and access control methods', () => {
    it('blocks canViewThing', () => {
      expect(isInternalMember('canViewThing')).toBe(true)
    })

    it('blocks assertCanView', () => {
      expect(isInternalMember('assertCanView')).toBe(true)
    })

    it('blocks filterVisibleThings', () => {
      expect(isInternalMember('filterVisibleThings')).toBe(true)
    })

    it('blocks getVisibleThing', () => {
      expect(isInternalMember('getVisibleThing')).toBe(true)
    })

    it('blocks getVisibility', () => {
      expect(isInternalMember('getVisibility')).toBe(true)
    })

    it('blocks isOwner', () => {
      expect(isInternalMember('isOwner')).toBe(true)
    })

    it('blocks isInThingOrg', () => {
      expect(isInternalMember('isInThingOrg')).toBe(true)
    })

    it('blocks setActorContext', () => {
      expect(isInternalMember('setActorContext')).toBe(true)
    })

    it('blocks getActorContext', () => {
      expect(isInternalMember('getActorContext')).toBe(true)
    })

    it('blocks clearActorContext', () => {
      expect(isInternalMember('clearActorContext')).toBe(true)
    })

    it('blocks determineRole', () => {
      expect(isInternalMember('determineRole')).toBe(true)
    })
  })

  describe('Store context methods', () => {
    it('blocks getStoreContext', () => {
      expect(isInternalMember('getStoreContext')).toBe(true)
    })
  })

  describe('JWT verification methods', () => {
    it('blocks verifyJwtSignature', () => {
      expect(isInternalMember('verifyJwtSignature')).toBe(true)
    })

    it('blocks base64UrlDecode', () => {
      expect(isInternalMember('base64UrlDecode')).toBe(true)
    })
  })

  describe('Introspection helper methods', () => {
    it('blocks introspectClasses', () => {
      expect(isInternalMember('introspectClasses')).toBe(true)
    })

    it('blocks introspectStores', () => {
      expect(isInternalMember('introspectStores')).toBe(true)
    })

    it('blocks introspectStorage', () => {
      expect(isInternalMember('introspectStorage')).toBe(true)
    })

    it('blocks introspectNouns', () => {
      expect(isInternalMember('introspectNouns')).toBe(true)
    })

    it('blocks introspectVerbs', () => {
      expect(isInternalMember('introspectVerbs')).toBe(true)
    })
  })

  describe('Utility methods', () => {
    it('blocks log', () => {
      expect(isInternalMember('log')).toBe(true)
    })

    it('blocks sleep', () => {
      expect(isInternalMember('sleep')).toBe(true)
    })

    it('blocks calculateBackoffDelay', () => {
      expect(isInternalMember('calculateBackoffDelay')).toBe(true)
    })

    it('blocks generateStepId', () => {
      expect(isInternalMember('generateStepId')).toBe(true)
    })

    it('blocks persistStepResult', () => {
      expect(isInternalMember('persistStepResult')).toBe(true)
    })

    it('blocks loadPersistedSteps', () => {
      expect(isInternalMember('loadPersistedSteps')).toBe(true)
    })
  })
})

// ============================================================================
// 5. INTERNAL_PROPERTIES SET MEMBERS BLOCKED
// ============================================================================

describe('isInternalMember - INTERNAL_PROPERTIES Set', () => {
  it('blocks $ (WorkflowContext)', () => {
    expect(isInternalMember('$')).toBe(true)
  })

  it('blocks app', () => {
    expect(isInternalMember('app')).toBe(true)
  })

  it('blocks parent', () => {
    expect(isInternalMember('parent')).toBe(true)
  })

  it('blocks currentBranch', () => {
    expect(isInternalMember('currentBranch')).toBe(true)
  })

  it('blocks all INTERNAL_PROPERTIES', () => {
    const internalProperties = [
      '$',
      'app',
      'parent',
      'currentBranch',
    ]
    for (const prop of internalProperties) {
      expect(isInternalMember(prop)).toBe(true)
    }
  })
})

// ============================================================================
// 6. PUBLIC METHODS ALLOWED THROUGH
// ============================================================================

describe('isInternalMember - Public Methods Allowed', () => {
  it('allows greet method', () => {
    expect(isInternalMember('greet')).toBe(false)
  })

  it('allows calculate method', () => {
    expect(isInternalMember('calculate')).toBe(false)
  })

  it('allows getData method', () => {
    expect(isInternalMember('getData')).toBe(false)
  })

  it('allows setData method', () => {
    expect(isInternalMember('setData')).toBe(false)
  })

  it('allows common public method names', () => {
    const publicMethods = [
      'greet',
      'calculate',
      'getData',
      'setData',
      'process',
      'handle',
      'create',
      'update',
      'delete',
      'list',
      'get',
      'set',
      'find',
      'search',
      'validate',
      'transform',
      'render',
      'execute',
      'run',
      'start',
      'stop',
      'pause',
      'resume',
    ]
    for (const method of publicMethods) {
      expect(isInternalMember(method)).toBe(false)
    }
  })
})

// ============================================================================
// 7. USER-DEFINED METHODS ALLOWED THROUGH
// ============================================================================

describe('isInternalMember - User-Defined Methods Allowed', () => {
  it('allows custom user method names', () => {
    expect(isInternalMember('myCustomMethod')).toBe(false)
  })

  it('allows camelCase method names', () => {
    expect(isInternalMember('getUserProfile')).toBe(false)
    expect(isInternalMember('updateUserSettings')).toBe(false)
    expect(isInternalMember('deleteAccount')).toBe(false)
  })

  it('allows PascalCase method names', () => {
    expect(isInternalMember('GetUser')).toBe(false)
    expect(isInternalMember('CreateOrder')).toBe(false)
  })

  it('allows snake_case method names (if they do not start with underscore)', () => {
    expect(isInternalMember('get_user')).toBe(false)
    expect(isInternalMember('create_order')).toBe(false)
    expect(isInternalMember('process_payment')).toBe(false)
  })

  it('allows method names with numbers', () => {
    expect(isInternalMember('process2')).toBe(false)
    expect(isInternalMember('handler123')).toBe(false)
    expect(isInternalMember('v2GetData')).toBe(false)
  })

  it('allows single character method names', () => {
    expect(isInternalMember('a')).toBe(false)
    expect(isInternalMember('x')).toBe(false)
    expect(isInternalMember('Z')).toBe(false)
  })

  it('allows method names that contain internal keywords but are not exact matches', () => {
    // These contain 'fetch' but are not the exact 'fetch' method
    expect(isInternalMember('fetchUser')).toBe(false)
    expect(isInternalMember('prefetch')).toBe(false)
    expect(isInternalMember('fetchData')).toBe(false)

    // These contain 'alarm' but are not the exact 'alarm' method
    expect(isInternalMember('alarmSettings')).toBe(false)
    expect(isInternalMember('getAlarms')).toBe(false)

    // These contain 'constructor' but are not the exact 'constructor'
    expect(isInternalMember('constructorHelper')).toBe(false)
  })
})

// ============================================================================
// 8. EDGE CASES
// ============================================================================

describe('isInternalMember - Edge Cases', () => {
  describe('Empty and whitespace strings', () => {
    it('allows empty string (not internal)', () => {
      // Empty string doesn't match any internal pattern
      expect(isInternalMember('')).toBe(false)
    })

    it('allows whitespace-only strings', () => {
      expect(isInternalMember(' ')).toBe(false)
      expect(isInternalMember('  ')).toBe(false)
      expect(isInternalMember('\t')).toBe(false)
      expect(isInternalMember('\n')).toBe(false)
    })

    it('allows strings with leading/trailing whitespace', () => {
      // The whitespace versions are different strings from the internal methods
      expect(isInternalMember(' fetch')).toBe(false)
      expect(isInternalMember('fetch ')).toBe(false)
      expect(isInternalMember(' fetch ')).toBe(false)
    })
  })

  describe('Special characters', () => {
    it('allows strings starting with special characters (non-_ non-#)', () => {
      expect(isInternalMember('@decorator')).toBe(false)
      // '$' alone is in INTERNAL_PROPERTIES, but '$method' is not (exact match only)
      expect(isInternalMember('$method')).toBe(false)
      expect(isInternalMember('$$method')).toBe(false)
      expect(isInternalMember('%percent')).toBe(false)
      expect(isInternalMember('&ampersand')).toBe(false)
      expect(isInternalMember('*asterisk')).toBe(false)
    })

    it('handles method names with only special characters', () => {
      expect(isInternalMember('#')).toBe(true) // starts with #
      expect(isInternalMember('_')).toBe(true) // starts with _
      expect(isInternalMember('$')).toBe(true) // in INTERNAL_PROPERTIES
      expect(isInternalMember('@')).toBe(false)
      expect(isInternalMember('!')).toBe(false)
    })
  })

  describe('Case sensitivity', () => {
    it('is case-sensitive for internal methods', () => {
      // 'fetch' is internal, but 'Fetch' is not
      expect(isInternalMember('fetch')).toBe(true)
      expect(isInternalMember('Fetch')).toBe(false)
      expect(isInternalMember('FETCH')).toBe(false)
      expect(isInternalMember('fETCH')).toBe(false)

      // 'alarm' is internal, but 'Alarm' is not
      expect(isInternalMember('alarm')).toBe(true)
      expect(isInternalMember('Alarm')).toBe(false)
      expect(isInternalMember('ALARM')).toBe(false)
    })

    it('is case-sensitive for underscore prefix (underscore check is case-independent)', () => {
      // Underscore prefix check works regardless of case
      expect(isInternalMember('_Private')).toBe(true)
      expect(isInternalMember('_PRIVATE')).toBe(true)
      expect(isInternalMember('_private')).toBe(true)
    })
  })

  describe('Unicode and international characters', () => {
    it('handles unicode method names', () => {
      expect(isInternalMember('\u0066etch')).toBe(true) // 'fetch' via unicode
      expect(isInternalMember('greet\u0041')).toBe(false) // 'greetA'
    })

    it('handles emoji in method names', () => {
      // Emoji don't start with _ or # so they're allowed
      expect(isInternalMember('hello')).toBe(false)
    })

    it('handles non-ASCII method names', () => {
      expect(isInternalMember('obtenir')).toBe(false) // French
      expect(isInternalMember('holen')).toBe(false) // German
    })
  })

  describe('Numeric strings', () => {
    it('allows purely numeric method names', () => {
      expect(isInternalMember('123')).toBe(false)
      expect(isInternalMember('0')).toBe(false)
      expect(isInternalMember('999')).toBe(false)
    })

    it('blocks underscore-prefixed numeric names', () => {
      expect(isInternalMember('_123')).toBe(true)
      expect(isInternalMember('_0')).toBe(true)
    })
  })

  describe('Long strings', () => {
    it('handles very long method names', () => {
      const longName = 'a'.repeat(1000)
      expect(isInternalMember(longName)).toBe(false)

      const longUnderscoreName = '_' + 'a'.repeat(1000)
      expect(isInternalMember(longUnderscoreName)).toBe(true)
    })
  })

  describe('Method names similar to internal methods', () => {
    it('allows names that are substrings of internal methods', () => {
      expect(isInternalMember('fetc')).toBe(false) // substring of 'fetch'
      expect(isInternalMember('alar')).toBe(false) // substring of 'alarm'
      expect(isInternalMember('initialize')).toBe(true) // exact match
      expect(isInternalMember('initial')).toBe(false) // substring
      expect(isInternalMember('init')).toBe(false) // common abbreviation
    })

    it('allows names that contain internal methods as substrings', () => {
      expect(isInternalMember('preFetch')).toBe(false) // contains 'fetch'
      expect(isInternalMember('setAlarm')).toBe(false) // contains 'alarm'
      expect(isInternalMember('reinitialize')).toBe(false) // contains 'initialize'
    })
  })
})

// ============================================================================
// 9. COMPREHENSIVE INTERNAL_METHODS VERIFICATION
// ============================================================================

describe('isInternalMember - Complete INTERNAL_METHODS Coverage', () => {
  it('blocks all methods from INTERNAL_METHODS set', () => {
    const allInternalMethods = [
      // DurableObject lifecycle methods
      'fetch',
      'alarm',
      'webSocketMessage',
      'webSocketClose',
      'webSocketError',

      // DO initialization and state
      'initialize',
      'handleFetch',
      'handleMcp',
      'handleSyncWebSocket',
      'handleIntrospectRoute',

      // Database and storage
      'db',
      'ctx',
      'storage',
      'env',

      // Constructor
      'constructor',

      // Object prototype methods
      'toString',
      'toLocaleString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      '__defineGetter__',
      '__defineSetter__',
      '__lookupGetter__',
      '__lookupSetter__',
      '__proto__',

      // Internal workflow methods
      'send',
      'try',
      'do',
      'createWorkflowContext',
      'createOnProxy',
      'createScheduleBuilder',
      'createDomainProxy',

      // Action logging
      'logAction',
      'updateActionStatus',
      'updateActionAttempts',
      'completeAction',
      'failAction',
      'executeAction',

      // Event handling
      'emitEvent',
      'emit',
      'emitSystemError',
      'dispatchEventToHandlers',

      // Cross-DO internals
      'invokeDomainMethod',
      'invokeCrossDOMethod',
      'fetchWithCrossDOTimeout',
      'checkCircuitBreaker',
      'recordCircuitBreakerSuccess',
      'recordCircuitBreakerFailure',

      // Resolution
      'resolve',
      'resolveLocal',
      'resolveCrossDO',
      'resolveNounToFK',
      'registerNoun',

      // Visibility
      'canViewThing',
      'assertCanView',
      'filterVisibleThings',
      'getVisibleThing',
      'getVisibility',
      'isOwner',
      'isInThingOrg',
      'setActorContext',
      'getActorContext',
      'clearActorContext',
      'determineRole',

      // Store context
      'getStoreContext',

      // JWT verification
      'verifyJwtSignature',
      'base64UrlDecode',

      // Introspection helpers
      'introspectClasses',
      'introspectStores',
      'introspectStorage',
      'introspectNouns',
      'introspectVerbs',

      // Utility methods
      'log',
      'sleep',
      'calculateBackoffDelay',
      'generateStepId',
      'persistStepResult',
      'loadPersistedSteps',
    ]

    for (const method of allInternalMethods) {
      expect(isInternalMember(method)).toBe(true)
    }
  })
})

// ============================================================================
// 10. COMPREHENSIVE INTERNAL_PROPERTIES VERIFICATION
// ============================================================================

describe('isInternalMember - Complete INTERNAL_PROPERTIES Coverage', () => {
  it('blocks all properties from INTERNAL_PROPERTIES set', () => {
    const allInternalProperties = [
      // Internal state (these start with _ so double-covered)
      '_mcpSessions',
      '_mcpHandler',
      '_rpcServer',
      '_syncEngine',
      '_currentActor',
      '_things',
      '_rels',
      '_actions',
      '_events',
      '_search',
      '_objects',
      '_dlq',
      '_typeCache',
      '_eventHandlers',
      '_handlerCounter',
      '_scheduleHandlers',
      '_scheduleManager',
      '_stepCache',
      '_currentActorContext',

      // Static circuit breaker
      '_circuitBreakers',

      // WorkflowContext ($) - expose via methods instead
      '$',

      // Protected properties
      'app',
      'parent',
      'currentBranch',
    ]

    for (const prop of allInternalProperties) {
      expect(isInternalMember(prop)).toBe(true)
    }
  })
})
