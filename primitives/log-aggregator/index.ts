/**
 * LogAggregator - Structured Logging for dotdo
 *
 * A comprehensive structured logging system with:
 * - Multiple log levels (trace, debug, info, warn, error, fatal)
 * - Pluggable transports (console, buffer, HTTP)
 * - Multiple output formats (JSON, text, pretty)
 * - Context propagation and child loggers
 * - Sensitive data redaction
 * - Log sampling
 */

export * from './types.js'

import type {
  LogLevel,
  LogEntry,
  LogContext,
  LogConfig,
  LogTransport,
  LogFormat,
  LogFilter,
  LogQueryResult,
  LogFormatOptions,
  RedactConfig,
  SamplingConfig,
  ConsoleTransportOptions,
  BufferTransportOptions,
  HTTPTransportOptions,
} from './types.js'

import { LOG_LEVEL_VALUES, shouldLog } from './types.js'

// =============================================================================
// LogAggregator
// =============================================================================

export class LogAggregator {
  private config: LogConfig
  private contextManager: ContextManager
  private formatter: LogFormatter
  private redactor?: Redactor
  private sampler?: SamplingFilter

  constructor(config: LogConfig) {
    this.config = { ...config, enabled: config.enabled ?? true }
    this.contextManager = new ContextManager()
    this.formatter = new LogFormatter(config.formatOptions ?? { format: config.format })

    if (config.defaultContext) {
      this.contextManager.set(config.defaultContext)
    }

    if (config.redact) {
      this.redactor = new Redactor(config.redact)
    }

    if (config.sampling) {
      this.sampler = new SamplingFilter(config.sampling)
    }
  }

  trace(message: string, meta?: Record<string, unknown> | Error): void {
    this.log('trace', message, meta)
  }

  debug(message: string, meta?: Record<string, unknown> | Error): void {
    this.log('debug', message, meta)
  }

  info(message: string, meta?: Record<string, unknown> | Error): void {
    this.log('info', message, meta)
  }

  warn(message: string, meta?: Record<string, unknown> | Error): void {
    this.log('warn', message, meta)
  }

  error(message: string, meta?: Record<string, unknown> | Error): void {
    this.log('error', message, meta)
  }

  fatal(message: string, meta?: Record<string, unknown> | Error): void {
    this.log('fatal', message, meta)
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown> | Error): void {
    if (!this.config.enabled) return
    if (!shouldLog(level, this.config.level)) return

    let metadata: Record<string, unknown> | undefined
    let error: Error | undefined

    if (meta instanceof Error) {
      error = meta
    } else if (meta) {
      if (meta.error instanceof Error) {
        error = meta.error
        const { error: _, ...rest } = meta
        metadata = Object.keys(rest).length > 0 ? rest : undefined
      } else {
        metadata = meta
      }
    }

    // Apply redaction
    if (metadata && this.redactor) {
      metadata = this.redactor.redact(metadata) as Record<string, unknown>
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context: this.contextManager.get(),
      metadata,
      error,
      logger: this.config.name,
    }

    // Apply sampling
    if (this.sampler && !this.sampler.shouldSample(entry)) {
      return
    }

    const formatted = this.formatter.format(entry)

    for (const transport of this.config.transports) {
      // Check per-transport level filtering
      if (transport.level && !shouldLog(level, transport.level)) {
        continue
      }
      transport.write(entry, formatted)
    }
  }

  setLevel(level: LogLevel): void {
    this.config.level = level
  }

  addTransport(transport: LogTransport): void {
    this.config.transports.push(transport)
  }

  removeTransport(transport: LogTransport): void {
    const index = this.config.transports.indexOf(transport)
    if (index !== -1) {
      this.config.transports.splice(index, 1)
    }
  }

  async flush(): Promise<void> {
    await Promise.all(
      this.config.transports.map((t) => t.flush?.())
    )
  }

  child(context: LogContext, name?: string): LogAggregator {
    const childName = name
      ? this.config.name
        ? `${this.config.name}:${name}`
        : name
      : this.config.name

    const childLogger = new LogAggregator({
      ...this.config,
      name: childName,
      defaultContext: {
        ...this.config.defaultContext,
        ...context,
      },
    })

    return childLogger
  }

  withContext<T>(context: LogContext, fn: () => T): T {
    return this.contextManager.run(context, fn)
  }

  query(filter: LogFilter): LogQueryResult {
    // Find buffer transports to query
    const bufferTransports = this.config.transports.filter(
      (t): t is BufferTransport => t instanceof BufferTransport
    )

    if (bufferTransports.length === 0) {
      return { entries: [], total: 0, hasMore: false }
    }

    // Collect all entries from buffers
    let allEntries: LogEntry[] = []
    for (const buffer of bufferTransports) {
      allEntries = allEntries.concat(buffer.getEntries())
    }

    // Apply filters
    const filtered = allEntries.filter((entry) => this.matchesFilter(entry, filter))

    return {
      entries: filtered,
      total: filtered.length,
      hasMore: false,
    }
  }

  private matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
    // Handle combined filters
    if (filter.filters && filter.filters.length > 0) {
      if (filter.combine === 'or') {
        return filter.filters.some((f) => this.matchesFilter(entry, f))
      } else {
        // Default to AND
        return filter.filters.every((f) => this.matchesFilter(entry, f))
      }
    }

    // Level filter
    if (filter.level) {
      const levels = Array.isArray(filter.level) ? filter.level : [filter.level]
      if (!levels.includes(entry.level)) {
        return false
      }
    }

    // Pattern filter
    if (filter.pattern) {
      const regex = filter.pattern instanceof RegExp ? filter.pattern : new RegExp(filter.pattern)
      if (!regex.test(entry.message)) {
        return false
      }
    }

    // Time range filter
    if (filter.timeRange) {
      const entryTime = entry.timestamp.getTime()
      if (filter.timeRange.from && entryTime < filter.timeRange.from.getTime()) {
        return false
      }
      if (filter.timeRange.to && entryTime >= filter.timeRange.to.getTime()) {
        return false
      }
    }

    // Field filter
    if (filter.field) {
      const value = this.getNestedValue(entry, filter.field.path)
      if (!this.matchesFieldValue(value, filter.field.value, filter.field.operator ?? 'eq')) {
        return false
      }
    }

    // Logger filter
    if (filter.logger) {
      const loggers = Array.isArray(filter.logger) ? filter.logger : [filter.logger]
      if (!entry.logger || !loggers.includes(entry.logger)) {
        return false
      }
    }

    return true
  }

  private getNestedValue(obj: any, path: string): unknown {
    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current == null) return undefined
      current = current[part]
    }

    return current
  }

  private matchesFieldValue(actual: unknown, expected: unknown, operator: string): boolean {
    switch (operator) {
      case 'eq':
        return actual === expected
      case 'ne':
        return actual !== expected
      case 'contains':
        return typeof actual === 'string' && actual.includes(String(expected))
      case 'startsWith':
        return typeof actual === 'string' && actual.startsWith(String(expected))
      case 'endsWith':
        return typeof actual === 'string' && actual.endsWith(String(expected))
      case 'gt':
        return typeof actual === 'number' && actual > Number(expected)
      case 'gte':
        return typeof actual === 'number' && actual >= Number(expected)
      case 'lt':
        return typeof actual === 'number' && actual < Number(expected)
      case 'lte':
        return typeof actual === 'number' && actual <= Number(expected)
      default:
        return false
    }
  }

  enable(): void {
    this.config.enabled = true
  }

  disable(): void {
    this.config.enabled = false
  }
}

// =============================================================================
// LogFormatter
// =============================================================================

export class LogFormatter {
  private options: LogFormatOptions

  constructor(options: Partial<LogFormatOptions> & { format: LogFormat }) {
    this.options = {
      includeTimestamp: true,
      includeLevel: true,
      includeLogger: true,
      includeContext: true,
      includeMetadata: true,
      ...options,
    }
  }

  format(entry: LogEntry): string {
    switch (this.options.format) {
      case 'json':
        return this.formatJson(entry)
      case 'text':
        return this.formatText(entry)
      case 'pretty':
        return this.formatPretty(entry)
      default:
        return this.formatJson(entry)
    }
  }

  private formatJson(entry: LogEntry): string {
    const obj: Record<string, unknown> = {
      level: entry.level,
      message: entry.message,
      timestamp: entry.timestamp.toISOString(),
    }

    if (entry.logger && this.options.includeLogger) {
      obj.logger = entry.logger
    }

    if (entry.context && this.options.includeContext) {
      Object.assign(obj, entry.context)
    }

    if (entry.metadata && this.options.includeMetadata) {
      Object.assign(obj, entry.metadata)
    }

    if (entry.error) {
      obj.error = {
        message: entry.error.message,
        name: entry.error.name,
        stack: entry.error.stack,
      }
    }

    return JSON.stringify(obj)
  }

  private formatText(entry: LogEntry): string {
    const parts: string[] = []

    if (this.options.includeTimestamp) {
      parts.push(entry.timestamp.toISOString())
    }

    if (this.options.includeLevel) {
      parts.push(entry.level.toUpperCase().padEnd(5))
    }

    if (entry.logger && this.options.includeLogger) {
      parts.push(`[${entry.logger}]`)
    }

    parts.push(entry.message)

    if (entry.metadata && this.options.includeMetadata) {
      const metaStr = Object.entries(entry.metadata)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ')
      if (metaStr) {
        parts.push(metaStr)
      }
    }

    return parts.join(' ')
  }

  private formatPretty(entry: LogEntry): string {
    const colorize = this.options.colorize ?? false
    const levelColors: Record<LogLevel, string> = {
      trace: '\x1b[90m', // Gray
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
      fatal: '\x1b[35m', // Magenta
    }
    const reset = '\x1b[0m'

    const parts: string[] = []

    if (this.options.includeTimestamp) {
      const time = entry.timestamp.toISOString().replace('T', ' ').replace('Z', '')
      parts.push(colorize ? `\x1b[90m${time}${reset}` : time)
    }

    if (this.options.includeLevel) {
      const level = entry.level.toUpperCase().padEnd(5)
      parts.push(colorize ? `${levelColors[entry.level]}${level}${reset}` : level)
    }

    if (entry.logger && this.options.includeLogger) {
      parts.push(colorize ? `\x1b[90m[${entry.logger}]${reset}` : `[${entry.logger}]`)
    }

    parts.push(entry.message)

    if (entry.metadata && this.options.includeMetadata) {
      const metaStr = JSON.stringify(entry.metadata, null, 2)
      parts.push(colorize ? `\x1b[90m${metaStr}${reset}` : metaStr)
    }

    return parts.join(' ')
  }
}

// =============================================================================
// ConsoleTransport
// =============================================================================

export class ConsoleTransport implements LogTransport {
  type = 'console' as const
  name = 'console'
  level?: LogLevel

  private options: ConsoleTransportOptions

  constructor(options: ConsoleTransportOptions = {}) {
    this.options = {
      stderrLevels: options.stderrLevels ?? [],
      ...options,
    }
  }

  write(entry: LogEntry, formatted: string): void {
    if (this.options.stderrLevels?.includes(entry.level)) {
      console.error(formatted)
    } else {
      console.log(formatted)
    }
  }

  flush(): void {
    // No-op for console
  }
}

// =============================================================================
// BufferTransport
// =============================================================================

export class BufferTransport implements LogTransport {
  type = 'buffer' as const
  name = 'buffer'
  level?: LogLevel

  private entries: LogEntry[] = []
  private formatted: string[] = []
  private maxSize: number

  constructor(options: BufferTransportOptions & { level?: LogLevel } = {}) {
    this.maxSize = options.maxSize ?? Infinity
    this.level = options.level
  }

  write(entry: LogEntry, formatted: string): void {
    this.entries.push(entry)
    this.formatted.push(formatted)

    // Enforce max size
    while (this.entries.length > this.maxSize) {
      this.entries.shift()
      this.formatted.shift()
    }
  }

  flush(): void {
    this.entries = []
    this.formatted = []
  }

  getEntries(): LogEntry[] {
    return [...this.entries]
  }

  getFormatted(): string[] {
    return [...this.formatted]
  }
}

// =============================================================================
// HTTPTransport
// =============================================================================

export class HTTPTransport implements LogTransport {
  type = 'http' as const
  name = 'http'
  level?: LogLevel

  private options: HTTPTransportOptions
  private batch: string[] = []
  private batchTimeout?: ReturnType<typeof setTimeout>

  constructor(options: HTTPTransportOptions) {
    this.options = {
      method: 'POST',
      batchSize: 10,
      batchTimeout: 5000,
      ...options,
    }
  }

  async write(entry: LogEntry, formatted: string): Promise<void> {
    this.batch.push(formatted)

    if (this.batch.length >= (this.options.batchSize ?? 10)) {
      await this.sendBatch()
    } else if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        this.sendBatch()
      }, this.options.batchTimeout)
    }
  }

  async flush(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = undefined
    }
    if (this.batch.length > 0) {
      await this.sendBatch()
    }
  }

  private async sendBatch(): Promise<void> {
    if (this.batch.length === 0) return

    const toSend = [...this.batch]
    this.batch = []

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = undefined
    }

    const body = JSON.stringify(toSend)

    await fetch(this.options.url, {
      method: this.options.method,
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body,
    })
  }

  close(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout)
    }
  }
}

// =============================================================================
// ContextManager
// =============================================================================

export class ContextManager {
  private context: LogContext = {}

  set(context: LogContext): void {
    this.context = { ...context }
  }

  get(): LogContext | undefined {
    return Object.keys(this.context).length > 0 ? { ...this.context } : undefined
  }

  run<T>(context: LogContext, fn: () => T): T {
    const previous = this.context
    this.context = { ...this.context, ...context }
    try {
      return fn()
    } finally {
      this.context = previous
    }
  }

  merge(context: LogContext): LogContext {
    return { ...this.context, ...context }
  }

  clear(): void {
    this.context = {}
  }
}

// =============================================================================
// Redactor
// =============================================================================

export class Redactor {
  private config: RedactConfig

  constructor(config: RedactConfig) {
    this.config = {
      replacement: '[REDACTED]',
      ...config,
    }
  }

  redact<T>(data: T): T {
    if (data == null || typeof data !== 'object') {
      return data
    }

    return this.redactObject(data as Record<string, unknown>, []) as T
  }

  private redactObject(obj: Record<string, unknown>, path: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = [...path, key]
      const pathStr = currentPath.join('.')

      if (this.shouldRedact(pathStr, key)) {
        result[key] = this.config.redactor
          ? this.config.redactor(value, pathStr)
          : this.config.replacement
      } else if (value != null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.redactObject(value as Record<string, unknown>, currentPath)
      } else if (Array.isArray(value)) {
        result[key] = value.map((item, i) => {
          if (item != null && typeof item === 'object') {
            return this.redactObject(item as Record<string, unknown>, [...currentPath, String(i)])
          }
          return item
        })
      } else {
        result[key] = value
      }
    }

    return result
  }

  private shouldRedact(path: string, key: string): boolean {
    for (const pattern of this.config.paths) {
      if (this.matchesPattern(path, key, pattern)) {
        return true
      }
    }
    return false
  }

  private matchesPattern(path: string, key: string, pattern: string): boolean {
    // Exact match
    if (pattern === path || pattern === key) {
      return true
    }

    // Wildcard patterns
    if (pattern.startsWith('**.')) {
      // Match any depth
      const field = pattern.slice(3)
      return key === field
    }

    if (pattern.startsWith('*.')) {
      // Match one level
      const field = pattern.slice(2)
      const parts = path.split('.')
      return parts.length === 2 && key === field
    }

    // Dot notation exact match
    return path === pattern
  }
}

// =============================================================================
// SamplingFilter
// =============================================================================

export class SamplingFilter {
  private config: SamplingConfig

  constructor(config: SamplingConfig) {
    this.config = config
  }

  shouldSample(entry: LogEntry): boolean {
    // Always sample specified levels
    if (this.config.alwaysSample?.includes(entry.level)) {
      return true
    }

    // Sample by key for consistency
    if (this.config.sampleBy && entry.context) {
      const key = entry.context[this.config.sampleBy]
      if (key != null) {
        return this.hashSample(String(key))
      }
    }

    // Random sampling
    return Math.random() < this.config.rate
  }

  private hashSample(key: string): boolean {
    // Simple hash-based sampling for consistency
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    // Normalize to 0-1 range
    const normalized = (Math.abs(hash) % 1000) / 1000
    return normalized < this.config.rate
  }
}
