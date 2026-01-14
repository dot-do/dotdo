/**
 * Tests for Progress Reporting and Shallow Operations
 *
 * @module bashx/remote/progress.test
 */

import { describe, it, expect, vi } from 'vitest'
import {
  type ProgressEvent,
  type ProgressOptions,
  createProgressEvent,
  emitPhase,
  emitProgress,
  emitComplete,
  EventProgressReporter,
  NoopProgressReporter,
} from './progress.js'
import { clone } from './clone.js'
import { fetch } from './fetch.js'
import { push } from './push.js'

// =============================================================================
// Progress Module Tests
// =============================================================================

describe('Progress Module', () => {
  describe('createProgressEvent', () => {
    it('creates event with phase, current, and total', () => {
      const event = createProgressEvent('receiving', 50, 100)

      expect(event.phase).toBe('receiving')
      expect(event.current).toBe(50)
      expect(event.total).toBe(100)
      expect(event.percent).toBe(50)
    })

    it('calculates percentage correctly', () => {
      expect(createProgressEvent('counting', 25, 100).percent).toBe(25)
      expect(createProgressEvent('counting', 1, 3).percent).toBe(33)
      expect(createProgressEvent('counting', 100, 100).percent).toBe(100)
    })

    it('handles zero total', () => {
      const event = createProgressEvent('connecting', 0, 0)
      expect(event.percent).toBeUndefined()
    })

    it('includes optional bytes and message', () => {
      const event = createProgressEvent('receiving', 50, 100, {
        bytes: 1024,
        totalBytes: 2048,
        message: 'Receiving objects',
      })

      expect(event.bytes).toBe(1024)
      expect(event.totalBytes).toBe(2048)
      expect(event.message).toBe('Receiving objects')
    })
  })

  describe('emitPhase', () => {
    it('emits phase through onProgress callback', () => {
      const callback = vi.fn()
      const options: ProgressOptions = { onProgress: callback }

      emitPhase(options, 'connecting', 'Starting connection')

      expect(callback).toHaveBeenCalledOnce()
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'connecting',
          message: 'Starting connection',
        })
      )
    })

    it('emits phase through reporter', () => {
      const reporter = new EventProgressReporter()
      const options: ProgressOptions = { reporter }

      emitPhase(options, 'resolving')

      const events = reporter.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0].phase).toBe('resolving')
    })

    it('does nothing when quiet is true', () => {
      const callback = vi.fn()
      const options: ProgressOptions = { onProgress: callback, quiet: true }

      emitPhase(options, 'connecting')

      expect(callback).not.toHaveBeenCalled()
    })

    it('does nothing when options is undefined', () => {
      // Should not throw
      expect(() => emitPhase(undefined, 'connecting')).not.toThrow()
    })
  })

  describe('emitProgress', () => {
    it('emits progress event through callback', () => {
      const callback = vi.fn()
      const options: ProgressOptions = { onProgress: callback }
      const event = createProgressEvent('receiving', 50, 100)

      emitProgress(options, event)

      expect(callback).toHaveBeenCalledWith(event)
    })

    it('emits progress through reporter', () => {
      const reporter = new EventProgressReporter()
      const options: ProgressOptions = { reporter }
      const event = createProgressEvent('receiving', 50, 100, { message: 'test' })

      emitProgress(options, event)

      expect(reporter.getEvents()).toHaveLength(1)
    })
  })

  describe('emitComplete', () => {
    it('emits done phase through callback', () => {
      const callback = vi.fn()
      const options: ProgressOptions = { onProgress: callback }

      emitComplete(options)

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'done' })
      )
    })

    it('calls reporter.onComplete', () => {
      const reporter = new EventProgressReporter()
      const options: ProgressOptions = { reporter }

      emitComplete(options)

      const events = reporter.getEvents()
      expect(events[events.length - 1].phase).toBe('done')
    })
  })

  describe('EventProgressReporter', () => {
    it('records all events', () => {
      const reporter = new EventProgressReporter()

      reporter.onPhase('connecting')
      reporter.onProgress(10, 100, 'counting')
      reporter.onBytes(1024, 2048)
      reporter.onComplete()

      const events = reporter.getEvents()
      expect(events).toHaveLength(4)
    })

    it('notifies listeners of events', () => {
      const reporter = new EventProgressReporter()
      const listener = vi.fn()

      reporter.addListener(listener)
      reporter.onPhase('receiving')

      expect(listener).toHaveBeenCalledOnce()
    })

    it('allows removing listeners', () => {
      const reporter = new EventProgressReporter()
      const listener = vi.fn()

      reporter.addListener(listener)
      reporter.removeListener(listener)
      reporter.onPhase('receiving')

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('NoopProgressReporter', () => {
    it('does nothing on all operations', () => {
      const reporter = new NoopProgressReporter()

      // Should not throw
      expect(() => {
        reporter.onPhase('connecting')
        reporter.onProgress(10, 100)
        reporter.onBytes(1024)
        reporter.onComplete()
        reporter.onError(new Error('test'))
      }).not.toThrow()
    })
  })
})

// =============================================================================
// Clone Progress Tests
// =============================================================================

describe('Clone Progress Reporting', () => {
  function createMockHttpClient() {
    return {
      infoRefs: new Map<string, { refs: Map<string, string>; capabilities: string[] }>(),
      packData: new Map<string, Uint8Array>(),
      receivePack: new Map<string, { ok: boolean; error?: string }>(),
      requests: [] as Array<{ url: string; method: string; headers: Record<string, string>; body?: Uint8Array }>,
      authRequired: new Set<string>(),
      protectedBranches: new Map<string, Set<string>>(),
      packIndexCache: new Map<string, Array<{ sha: string; offset: number; size: number }>>(),
      etagCache: new Map<string, string>(),
    }
  }

  function createMockRepo() {
    return {
      objects: new Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>(),
      refs: new Map<string, string>(),
      head: { symbolic: true, target: 'refs/heads/main' },
      remotes: new Map<string, { url: string; fetch: string }>(),
      config: new Map<string, string>(),
      workingTree: new Map<string, Uint8Array>(),
      index: new Map<string, { sha: string; mode: number }>(),
    }
  }

  it('calls progress callback during clone', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: ['shallow', 'side-band-64k'],
    })

    const progressEvents: ProgressEvent[] = []

    const result = await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
      onProgress: (event) => progressEvents.push(event),
    })

    expect(result.exitCode).toBe(0)
    expect(progressEvents.length).toBeGreaterThan(0)

    // Check that we got connecting phase
    expect(progressEvents.some(e => e.phase === 'connecting')).toBe(true)
  })

  it('reports objects received in result', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: ['shallow'],
    })

    const result = await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
    })

    expect(result.exitCode).toBe(0)
    expect(result.objectsReceived).toBeDefined()
    expect(result.bytesReceived).toBeDefined()
  })
})

// =============================================================================
// Shallow Clone Tests
// =============================================================================

describe('Shallow Clone Operations', () => {
  function createMockHttpClient() {
    return {
      infoRefs: new Map<string, { refs: Map<string, string>; capabilities: string[] }>(),
      packData: new Map<string, Uint8Array>(),
      receivePack: new Map<string, { ok: boolean; error?: string }>(),
      requests: [] as Array<{ url: string; method: string; headers: Record<string, string>; body?: Uint8Array }>,
      authRequired: new Set<string>(),
      protectedBranches: new Map<string, Set<string>>(),
      packIndexCache: new Map<string, Array<{ sha: string; offset: number; size: number }>>(),
      etagCache: new Map<string, string>(),
    }
  }

  function createMockRepo() {
    return {
      objects: new Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>(),
      refs: new Map<string, string>(),
      head: { symbolic: true, target: 'refs/heads/main' },
      remotes: new Map<string, { url: string; fetch: string }>(),
      config: new Map<string, string>(),
      workingTree: new Map<string, Uint8Array>(),
      index: new Map<string, { sha: string; mode: number }>(),
      shallowRoots: new Set<string>(),
    }
  }

  it('supports --depth option', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: ['shallow', 'deepen-since', 'deepen-not'],
    })

    const result = await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
      depth: 1,
    })

    expect(result.exitCode).toBe(0)
    expect(result.isShallow).toBe(true)
    expect(result.shallowDepth).toBe(1)

    // Check that shallow config was set
    expect(localRepo.config.get('shallow')).toBe('true')
    expect(localRepo.config.get('shallow.depth')).toBe('1')
  })

  it('supports shallow.depth option', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: ['shallow'],
    })

    const result = await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
      shallow: { depth: 5 },
    })

    expect(result.exitCode).toBe(0)
    expect(result.isShallow).toBe(true)
    expect(result.shallowDepth).toBe(5)
  })

  it('supports shallow-since option', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: ['shallow', 'deepen-since'],
    })

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const result = await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
      shallow: { shallowSince: oneWeekAgo },
    })

    expect(result.exitCode).toBe(0)
    expect(result.isShallow).toBe(true)

    // Check that deepen-since was sent in request body
    const uploadPackRequest = http.requests.find(r => r.url.includes('git-upload-pack'))
    expect(uploadPackRequest).toBeDefined()
    if (uploadPackRequest?.body) {
      const bodyText = new TextDecoder().decode(uploadPackRequest.body)
      expect(bodyText).toContain('deepen-since')
    }
  })

  it('supports shallow-exclude option', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
        ['refs/tags/v1.0.0', 'tag123def456789012345678901234567890abcd'],
      ]),
      capabilities: ['shallow', 'deepen-not'],
    })

    const result = await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
      shallow: { shallowExclude: ['refs/tags/v1.0.0'] },
    })

    expect(result.exitCode).toBe(0)
    expect(result.isShallow).toBe(true)
  })

  it('falls back to full clone when server does not support shallow', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: [], // No shallow capability
    })

    const result = await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
      depth: 1,
    })

    expect(result.exitCode).toBe(0)
    expect(result.isShallow).toBeFalsy()
  })

  it('supports single-branch clone', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    const mainSha = 'abc123def456789012345678901234567890abcd'
    const devSha = 'dev456def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
        ['refs/heads/develop', devSha],
      ]),
      capabilities: ['shallow'],
    })

    const result = await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
      singleBranch: true,
    })

    expect(result.exitCode).toBe(0)

    // Should only have remote tracking for main branch
    expect(localRepo.refs.has('refs/remotes/origin/main')).toBe(true)
    expect(localRepo.refs.has('refs/remotes/origin/develop')).toBe(false)
  })
})

// =============================================================================
// Fetch Progress Tests
// =============================================================================

describe('Fetch Progress Reporting', () => {
  function createMockHttpClient() {
    return {
      infoRefs: new Map<string, { refs: Map<string, string>; capabilities: string[] }>(),
      packData: new Map<string, Uint8Array>(),
      receivePack: new Map<string, { ok: boolean; error?: string }>(),
      requests: [] as Array<{ url: string; method: string; headers: Record<string, string>; body?: Uint8Array }>,
      authRequired: new Set<string>(),
      protectedBranches: new Map<string, Set<string>>(),
      packIndexCache: new Map<string, Array<{ sha: string; offset: number; size: number }>>(),
      etagCache: new Map<string, string>(),
    }
  }

  function createMockRepo() {
    return {
      objects: new Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>(),
      refs: new Map<string, string>(),
      head: { symbolic: true, target: 'refs/heads/main' },
      remotes: new Map<string, { url: string; fetch: string }>(),
      config: new Map<string, string>(),
      workingTree: new Map<string, Uint8Array>(),
      index: new Map<string, { sha: string; mode: number }>(),
      shallowRoots: new Set<string>(),
    }
  }

  it('reports progress during fetch', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    // Set up remote
    localRepo.remotes.set('origin', {
      url: 'https://github.com/test/repo',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: ['shallow'],
    })

    const progressEvents: ProgressEvent[] = []

    const result = await fetch({
      remote: 'origin',
      http,
      localRepo,
      onProgress: (event) => progressEvents.push(event),
    })

    expect(result.exitCode).toBe(0)
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents.some(e => e.phase === 'connecting')).toBe(true)
  })

  it('uses pack cache for subsequent fetches', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    localRepo.remotes.set('origin', {
      url: 'https://github.com/test/repo',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: ['shallow'],
    })

    // Pre-populate pack cache
    http.packIndexCache.set('https://github.com/test/repo', [
      { sha: mainSha, offset: 0, size: 100 },
    ])

    const result = await fetch({
      remote: 'origin',
      http,
      localRepo,
      usePackCache: true,
    })

    expect(result.exitCode).toBe(0)
    expect(result.cacheHit).toBe(true)
  })

  it('supports shallow fetch with unshallow', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    localRepo.remotes.set('origin', {
      url: 'https://github.com/test/repo',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })

    // Mark repo as shallow
    localRepo.config.set('shallow', 'true')
    const rootSha = 'root123def456789012345678901234567890abcd'
    localRepo.shallowRoots.add(rootSha)

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: ['shallow'],
    })

    const result = await fetch({
      remote: 'origin',
      http,
      localRepo,
      shallow: { unshallow: true },
    })

    expect(result.exitCode).toBe(0)

    // Should have cleared shallow state
    expect(localRepo.shallowRoots.size).toBe(0)
    expect(localRepo.config.has('shallow')).toBe(false)
  })
})

// =============================================================================
// Push Progress Tests
// =============================================================================

describe('Push Progress Reporting', () => {
  function createMockHttpClient() {
    return {
      infoRefs: new Map<string, { refs: Map<string, string>; capabilities: string[] }>(),
      packData: new Map<string, Uint8Array>(),
      receivePack: new Map<string, { ok: boolean; error?: string }>(),
      requests: [] as Array<{ url: string; method: string; headers: Record<string, string>; body?: Uint8Array }>,
      authRequired: new Set<string>(),
      protectedBranches: new Map<string, Set<string>>(),
      packIndexCache: new Map<string, Array<{ sha: string; offset: number; size: number }>>(),
      etagCache: new Map<string, string>(),
    }
  }

  function createMockRepo() {
    return {
      objects: new Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>(),
      refs: new Map<string, string>(),
      head: { symbolic: true, target: 'refs/heads/main' },
      remotes: new Map<string, { url: string; fetch: string }>(),
      config: new Map<string, string>(),
      workingTree: new Map<string, Uint8Array>(),
      index: new Map<string, { sha: string; mode: number }>(),
    }
  }

  it('reports progress during push', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    localRepo.remotes.set('origin', {
      url: 'https://github.com/test/repo',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })

    const localSha = 'local123def456789012345678901234567890abcd'
    localRepo.refs.set('refs/heads/main', localSha)
    localRepo.objects.set(localSha, {
      type: 'commit',
      data: new TextEncoder().encode('commit data'),
    })

    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map(), // Empty remote
      capabilities: [],
    })

    const progressEvents: ProgressEvent[] = []

    const result = await push({
      remote: 'origin',
      http,
      localRepo,
      onProgress: (event) => progressEvents.push(event),
    })

    expect(result.exitCode).toBe(0)
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents.some(e => e.phase === 'connecting')).toBe(true)
    expect(progressEvents.some(e => e.phase === 'compressing')).toBe(true)
  })

  it('reports objects and bytes sent', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    localRepo.remotes.set('origin', {
      url: 'https://github.com/test/repo',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })

    const localSha = 'local123def456789012345678901234567890abcd'
    localRepo.refs.set('refs/heads/main', localSha)
    localRepo.objects.set(localSha, {
      type: 'commit',
      data: new TextEncoder().encode('commit data'),
    })

    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map(),
      capabilities: [],
    })

    const result = await push({
      remote: 'origin',
      http,
      localRepo,
    })

    expect(result.exitCode).toBe(0)
    expect(result.objectsSent).toBeGreaterThan(0)
    expect(result.bytesSent).toBeGreaterThan(0)
  })
})

// =============================================================================
// Connection Reuse Tests
// =============================================================================

describe('Connection Reuse', () => {
  function createMockHttpClient() {
    return {
      infoRefs: new Map<string, { refs: Map<string, string>; capabilities: string[] }>(),
      packData: new Map<string, Uint8Array>(),
      receivePack: new Map<string, { ok: boolean; error?: string }>(),
      requests: [] as Array<{ url: string; method: string; headers: Record<string, string>; body?: Uint8Array }>,
      authRequired: new Set<string>(),
      protectedBranches: new Map<string, Set<string>>(),
    }
  }

  function createMockRepo() {
    return {
      objects: new Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>(),
      refs: new Map<string, string>(),
      head: { symbolic: true, target: 'refs/heads/main' },
      remotes: new Map<string, { url: string; fetch: string }>(),
      config: new Map<string, string>(),
      workingTree: new Map<string, Uint8Array>(),
      index: new Map<string, { sha: string; mode: number }>(),
    }
  }

  it('sends Connection: keep-alive header on clone', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: [],
    })

    await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
    })

    // Check that Connection: keep-alive was sent
    const infoRefsRequest = http.requests.find(r => r.url.includes('info/refs'))
    expect(infoRefsRequest).toBeDefined()
    expect(infoRefsRequest?.headers['Connection']).toBe('keep-alive')
  })

  it('sends Connection: keep-alive header on fetch', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    localRepo.remotes.set('origin', {
      url: 'https://github.com/test/repo',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: [],
    })

    await fetch({
      remote: 'origin',
      http,
      localRepo,
    })

    const infoRefsRequest = http.requests.find(r => r.url.includes('info/refs'))
    expect(infoRefsRequest).toBeDefined()
    expect(infoRefsRequest?.headers['Connection']).toBe('keep-alive')
  })

  it('sends Connection: keep-alive header on push', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    localRepo.remotes.set('origin', {
      url: 'https://github.com/test/repo',
      fetch: '+refs/heads/*:refs/remotes/origin/*',
    })

    const localSha = 'local123def456789012345678901234567890abcd'
    localRepo.refs.set('refs/heads/main', localSha)
    localRepo.objects.set(localSha, {
      type: 'commit',
      data: new TextEncoder().encode('commit'),
    })

    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map(),
      capabilities: [],
    })

    await push({
      remote: 'origin',
      http,
      localRepo,
    })

    const infoRefsRequest = http.requests.find(r => r.url.includes('info/refs'))
    expect(infoRefsRequest).toBeDefined()
    expect(infoRefsRequest?.headers['Connection']).toBe('keep-alive')
  })
})

// =============================================================================
// ETag / Conditional Request Tests
// =============================================================================

describe('Conditional Requests (ETag)', () => {
  function createMockHttpClient() {
    return {
      infoRefs: new Map<string, { refs: Map<string, string>; capabilities: string[] }>(),
      packData: new Map<string, Uint8Array>(),
      receivePack: new Map<string, { ok: boolean; error?: string }>(),
      requests: [] as Array<{ url: string; method: string; headers: Record<string, string>; body?: Uint8Array }>,
      authRequired: new Set<string>(),
      protectedBranches: new Map<string, Set<string>>(),
      etagCache: new Map<string, string>(),
    }
  }

  function createMockRepo() {
    return {
      objects: new Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>(),
      refs: new Map<string, string>(),
      head: { symbolic: true, target: 'refs/heads/main' },
      remotes: new Map<string, { url: string; fetch: string }>(),
      config: new Map<string, string>(),
      workingTree: new Map<string, Uint8Array>(),
      index: new Map<string, { sha: string; mode: number }>(),
    }
  }

  it('sends If-None-Match header when ETag is cached', async () => {
    const http = createMockHttpClient()
    const localRepo = createMockRepo()

    // Pre-cache an ETag
    http.etagCache.set('https://github.com/test/repo', '"abc123"')

    const mainSha = 'abc123def456789012345678901234567890abcd'
    http.infoRefs.set('https://github.com/test/repo', {
      refs: new Map([
        ['HEAD', mainSha],
        ['refs/heads/main', mainSha],
      ]),
      capabilities: [],
    })

    await clone({
      url: 'https://github.com/test/repo',
      directory: '/test/repo',
      http,
      localRepo,
      useConditionalRequests: true,
    })

    const infoRefsRequest = http.requests.find(r => r.url.includes('info/refs'))
    expect(infoRefsRequest).toBeDefined()
    expect(infoRefsRequest?.headers['If-None-Match']).toBe('"abc123"')
  })
})
