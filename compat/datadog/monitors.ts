/**
 * @dotdo/datadog - Monitors & Dashboards Module
 *
 * Datadog-compatible monitors and dashboards API.
 *
 * @module @dotdo/datadog/monitors
 */

import type {
  Dashboard,
  DashboardWidget,
  Monitor,
  MonitorType,
  MonitorState,
  MonitorOptions,
  MonitorThresholds,
  ServiceDefinition,
  DatadogConfig,
  DatadogResponse,
} from './types.js'

// =============================================================================
// Monitor Builder
// =============================================================================

/**
 * Fluent builder for creating monitors.
 */
export class MonitorBuilder {
  private monitor: Partial<Monitor> = {}

  /**
   * Set the monitor name.
   */
  name(name: string): MonitorBuilder {
    this.monitor.name = name
    return this
  }

  /**
   * Set the monitor type.
   */
  type(type: MonitorType): MonitorBuilder {
    this.monitor.type = type
    return this
  }

  /**
   * Set the query.
   */
  query(query: string): MonitorBuilder {
    this.monitor.query = query
    return this
  }

  /**
   * Set the message.
   */
  message(message: string): MonitorBuilder {
    this.monitor.message = message
    return this
  }

  /**
   * Set tags.
   */
  tags(tags: string[]): MonitorBuilder {
    this.monitor.tags = tags
    return this
  }

  /**
   * Add a tag.
   */
  addTag(tag: string): MonitorBuilder {
    this.monitor.tags = [...(this.monitor.tags ?? []), tag]
    return this
  }

  /**
   * Set priority (1-5).
   */
  priority(priority: 1 | 2 | 3 | 4 | 5): MonitorBuilder {
    this.monitor.priority = priority
    return this
  }

  /**
   * Set options.
   */
  options(options: MonitorOptions): MonitorBuilder {
    this.monitor.options = options
    return this
  }

  /**
   * Set thresholds.
   */
  thresholds(thresholds: MonitorThresholds): MonitorBuilder {
    this.monitor.options = {
      ...this.monitor.options,
      thresholds,
    }
    return this
  }

  /**
   * Set critical threshold.
   */
  critical(value: number): MonitorBuilder {
    this.monitor.options = {
      ...this.monitor.options,
      thresholds: {
        ...this.monitor.options?.thresholds,
        critical: value,
      },
    }
    return this
  }

  /**
   * Set warning threshold.
   */
  warning(value: number): MonitorBuilder {
    this.monitor.options = {
      ...this.monitor.options,
      thresholds: {
        ...this.monitor.options?.thresholds,
        warning: value,
      },
    }
    return this
  }

  /**
   * Enable notify on no data.
   */
  notifyNoData(timeframe?: number): MonitorBuilder {
    this.monitor.options = {
      ...this.monitor.options,
      notify_no_data: true,
      no_data_timeframe: timeframe,
    }
    return this
  }

  /**
   * Set renotify interval.
   */
  renotifyInterval(minutes: number): MonitorBuilder {
    this.monitor.options = {
      ...this.monitor.options,
      renotify_interval: minutes,
    }
    return this
  }

  /**
   * Set escalation message.
   */
  escalationMessage(message: string): MonitorBuilder {
    this.monitor.options = {
      ...this.monitor.options,
      escalation_message: message,
    }
    return this
  }

  /**
   * Set evaluation delay.
   */
  evaluationDelay(seconds: number): MonitorBuilder {
    this.monitor.options = {
      ...this.monitor.options,
      evaluation_delay: seconds,
    }
    return this
  }

  /**
   * Build the monitor.
   */
  build(): Monitor {
    if (!this.monitor.name) {
      throw new Error('Monitor name is required')
    }
    if (!this.monitor.type) {
      throw new Error('Monitor type is required')
    }
    if (!this.monitor.query) {
      throw new Error('Monitor query is required')
    }

    return this.monitor as Monitor
  }
}

/**
 * Create a new monitor builder.
 */
export function createMonitor(): MonitorBuilder {
  return new MonitorBuilder()
}

// =============================================================================
// Monitor Presets
// =============================================================================

/**
 * Create a metric alert monitor.
 */
export function metricAlert(
  name: string,
  query: string,
  thresholds: MonitorThresholds
): Monitor {
  return createMonitor()
    .name(name)
    .type('metric alert')
    .query(query)
    .thresholds(thresholds)
    .build()
}

/**
 * Create a log alert monitor.
 */
export function logAlert(
  name: string,
  query: string,
  thresholds: MonitorThresholds
): Monitor {
  return createMonitor()
    .name(name)
    .type('log alert')
    .query(query)
    .thresholds(thresholds)
    .build()
}

/**
 * Create a service check monitor.
 */
export function serviceCheck(
  name: string,
  checkName: string,
  groupByTags?: string[]
): Monitor {
  const query = groupByTags?.length
    ? `"${checkName}".over("*").by(${groupByTags.map(t => `"${t}"`).join(',')}).last(2).count_by_status()`
    : `"${checkName}".over("*").last(2).count_by_status()`

  return createMonitor()
    .name(name)
    .type('service check')
    .query(query)
    .build()
}

/**
 * Create an APM error rate monitor.
 */
export function apmErrorRate(
  name: string,
  service: string,
  threshold: number = 0.05
): Monitor {
  return createMonitor()
    .name(name)
    .type('query alert')
    .query(`sum(last_5m):sum:trace.servlet.request.errors{service:${service}}.as_count() / sum:trace.servlet.request.hits{service:${service}}.as_count() > ${threshold}`)
    .thresholds({ critical: threshold })
    .build()
}

/**
 * Create a latency monitor.
 */
export function latencyMonitor(
  name: string,
  service: string,
  percentile: 50 | 75 | 90 | 95 | 99 = 95,
  thresholdMs: number = 1000
): Monitor {
  return createMonitor()
    .name(name)
    .type('query alert')
    .query(`avg(last_5m):avg:trace.servlet.request{service:${service}} by {resource_name}.as_count() > ${thresholdMs}`)
    .thresholds({ critical: thresholdMs })
    .addTag(`service:${service}`)
    .build()
}

// =============================================================================
// Monitors Client
// =============================================================================

/**
 * Client for managing monitors.
 */
export class MonitorsClient {
  private readonly monitors: Map<number, Monitor> = new Map()
  private nextId = 1

  /**
   * Create a monitor.
   */
  async create(monitor: Monitor): Promise<Monitor> {
    const id = this.nextId++
    const created: Monitor = {
      ...monitor,
      id,
      overall_state: 'No Data',
    }
    this.monitors.set(id, created)
    return created
  }

  /**
   * Get a monitor by ID.
   */
  async get(id: number): Promise<Monitor | null> {
    return this.monitors.get(id) ?? null
  }

  /**
   * Update a monitor.
   */
  async update(id: number, updates: Partial<Monitor>): Promise<Monitor | null> {
    const existing = this.monitors.get(id)
    if (!existing) return null

    const updated = { ...existing, ...updates, id }
    this.monitors.set(id, updated)
    return updated
  }

  /**
   * Delete a monitor.
   */
  async delete(id: number): Promise<boolean> {
    return this.monitors.delete(id)
  }

  /**
   * List all monitors.
   */
  async list(filters?: { tags?: string[]; type?: MonitorType }): Promise<Monitor[]> {
    let monitors = Array.from(this.monitors.values())

    if (filters?.tags?.length) {
      monitors = monitors.filter((m) =>
        filters.tags!.every((tag) => m.tags?.includes(tag))
      )
    }

    if (filters?.type) {
      monitors = monitors.filter((m) => m.type === filters.type)
    }

    return monitors
  }

  /**
   * Get monitor count.
   */
  count(): number {
    return this.monitors.size
  }

  /**
   * Clear all monitors.
   */
  clear(): void {
    this.monitors.clear()
    this.nextId = 1
  }

  /**
   * Mute a monitor.
   */
  async mute(id: number, scope?: string, endTime?: number): Promise<boolean> {
    const monitor = this.monitors.get(id)
    if (!monitor) return false

    // In a real implementation, this would call the Datadog API
    return true
  }

  /**
   * Unmute a monitor.
   */
  async unmute(id: number, scope?: string): Promise<boolean> {
    const monitor = this.monitors.get(id)
    if (!monitor) return false
    return true
  }

  /**
   * Validate a monitor configuration.
   */
  validate(monitor: Partial<Monitor>): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!monitor.name) {
      errors.push('name is required')
    }
    if (!monitor.type) {
      errors.push('type is required')
    }
    if (!monitor.query) {
      errors.push('query is required')
    }
    if (monitor.priority && (monitor.priority < 1 || monitor.priority > 5)) {
      errors.push('priority must be between 1 and 5')
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}

// =============================================================================
// Dashboard Builder
// =============================================================================

/**
 * Fluent builder for creating dashboards.
 */
export class DashboardBuilder {
  private dashboard: Partial<Dashboard> = {
    layout_type: 'ordered',
    widgets: [],
  }

  /**
   * Set the dashboard title.
   */
  title(title: string): DashboardBuilder {
    this.dashboard.title = title
    return this
  }

  /**
   * Set the description.
   */
  description(description: string): DashboardBuilder {
    this.dashboard.description = description
    return this
  }

  /**
   * Set layout type.
   */
  layoutType(type: 'ordered' | 'free'): DashboardBuilder {
    this.dashboard.layout_type = type
    return this
  }

  /**
   * Add a widget.
   */
  addWidget(widget: DashboardWidget): DashboardBuilder {
    this.dashboard.widgets!.push(widget)
    return this
  }

  /**
   * Add a timeseries widget.
   */
  addTimeseries(title: string, query: string): DashboardBuilder {
    return this.addWidget({
      definition: {
        type: 'timeseries',
        title,
        requests: [{ q: query }],
      },
    })
  }

  /**
   * Add a query value widget.
   */
  addQueryValue(title: string, query: string): DashboardBuilder {
    return this.addWidget({
      definition: {
        type: 'query_value',
        title,
        requests: [{ q: query }],
      },
    })
  }

  /**
   * Add a log stream widget.
   */
  addLogStream(title: string, query: string): DashboardBuilder {
    return this.addWidget({
      definition: {
        type: 'log_stream',
        title,
        query,
        indexes: [],
      },
    })
  }

  /**
   * Add a toplist widget.
   */
  addToplist(title: string, query: string): DashboardBuilder {
    return this.addWidget({
      definition: {
        type: 'toplist',
        title,
        requests: [{ q: query }],
      },
    })
  }

  /**
   * Add template variables.
   */
  addTemplateVariable(name: string, prefix?: string, defaultValue?: string): DashboardBuilder {
    if (!this.dashboard.template_variables) {
      this.dashboard.template_variables = []
    }
    this.dashboard.template_variables.push({
      name,
      prefix,
      default: defaultValue,
    })
    return this
  }

  /**
   * Set read-only flag.
   */
  readOnly(isReadOnly: boolean = true): DashboardBuilder {
    this.dashboard.is_read_only = isReadOnly
    return this
  }

  /**
   * Build the dashboard.
   */
  build(): Dashboard {
    if (!this.dashboard.title) {
      throw new Error('Dashboard title is required')
    }

    return this.dashboard as Dashboard
  }
}

/**
 * Create a new dashboard builder.
 */
export function createDashboard(): DashboardBuilder {
  return new DashboardBuilder()
}

// =============================================================================
// Dashboards Client
// =============================================================================

/**
 * Client for managing dashboards.
 */
export class DashboardsClient {
  private readonly dashboards: Map<string, Dashboard> = new Map()
  private nextId = 1

  /**
   * Create a dashboard.
   */
  async create(dashboard: Dashboard): Promise<Dashboard> {
    const id = `dash-${this.nextId++}`
    const created: Dashboard = { ...dashboard, id }
    this.dashboards.set(id, created)
    return created
  }

  /**
   * Get a dashboard by ID.
   */
  async get(id: string): Promise<Dashboard | null> {
    return this.dashboards.get(id) ?? null
  }

  /**
   * Update a dashboard.
   */
  async update(id: string, updates: Partial<Dashboard>): Promise<Dashboard | null> {
    const existing = this.dashboards.get(id)
    if (!existing) return null

    const updated = { ...existing, ...updates, id }
    this.dashboards.set(id, updated)
    return updated
  }

  /**
   * Delete a dashboard.
   */
  async delete(id: string): Promise<boolean> {
    return this.dashboards.delete(id)
  }

  /**
   * List all dashboards.
   */
  async list(): Promise<Dashboard[]> {
    return Array.from(this.dashboards.values())
  }

  /**
   * Get dashboard count.
   */
  count(): number {
    return this.dashboards.size
  }

  /**
   * Clear all dashboards.
   */
  clear(): void {
    this.dashboards.clear()
    this.nextId = 1
  }
}

// =============================================================================
// Service Catalog Client
// =============================================================================

/**
 * Client for managing service definitions.
 */
export class ServiceCatalogClient {
  private readonly services: Map<string, ServiceDefinition> = new Map()

  /**
   * Register a service.
   */
  async register(service: ServiceDefinition): Promise<ServiceDefinition> {
    this.services.set(service['dd-service'], service)
    return service
  }

  /**
   * Get a service by name.
   */
  async get(serviceName: string): Promise<ServiceDefinition | null> {
    return this.services.get(serviceName) ?? null
  }

  /**
   * Update a service.
   */
  async update(
    serviceName: string,
    updates: Partial<ServiceDefinition>
  ): Promise<ServiceDefinition | null> {
    const existing = this.services.get(serviceName)
    if (!existing) return null

    const updated: ServiceDefinition = {
      ...existing,
      ...updates,
      'dd-service': serviceName,
    }
    this.services.set(serviceName, updated)
    return updated
  }

  /**
   * Delete a service.
   */
  async delete(serviceName: string): Promise<boolean> {
    return this.services.delete(serviceName)
  }

  /**
   * List all services.
   */
  async list(filters?: { team?: string; tier?: string }): Promise<ServiceDefinition[]> {
    let services = Array.from(this.services.values())

    if (filters?.team) {
      services = services.filter((s) => s.team === filters.team)
    }

    if (filters?.tier) {
      services = services.filter((s) => s.tier === filters.tier)
    }

    return services
  }

  /**
   * Get service count.
   */
  count(): number {
    return this.services.size
  }

  /**
   * Clear all services.
   */
  clear(): void {
    this.services.clear()
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a monitors client.
 */
export function createMonitorsClient(): MonitorsClient {
  return new MonitorsClient()
}

/**
 * Create a dashboards client.
 */
export function createDashboardsClient(): DashboardsClient {
  return new DashboardsClient()
}

/**
 * Create a service catalog client.
 */
export function createServiceCatalogClient(): ServiceCatalogClient {
  return new ServiceCatalogClient()
}
