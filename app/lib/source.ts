import { loader } from 'fumadocs-core/source'
import {
  concepts,
  api,
  gettingStarted,
  agents,
  cli,
  database,
  deployment,
  integrations,
  sdk,
  rpc,
  guides,
  observability,
  primitives,
  security,
  storage,
  workflows,
  // Additional sections
  actions,
  architecture,
  compat,
  events,
  functions,
  humans,
  mcp,
  objects,
  platform,
  transport,
  ui,
} from 'fumadocs-mdx:collections/server'

/**
 * Multi-collection source loaders
 *
 * Each collection has its own loader with baseUrl for:
 * - Independent navigation trees
 * - Separate chunk splitting
 * - Memory-efficient prerendering
 *
 * @see docs/plans/2026-01-12-fumadocs-static-prerender-design.md
 */

// Core documentation
export const conceptsSource = loader({
  source: concepts.toFumadocsSource(),
  baseUrl: '/docs/concepts',
})

export const apiSource = loader({
  source: api.toFumadocsSource(),
  baseUrl: '/docs/api',
})

export const gettingStartedSource = loader({
  source: gettingStarted.toFumadocsSource(),
  baseUrl: '/docs/getting-started',
})

// Platform & Infrastructure
export const agentsSource = loader({
  source: agents.toFumadocsSource(),
  baseUrl: '/docs/agents',
})

export const cliSource = loader({
  source: cli.toFumadocsSource(),
  baseUrl: '/docs/cli',
})

export const databaseSource = loader({
  source: database.toFumadocsSource(),
  baseUrl: '/docs/database',
})

export const deploymentSource = loader({
  source: deployment.toFumadocsSource(),
  baseUrl: '/docs/deployment',
})

// Integration & SDK docs
export const integrationsSource = loader({
  source: integrations.toFumadocsSource(),
  baseUrl: '/docs/integrations',
})

export const sdkSource = loader({
  source: sdk.toFumadocsSource(),
  baseUrl: '/docs/sdk',
})

export const rpcSource = loader({
  source: rpc.toFumadocsSource(),
  baseUrl: '/docs/rpc',
})

// Advanced topics
export const guidesSource = loader({
  source: guides.toFumadocsSource(),
  baseUrl: '/docs/guides',
})

export const observabilitySource = loader({
  source: observability.toFumadocsSource(),
  baseUrl: '/docs/observability',
})

export const primitivesSource = loader({
  source: primitives.toFumadocsSource(),
  baseUrl: '/docs/primitives',
})

export const securitySource = loader({
  source: security.toFumadocsSource(),
  baseUrl: '/docs/security',
})

export const storageSource = loader({
  source: storage.toFumadocsSource(),
  baseUrl: '/docs/storage',
})

export const workflowsSource = loader({
  source: workflows.toFumadocsSource(),
  baseUrl: '/docs/workflows',
})

// Additional sections
export const actionsSource = loader({
  source: actions.toFumadocsSource(),
  baseUrl: '/docs/actions',
})

export const architectureSource = loader({
  source: architecture.toFumadocsSource(),
  baseUrl: '/docs/architecture',
})

export const compatSource = loader({
  source: compat.toFumadocsSource(),
  baseUrl: '/docs/compat',
})

export const eventsSource = loader({
  source: events.toFumadocsSource(),
  baseUrl: '/docs/events',
})

export const functionsSource = loader({
  source: functions.toFumadocsSource(),
  baseUrl: '/docs/functions',
})

export const humansSource = loader({
  source: humans.toFumadocsSource(),
  baseUrl: '/docs/humans',
})

export const mcpSource = loader({
  source: mcp.toFumadocsSource(),
  baseUrl: '/docs/mcp',
})

export const objectsSource = loader({
  source: objects.toFumadocsSource(),
  baseUrl: '/docs/objects',
})

export const platformSource = loader({
  source: platform.toFumadocsSource(),
  baseUrl: '/docs/platform',
})

export const transportSource = loader({
  source: transport.toFumadocsSource(),
  baseUrl: '/docs/transport',
})

export const uiSource = loader({
  source: ui.toFumadocsSource(),
  baseUrl: '/docs/ui',
})

// Main docs source (uses getting-started as entry point for /docs)
export const source = gettingStartedSource

/**
 * Root tabs for top-level navigation
 */
export const rootTabs = [
  { title: 'Getting Started', url: '/docs/getting-started' },
  { title: 'Concepts', url: '/docs/concepts' },
  { title: 'API', url: '/docs/api' },
  { title: 'SDKs', url: '/docs/integrations' },
  { title: 'Agents', url: '/docs/agents' },
  { title: 'CLI', url: '/docs/cli' },
  { title: 'Database', url: '/docs/database' },
  { title: 'Deployment', url: '/docs/deployment' },
]

/**
 * All source loaders for iteration
 */
const allSources = [
  // Core docs
  conceptsSource,
  apiSource,
  gettingStartedSource,
  // Platform
  agentsSource,
  cliSource,
  databaseSource,
  deploymentSource,
  // SDKs
  integrationsSource,
  sdkSource,
  rpcSource,
  // Advanced
  guidesSource,
  observabilitySource,
  primitivesSource,
  securitySource,
  storageSource,
  workflowsSource,
  // Additional
  actionsSource,
  architectureSource,
  compatSource,
  eventsSource,
  functionsSource,
  humansSource,
  mcpSource,
  objectsSource,
  platformSource,
  transportSource,
  uiSource,
]

/**
 * Get all pages from all collections for prerendering
 */
export function getAllPages() {
  return allSources.flatMap((s) => s.getPages())
}
