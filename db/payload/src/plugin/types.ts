/**
 * Plugin Configuration Types
 *
 * TypeScript interfaces for the dotdo Payload CMS plugin.
 */

// Conditional import for peer dependency
// @ts-ignore - payload is a peer dependency
import type { Config } from 'payload'

/**
 * Sync event callback
 */
export type OnSyncCallback = (payload: {
  collection: string
  operation: 'create' | 'update' | 'delete'
  doc: Record<string, unknown>
}) => void | Promise<void>

/**
 * Workflow event callback
 */
export type OnWorkflowCallback = (payload: {
  workflow: string
  step: string
  data: Record<string, unknown>
}) => void | Promise<void>

/**
 * Configuration options for the dotdo Payload plugin
 */
export interface DotdoPluginConfig {
  /**
   * Namespace URL prefix for $type values
   * Must be a valid URL (e.g., 'https://example.do')
   * @default undefined
   */
  namespace?: string

  /**
   * Enable the /dotdo/sync endpoint for data synchronization
   * @default false
   */
  syncEndpoint?: boolean

  /**
   * Enable the /dotdo/workflow endpoint for workflow triggers
   * @default false
   */
  workflowEndpoint?: boolean

  /**
   * Callback invoked when sync events occur
   */
  onSync?: OnSyncCallback

  /**
   * Callback invoked when workflow events occur
   */
  onWorkflow?: OnWorkflowCallback

  /**
   * Collection slugs to exclude from dotdo processing
   * These collections will not have metadata fields or hooks added
   */
  excludeCollections?: string[]

  /**
   * Collection slugs to include for dotdo processing
   * If specified, only these collections will be modified
   * (mutually exclusive with excludeCollections)
   */
  includeCollections?: string[]
}

/**
 * Internal resolved configuration with defaults applied
 */
export interface ResolvedDotdoPluginConfig {
  namespace: string | undefined
  syncEndpoint: boolean
  workflowEndpoint: boolean
  onSync: OnSyncCallback | undefined
  onWorkflow: OnWorkflowCallback | undefined
}

/**
 * Payload plugin function type
 * Takes incoming config and returns modified config
 */
export type PayloadPlugin = (incomingConfig: Config) => Config
