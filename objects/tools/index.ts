/**
 * @module objects/tools
 * @description Tool and Integration Durable Objects
 *
 * This module exports DOs for managing tools and integrations:
 *
 * **Tool DO:**
 * A Durable Object that represents a registered tool/capability.
 * Tools are capabilities that humans or agents can use to perform actions.
 *
 * **Integration DO:**
 * A Durable Object that manages connections to external services
 * like Stripe, GitHub, Slack, etc.
 *
 * @see https://schema.org.ai/Tool
 * @see https://schema.org.ai/Integration
 * @see digital-tools package for type definitions
 */

// Tool DO
export {
  Tool,
  type ToolData,
  type ToolUsageStats,
  type ToolInvokeInput,
  type ToolInvokeResult,
} from './Tool'

// Integration DO
export {
  Integration,
  type AuthType,
  type ConnectionStatus,
  type IntegrationConfig,
  type IntegrationCredentials,
  type OAuthTokenResponse,
  type ConnectOptions,
} from './Integration'
