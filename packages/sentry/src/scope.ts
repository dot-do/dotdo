/**
 * @dotdo/sentry - Scope Implementation
 *
 * Scope holds contextual information for events.
 *
 * @module @dotdo/sentry/scope
 */

import type {
  ScopeInterface,
  SentryEvent,
  User,
  Tags,
  Extras,
  Context,
  SeverityLevel,
  Breadcrumb,
} from './types.js'

const DEFAULT_MAX_BREADCRUMBS = 100

/**
 * Scope implementation for managing contextual data.
 */
export class Scope implements ScopeInterface {
  private _user: User | null = null
  private _tags: Tags = {}
  private _extras: Extras = {}
  private _contexts: Record<string, Context> = {}
  private _level: SeverityLevel | undefined
  private _transactionName: string | undefined
  private _breadcrumbs: Breadcrumb[] = []
  private _fingerprint: string[] | undefined
  private _maxBreadcrumbs: number

  constructor(maxBreadcrumbs: number = DEFAULT_MAX_BREADCRUMBS) {
    this._maxBreadcrumbs = maxBreadcrumbs
  }

  setUser(user: User | null): Scope {
    this._user = user
    return this
  }

  getUser(): User | null {
    return this._user
  }

  setTag(key: string, value: string): Scope {
    this._tags[key] = value
    return this
  }

  setTags(tags: Tags): Scope {
    this._tags = { ...this._tags, ...tags }
    return this
  }

  getTags(): Tags {
    return { ...this._tags }
  }

  setExtra(key: string, value: unknown): Scope {
    this._extras[key] = value
    return this
  }

  setExtras(extras: Extras): Scope {
    this._extras = { ...this._extras, ...extras }
    return this
  }

  getExtras(): Extras {
    return { ...this._extras }
  }

  setContext(name: string, context: Context | null): Scope {
    if (context === null) {
      delete this._contexts[name]
    } else {
      this._contexts[name] = context
    }
    return this
  }

  getContext(name: string): Context | undefined {
    return this._contexts[name]
  }

  getContexts(): Record<string, Context> {
    return { ...this._contexts }
  }

  setLevel(level: SeverityLevel): Scope {
    this._level = level
    return this
  }

  getLevel(): SeverityLevel | undefined {
    return this._level
  }

  setTransactionName(name: string): Scope {
    this._transactionName = name
    return this
  }

  getTransactionName(): string | undefined {
    return this._transactionName
  }

  addBreadcrumb(breadcrumb: Breadcrumb, maxBreadcrumbs?: number): Scope {
    const max = maxBreadcrumbs ?? this._maxBreadcrumbs
    const enriched = {
      ...breadcrumb,
      timestamp: breadcrumb.timestamp ?? Date.now() / 1000,
    }

    this._breadcrumbs.push(enriched)

    if (this._breadcrumbs.length > max) {
      this._breadcrumbs = this._breadcrumbs.slice(-max)
    }

    return this
  }

  getBreadcrumbs(): Breadcrumb[] {
    return [...this._breadcrumbs]
  }

  clearBreadcrumbs(): Scope {
    this._breadcrumbs = []
    return this
  }

  setFingerprint(fingerprint: string[]): Scope {
    this._fingerprint = fingerprint
    return this
  }

  getFingerprint(): string[] | undefined {
    return this._fingerprint
  }

  clear(): Scope {
    this._user = null
    this._tags = {}
    this._extras = {}
    this._contexts = {}
    this._level = undefined
    this._transactionName = undefined
    this._breadcrumbs = []
    this._fingerprint = undefined
    return this
  }

  clone(): Scope {
    const newScope = new Scope(this._maxBreadcrumbs)
    newScope._user = this._user ? { ...this._user } : null
    newScope._tags = { ...this._tags }
    newScope._extras = { ...this._extras }
    newScope._contexts = Object.fromEntries(
      Object.entries(this._contexts).map(([k, v]) => [k, { ...v }])
    )
    newScope._level = this._level
    newScope._transactionName = this._transactionName
    newScope._breadcrumbs = this._breadcrumbs.map((b) => ({ ...b }))
    newScope._fingerprint = this._fingerprint ? [...this._fingerprint] : undefined
    return newScope
  }

  applyToEvent(event: SentryEvent): SentryEvent {
    const applied = { ...event }

    if (this._user) {
      applied.user = { ...this._user, ...applied.user }
    }

    if (Object.keys(this._tags).length > 0) {
      applied.tags = { ...this._tags, ...applied.tags }
    }

    if (Object.keys(this._extras).length > 0) {
      applied.extra = { ...this._extras, ...applied.extra }
    }

    if (Object.keys(this._contexts).length > 0) {
      applied.contexts = { ...this._contexts, ...applied.contexts }
    }

    if (this._level && !applied.level) {
      applied.level = this._level
    }

    if (this._transactionName && !applied.transaction) {
      applied.transaction = this._transactionName
    }

    if (this._breadcrumbs.length > 0) {
      applied.breadcrumbs = [...this._breadcrumbs, ...(applied.breadcrumbs || [])]
    }

    if (this._fingerprint && !applied.fingerprint) {
      applied.fingerprint = [...this._fingerprint]
    }

    return applied
  }
}
