/**
 * @dotdo/cubejs/playground - Development Server
 *
 * Cube.js Playground compatibility server that provides:
 * - Schema introspection and live reload
 * - Query playground UI serving
 * - WebSocket for real-time schema updates
 * - Integration with semantic layer
 *
 * @example
 * ```typescript
 * import { createPlaygroundServer } from '@dotdo/compat/cubejs/playground'
 * import { cube, CubeSchema } from '@dotdo/compat/cubejs'
 *
 * const Orders = cube('Orders', {
 *   sql: 'SELECT * FROM orders',
 *   measures: { count: { type: 'count' } },
 *   dimensions: { status: { sql: 'status', type: 'string' } },
 * })
 *
 * const server = createPlaygroundServer({
 *   cubes: [Orders],
 *   schemaPath: './schema',
 *   port: 4000,
 * })
 *
 * export default server
 * ```
 */

import type { CubeSchema } from '../schema'
import type { CubeQuery } from '../query'
import { CubeAPI, type CubeAPIOptions } from '../api'
import { generateSQL } from '../sql'
import { normalizeQuery } from '../query'

// =============================================================================
// Types
// =============================================================================

/**
 * Playground server configuration
 */
export interface PlaygroundServerOptions {
  /**
   * Registered cube schemas
   */
  cubes: CubeSchema[]

  /**
   * Path to schema files for live reload
   */
  schemaPath?: string

  /**
   * Port for playground server
   * @default 4000
   */
  port?: number

  /**
   * API token for authentication
   * @default 'playground_token'
   */
  apiToken?: string

  /**
   * Enable live schema reload
   * @default true
   */
  liveReload?: boolean

  /**
   * Data source function to execute queries
   */
  dataSource?: CubeAPIOptions['dataSource']

  /**
   * Custom HTML template for playground UI
   */
  playgroundHtml?: string

  /**
   * Base path for API routes
   * @default '/cubejs-api/v1'
   */
  basePath?: string
}

/**
 * Schema change event
 */
export interface SchemaChangeEvent {
  type: 'schema-change'
  cubes: CubeMeta[]
  timestamp: string
}

/**
 * Cube metadata for playground
 */
export interface CubeMeta {
  name: string
  title?: string
  description?: string
  measures: MeasureMeta[]
  dimensions: DimensionMeta[]
  segments: SegmentMeta[]
  joins?: JoinMeta[]
  preAggregations?: PreAggregationMeta[]
}

/**
 * Measure metadata
 */
export interface MeasureMeta {
  name: string
  title?: string
  shortTitle?: string
  type: string
  aggType?: string
  format?: string
  drillMembers?: string[]
  description?: string
}

/**
 * Dimension metadata
 */
export interface DimensionMeta {
  name: string
  title?: string
  shortTitle?: string
  type: string
  primaryKey?: boolean
  description?: string
}

/**
 * Segment metadata
 */
export interface SegmentMeta {
  name: string
  title?: string
  shortTitle?: string
  description?: string
}

/**
 * Join metadata
 */
export interface JoinMeta {
  name: string
  relationship: string
}

/**
 * Pre-aggregation metadata
 */
export interface PreAggregationMeta {
  name: string
  type: string
  measures?: string[]
  dimensions?: string[]
  timeDimension?: string
  granularity?: string
}

/**
 * File watcher interface
 */
export interface SchemaWatcher {
  /**
   * Start watching for schema changes
   */
  start(): void

  /**
   * Stop watching
   */
  stop(): void

  /**
   * Add listener for schema changes
   */
  onSchemaChange(callback: (event: SchemaChangeEvent) => void): void
}

// =============================================================================
// Schema Watcher
// =============================================================================

/**
 * Create a schema file watcher for live reload
 */
export function createSchemaWatcher(
  schemaPath: string,
  getCubesMeta: () => CubeMeta[]
): SchemaWatcher {
  const listeners: Array<(event: SchemaChangeEvent) => void> = []
  let intervalId: ReturnType<typeof setInterval> | null = null
  let lastSchemaHash = ''

  return {
    start() {
      // Poll for changes every 1 second
      intervalId = setInterval(() => {
        const currentMeta = getCubesMeta()
        const currentHash = JSON.stringify(currentMeta)

        if (currentHash !== lastSchemaHash) {
          lastSchemaHash = currentHash
          const event: SchemaChangeEvent = {
            type: 'schema-change',
            cubes: currentMeta,
            timestamp: new Date().toISOString(),
          }

          for (const listener of listeners) {
            listener(event)
          }
        }
      }, 1000)
    },

    stop() {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    },

    onSchemaChange(callback) {
      listeners.push(callback)
    },
  }
}

// =============================================================================
// Playground Server
// =============================================================================

/**
 * Playground server instance
 */
export class PlaygroundServer {
  private schemas: Map<string, CubeSchema>
  private options: PlaygroundServerOptions
  private cubeApi: CubeAPI
  private watcher: SchemaWatcher | null = null
  private wsClients: Set<WebSocket> = new Set()

  constructor(options: PlaygroundServerOptions) {
    this.options = {
      port: 4000,
      apiToken: 'playground_token',
      liveReload: true,
      basePath: '/cubejs-api/v1',
      ...options,
    }

    this.schemas = new Map()
    for (const cube of options.cubes) {
      this.schemas.set(cube.name, cube)
    }

    // Create CubeAPI instance
    this.cubeApi = new CubeAPI({
      cubes: options.cubes,
      apiToken: this.options.apiToken!,
      dataSource: options.dataSource,
      basePath: this.options.basePath,
    })

    // Setup live reload watcher
    if (this.options.liveReload && this.options.schemaPath) {
      this.watcher = createSchemaWatcher(
        this.options.schemaPath,
        () => this.getCubesMeta()
      )
    }
  }

  /**
   * Get all cubes metadata
   */
  getCubesMeta(): CubeMeta[] {
    const cubes: CubeMeta[] = []

    for (const [name, schema] of Array.from(this.schemas)) {
      const cubeMeta: CubeMeta = {
        name,
        title: schema.title,
        description: schema.description,
        measures: [],
        dimensions: [],
        segments: [],
        joins: [],
        preAggregations: [],
      }

      // Add measures
      for (const [measureName, measure] of Object.entries(schema.measures)) {
        cubeMeta.measures.push({
          name: `${name}.${measureName}`,
          title: measure.title || this.toTitle(measureName),
          shortTitle: measure.shortTitle || measureName,
          type: this.measureTypeToAnnotationType(measure.type),
          aggType: measure.type,
          format: measure.format,
          drillMembers: measure.drillMembers,
          description: measure.description,
        })
      }

      // Add dimensions
      for (const [dimName, dimension] of Object.entries(schema.dimensions)) {
        cubeMeta.dimensions.push({
          name: `${name}.${dimName}`,
          title: dimension.title || this.toTitle(dimName),
          shortTitle: dimension.shortTitle || dimName,
          type: dimension.type,
          primaryKey: dimension.primaryKey,
          description: dimension.description,
        })
      }

      // Add segments
      if (schema.segments) {
        for (const [segName, segment] of Object.entries(schema.segments)) {
          cubeMeta.segments.push({
            name: `${name}.${segName}`,
            title: segment.title || this.toTitle(segName),
            shortTitle: segName,
            description: segment.description,
          })
        }
      }

      // Add joins
      if (schema.joins) {
        for (const [joinName, join] of Object.entries(schema.joins)) {
          cubeMeta.joins!.push({
            name: joinName,
            relationship: join.relationship,
          })
        }
      }

      // Add pre-aggregations
      if (schema.preAggregations) {
        for (const [preAggName, preAgg] of Object.entries(schema.preAggregations)) {
          cubeMeta.preAggregations!.push({
            name: `${name}.${preAggName}`,
            type: preAgg.type,
            measures: preAgg.measureReferences,
            dimensions: preAgg.dimensionReferences,
            timeDimension: preAgg.timeDimensionReference,
            granularity: preAgg.granularity,
          })
        }
      }

      cubes.push(cubeMeta)
    }

    return cubes
  }

  /**
   * Reload schemas from registered cubes
   */
  reloadSchemas(cubes: CubeSchema[]): void {
    this.schemas.clear()
    for (const cube of cubes) {
      this.schemas.set(cube.name, cube)
    }

    // Recreate CubeAPI with new schemas
    this.cubeApi = new CubeAPI({
      cubes,
      apiToken: this.options.apiToken!,
      dataSource: this.options.dataSource,
      basePath: this.options.basePath,
    })

    // Notify all WebSocket clients
    this.notifySchemaChange()
  }

  /**
   * Start live reload watcher
   */
  startLiveReload(): void {
    if (this.watcher) {
      this.watcher.onSchemaChange((event) => {
        this.notifySchemaChange()
      })
      this.watcher.start()
    }
  }

  /**
   * Stop live reload watcher
   */
  stopLiveReload(): void {
    if (this.watcher) {
      this.watcher.stop()
    }
  }

  /**
   * Notify WebSocket clients of schema change
   */
  private notifySchemaChange(): void {
    const event: SchemaChangeEvent = {
      type: 'schema-change',
      cubes: this.getCubesMeta(),
      timestamp: new Date().toISOString(),
    }

    const message = JSON.stringify(event)

    for (const client of Array.from(this.wsClients)) {
      try {
        client.send(message)
      } catch {
        this.wsClients.delete(client)
      }
    }
  }

  /**
   * Handle incoming HTTP request
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS headers
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // Serve playground UI
    if (path === '/' || path === '/playground') {
      return this.servePlaygroundUI(corsHeaders)
    }

    // WebSocket upgrade for live reload
    if (path === '/ws' || path === '/live-reload') {
      const upgradeHeader = request.headers.get('Upgrade')
      if (upgradeHeader === 'websocket') {
        return this.handleWebSocketUpgrade(request)
      }
      return new Response('Expected websocket', { status: 400, headers: corsHeaders })
    }

    // Schema introspection endpoint
    if (path === '/schema' || path === `${this.options.basePath}/schema`) {
      if (request.method === 'GET') {
        return this.handleSchemaIntrospection(corsHeaders)
      }
    }

    // Delegate to CubeAPI for standard endpoints
    return this.cubeApi.fetch(request)
  }

  /**
   * Serve the playground HTML UI
   */
  private servePlaygroundUI(headers: Record<string, string>): Response {
    const html = this.options.playgroundHtml || this.getDefaultPlaygroundHtml()
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        ...headers,
      },
    })
  }

  /**
   * Handle schema introspection request
   */
  private handleSchemaIntrospection(headers: Record<string, string>): Response {
    const meta = this.getCubesMeta()
    return new Response(JSON.stringify({ cubes: meta }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    })
  }

  /**
   * Handle WebSocket upgrade for live reload
   */
  private handleWebSocketUpgrade(_request: Request): Response {
    // In Workers environment, WebSocket handling is different
    // This is a placeholder that returns an error in non-WebSocket environments
    // The actual WebSocket handling would be done by the runtime
    return new Response('WebSocket upgrade not supported in this context', {
      status: 400,
    })
  }

  /**
   * Register a WebSocket client for live reload
   */
  registerWebSocketClient(ws: WebSocket): void {
    this.wsClients.add(ws)

    // Send initial schema
    const event: SchemaChangeEvent = {
      type: 'schema-change',
      cubes: this.getCubesMeta(),
      timestamp: new Date().toISOString(),
    }
    ws.send(JSON.stringify(event))
  }

  /**
   * Unregister a WebSocket client
   */
  unregisterWebSocketClient(ws: WebSocket): void {
    this.wsClients.delete(ws)
  }

  /**
   * Get the underlying CubeAPI instance
   */
  getApi(): CubeAPI {
    return this.cubeApi
  }

  /**
   * Get default playground HTML
   */
  private getDefaultPlaygroundHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cube.js Playground</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #7928ca 0%, #ff0080 100%);
      color: white;
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 { font-size: 1.5rem; font-weight: 600; }
    .container { display: flex; height: calc(100vh - 60px); }
    .sidebar {
      width: 300px;
      background: white;
      border-right: 1px solid #e1e4e8;
      overflow-y: auto;
      padding: 1rem;
    }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 1rem;
      gap: 1rem;
    }
    .section-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      color: #6c757d;
      margin: 1rem 0 0.5rem;
    }
    .cube-name {
      font-weight: 600;
      color: #333;
      padding: 0.5rem;
      background: #f0f0f0;
      border-radius: 4px;
      margin-bottom: 0.5rem;
    }
    .member-list { list-style: none; }
    .member-item {
      padding: 0.375rem 0.5rem;
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.15s;
    }
    .member-item:hover { background: #f0f0f0; }
    .member-item.selected { background: #e7f0ff; color: #0066cc; }
    .member-type {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
      font-weight: 500;
    }
    .member-type.measure { background: #dcfce7; color: #166534; }
    .member-type.dimension { background: #dbeafe; color: #1e40af; }
    .member-type.segment { background: #fef3c7; color: #92400e; }
    .query-editor {
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      padding: 1rem;
    }
    .query-editor textarea {
      width: 100%;
      height: 150px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.875rem;
      border: 1px solid #e1e4e8;
      border-radius: 4px;
      padding: 0.75rem;
      resize: vertical;
    }
    .btn-row { display: flex; gap: 0.5rem; margin-top: 1rem; }
    .btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-primary { background: #7928ca; color: white; }
    .btn-primary:hover { background: #6b21a8; }
    .btn-secondary { background: #e5e7eb; color: #374151; }
    .btn-secondary:hover { background: #d1d5db; }
    .results {
      flex: 1;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      overflow: auto;
    }
    .results-header {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #e1e4e8;
      display: flex;
      gap: 1rem;
    }
    .results-tab {
      padding: 0.375rem 0.75rem;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.875rem;
    }
    .results-tab.active { background: #f0f0f0; }
    .results-content { padding: 1rem; }
    pre {
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.8125rem;
      background: #f6f8fa;
      padding: 1rem;
      border-radius: 4px;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td {
      padding: 0.5rem 0.75rem;
      text-align: left;
      border-bottom: 1px solid #e1e4e8;
    }
    th { font-weight: 600; background: #f6f8fa; }
    .status {
      font-size: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .status-dot.connected { background: #22c55e; }
    .status-dot.disconnected { background: #ef4444; }
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      color: #6c757d;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Cube.js Playground</h1>
    <div class="status">
      <span class="status-dot connected" id="status-dot"></span>
      <span id="status-text">Connected</span>
    </div>
  </div>
  <div class="container">
    <div class="sidebar">
      <div class="section-title">Schema Explorer</div>
      <div id="schema-tree">
        <div class="loading">Loading schema...</div>
      </div>
    </div>
    <div class="main">
      <div class="query-editor">
        <div class="section-title">Query Builder</div>
        <textarea id="query-input" placeholder='{"measures": ["Orders.count"], "dimensions": ["Orders.status"]}'>{
  "measures": ["Orders.count"],
  "dimensions": ["Orders.status"]
}</textarea>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="runQuery()">Run Query</button>
          <button class="btn btn-secondary" onclick="generateSQL()">Generate SQL</button>
          <button class="btn btn-secondary" onclick="dryRun()">Dry Run</button>
        </div>
      </div>
      <div class="results">
        <div class="results-header">
          <div class="results-tab active" data-tab="data" onclick="switchTab('data')">Data</div>
          <div class="results-tab" data-tab="sql" onclick="switchTab('sql')">SQL</div>
          <div class="results-tab" data-tab="json" onclick="switchTab('json')">JSON</div>
        </div>
        <div class="results-content" id="results-content">
          <div class="loading">Run a query to see results</div>
        </div>
      </div>
    </div>
  </div>
  <script>
    const API_BASE = '/cubejs-api/v1';
    const API_TOKEN = 'playground_token';
    let currentTab = 'data';
    let lastResult = null;
    let ws = null;

    // Initialize WebSocket for live reload
    function initWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + window.location.host + '/ws');

      ws.onopen = () => {
        document.getElementById('status-dot').classList.remove('disconnected');
        document.getElementById('status-dot').classList.add('connected');
        document.getElementById('status-text').textContent = 'Connected';
      };

      ws.onclose = () => {
        document.getElementById('status-dot').classList.remove('connected');
        document.getElementById('status-dot').classList.add('disconnected');
        document.getElementById('status-text').textContent = 'Disconnected';
        // Reconnect after 3 seconds
        setTimeout(initWebSocket, 3000);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'schema-change') {
          renderSchemaTree(data.cubes);
        }
      };
    }

    // Fetch and render schema
    async function loadSchema() {
      try {
        const response = await fetch(API_BASE + '/meta', {
          headers: { 'Authorization': API_TOKEN }
        });
        const data = await response.json();
        renderSchemaTree(data.cubes);
      } catch (error) {
        console.error('Failed to load schema:', error);
        document.getElementById('schema-tree').innerHTML =
          '<div class="loading">Failed to load schema</div>';
      }
    }

    // Render schema tree
    function renderSchemaTree(cubes) {
      const container = document.getElementById('schema-tree');
      container.innerHTML = cubes.map(cube => \`
        <div class="cube-name">\${cube.name}</div>
        <div class="section-title">Measures</div>
        <ul class="member-list">
          \${cube.measures.map(m => \`
            <li class="member-item" onclick="addMember('\${m.name}', 'measure')">
              <span class="member-type measure">M</span>
              <span>\${m.name.split('.')[1]}</span>
            </li>
          \`).join('')}
        </ul>
        <div class="section-title">Dimensions</div>
        <ul class="member-list">
          \${cube.dimensions.map(d => \`
            <li class="member-item" onclick="addMember('\${d.name}', 'dimension')">
              <span class="member-type dimension">D</span>
              <span>\${d.name.split('.')[1]}</span>
            </li>
          \`).join('')}
        </ul>
        \${cube.segments && cube.segments.length > 0 ? \`
          <div class="section-title">Segments</div>
          <ul class="member-list">
            \${cube.segments.map(s => \`
              <li class="member-item" onclick="addMember('\${s.name}', 'segment')">
                <span class="member-type segment">S</span>
                <span>\${s.name.split('.')[1]}</span>
              </li>
            \`).join('')}
          </ul>
        \` : ''}
      \`).join('');
    }

    // Add member to query
    function addMember(name, type) {
      try {
        const input = document.getElementById('query-input');
        const query = JSON.parse(input.value || '{}');

        if (type === 'measure') {
          query.measures = query.measures || [];
          if (!query.measures.includes(name)) {
            query.measures.push(name);
          }
        } else if (type === 'dimension') {
          query.dimensions = query.dimensions || [];
          if (!query.dimensions.includes(name)) {
            query.dimensions.push(name);
          }
        } else if (type === 'segment') {
          query.segments = query.segments || [];
          if (!query.segments.includes(name)) {
            query.segments.push(name);
          }
        }

        input.value = JSON.stringify(query, null, 2);
      } catch (e) {
        console.error('Failed to add member:', e);
      }
    }

    // Run query
    async function runQuery() {
      const input = document.getElementById('query-input');
      const resultsContent = document.getElementById('results-content');

      try {
        const query = JSON.parse(input.value);
        resultsContent.innerHTML = '<div class="loading">Loading...</div>';

        const response = await fetch(API_BASE + '/load', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': API_TOKEN
          },
          body: JSON.stringify({ query })
        });

        lastResult = await response.json();

        if (response.ok) {
          renderResults();
        } else {
          resultsContent.innerHTML = '<pre style="color: #dc2626;">' +
            JSON.stringify(lastResult, null, 2) + '</pre>';
        }
      } catch (error) {
        resultsContent.innerHTML = '<pre style="color: #dc2626;">Error: ' +
          error.message + '</pre>';
      }
    }

    // Generate SQL
    async function generateSQL() {
      const input = document.getElementById('query-input');
      const resultsContent = document.getElementById('results-content');

      try {
        const query = JSON.parse(input.value);
        resultsContent.innerHTML = '<div class="loading">Generating SQL...</div>';

        const response = await fetch(API_BASE + '/sql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': API_TOKEN
          },
          body: JSON.stringify({ query })
        });

        const result = await response.json();

        if (response.ok) {
          resultsContent.innerHTML = '<pre>' +
            (result.sql.sql ? result.sql.sql.join('\\n') : result.sql) + '</pre>';
        } else {
          resultsContent.innerHTML = '<pre style="color: #dc2626;">' +
            JSON.stringify(result, null, 2) + '</pre>';
        }
      } catch (error) {
        resultsContent.innerHTML = '<pre style="color: #dc2626;">Error: ' +
          error.message + '</pre>';
      }
    }

    // Dry run
    async function dryRun() {
      const input = document.getElementById('query-input');
      const resultsContent = document.getElementById('results-content');

      try {
        const query = JSON.parse(input.value);
        resultsContent.innerHTML = '<div class="loading">Validating query...</div>';

        const response = await fetch(API_BASE + '/dry-run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': API_TOKEN
          },
          body: JSON.stringify({ query })
        });

        const result = await response.json();

        resultsContent.innerHTML = '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
      } catch (error) {
        resultsContent.innerHTML = '<pre style="color: #dc2626;">Error: ' +
          error.message + '</pre>';
      }
    }

    // Switch results tab
    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.results-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
      });
      renderResults();
    }

    // Render results based on current tab
    function renderResults() {
      const resultsContent = document.getElementById('results-content');

      if (!lastResult) {
        resultsContent.innerHTML = '<div class="loading">Run a query to see results</div>';
        return;
      }

      if (currentTab === 'data' && lastResult.data) {
        if (lastResult.data.length === 0) {
          resultsContent.innerHTML = '<div class="loading">No data returned</div>';
          return;
        }

        const columns = Object.keys(lastResult.data[0]);
        const html = \`
          <table>
            <thead>
              <tr>\${columns.map(c => '<th>' + c + '</th>').join('')}</tr>
            </thead>
            <tbody>
              \${lastResult.data.map(row => \`
                <tr>\${columns.map(c => '<td>' + (row[c] ?? '') + '</td>').join('')}</tr>
              \`).join('')}
            </tbody>
          </table>
        \`;
        resultsContent.innerHTML = html;
      } else if (currentTab === 'sql') {
        resultsContent.innerHTML = '<pre>' + (lastResult.sql || 'No SQL available') + '</pre>';
      } else {
        resultsContent.innerHTML = '<pre>' + JSON.stringify(lastResult, null, 2) + '</pre>';
      }
    }

    // Initialize
    loadSchema();
    initWebSocket();
  </script>
</body>
</html>`
  }

  /**
   * Convert measure type to annotation type
   */
  private measureTypeToAnnotationType(type: string): string {
    switch (type) {
      case 'count':
      case 'countDistinct':
      case 'countDistinctApprox':
      case 'sum':
      case 'avg':
      case 'min':
      case 'max':
      case 'runningTotal':
        return 'number'
      case 'number':
        return 'number'
      default:
        return 'string'
    }
  }

  /**
   * Convert camelCase/snake_case to Title Case
   */
  private toTitle(str: string): string {
    return str
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^\w/, (c) => c.toUpperCase())
      .trim()
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Cube.js Playground server
 */
export function createPlaygroundServer(options: PlaygroundServerOptions): PlaygroundServer {
  return new PlaygroundServer(options)
}
