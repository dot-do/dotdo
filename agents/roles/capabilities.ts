/**
 * Capability Definitions
 *
 * Pre-defined capabilities for the agent role system. Capabilities
 * represent what an agent can do and are assigned to roles with
 * specific permission levels.
 *
 * @see dotdo-eahcx - Agent Roles epic
 * @module agents/roles/capabilities
 */

import type { Capability, CapabilityId, CapabilityCategory } from './types'

// ============================================================================
// Capability Factory
// ============================================================================

/**
 * Create a capability definition
 */
function cap(
  id: CapabilityId,
  name: string,
  description: string,
  category: CapabilityCategory,
  options: Partial<Pick<Capability, 'delegable' | 'requires'>> = {}
): Capability {
  return {
    id,
    name,
    description,
    category,
    defaultLevel: 'read',
    delegable: options.delegable ?? true,
    requires: options.requires,
  }
}

// ============================================================================
// Code Capabilities
// ============================================================================

export const CODE_READ = cap(
  'code:read',
  'Read Code',
  'Read source code files and repositories',
  'code'
)

export const CODE_WRITE = cap(
  'code:write',
  'Write Code',
  'Create and modify source code files',
  'code',
  { requires: ['code:read'] }
)

export const CODE_EXECUTE = cap(
  'code:execute',
  'Execute Code',
  'Run code and scripts in sandboxed environments',
  'code',
  { requires: ['code:read'] }
)

export const CODE_REVIEW = cap(
  'code:review',
  'Review Code',
  'Review code changes and provide feedback',
  'code',
  { requires: ['code:read'] }
)

export const CODE_DEPLOY = cap(
  'code:deploy',
  'Deploy Code',
  'Deploy code to staging or production environments',
  'code',
  { requires: ['code:read', 'code:execute'], delegable: false }
)

// ============================================================================
// Data Capabilities
// ============================================================================

export const DATA_READ = cap(
  'data:read',
  'Read Data',
  'Read data from databases and stores',
  'data'
)

export const DATA_WRITE = cap(
  'data:write',
  'Write Data',
  'Create and update data records',
  'data',
  { requires: ['data:read'] }
)

export const DATA_DELETE = cap(
  'data:delete',
  'Delete Data',
  'Delete data records (soft or hard delete)',
  'data',
  { requires: ['data:read', 'data:write'], delegable: false }
)

export const DATA_EXPORT = cap(
  'data:export',
  'Export Data',
  'Export data in various formats',
  'data',
  { requires: ['data:read'] }
)

export const DATA_ANALYTICS = cap(
  'data:analytics',
  'Data Analytics',
  'Run analytics queries and generate reports',
  'data',
  { requires: ['data:read'] }
)

// ============================================================================
// Communication Capabilities
// ============================================================================

export const COMMS_EMAIL_READ = cap(
  'comms:email:read',
  'Read Email',
  'Read email messages and threads',
  'comms'
)

export const COMMS_EMAIL_SEND = cap(
  'comms:email:send',
  'Send Email',
  'Send email messages',
  'comms',
  { requires: ['comms:email:read'] }
)

export const COMMS_SLACK_READ = cap(
  'comms:slack:read',
  'Read Slack',
  'Read Slack messages and channels',
  'comms'
)

export const COMMS_SLACK_SEND = cap(
  'comms:slack:send',
  'Send Slack',
  'Send Slack messages',
  'comms',
  { requires: ['comms:slack:read'] }
)

export const COMMS_CUSTOMER = cap(
  'comms:customer',
  'Customer Communication',
  'Communicate directly with customers',
  'comms',
  { delegable: false }
)

// ============================================================================
// Finance Capabilities
// ============================================================================

export const FINANCE_VIEW = cap(
  'finance:view',
  'View Financials',
  'View financial data and reports',
  'finance'
)

export const FINANCE_TRANSACT = cap(
  'finance:transact',
  'Financial Transactions',
  'Create financial transactions and payments',
  'finance',
  { requires: ['finance:view'], delegable: false }
)

export const FINANCE_BUDGET = cap(
  'finance:budget',
  'Budget Management',
  'Create and manage budgets',
  'finance',
  { requires: ['finance:view'] }
)

export const FINANCE_APPROVE = cap(
  'finance:approve',
  'Approve Financials',
  'Approve financial transactions over threshold',
  'finance',
  { requires: ['finance:view'], delegable: false }
)

// ============================================================================
// Admin Capabilities
// ============================================================================

export const ADMIN_USERS = cap(
  'admin:users',
  'User Management',
  'Manage user accounts and permissions',
  'admin',
  { delegable: false }
)

export const ADMIN_SETTINGS = cap(
  'admin:settings',
  'Settings Management',
  'Manage system and application settings',
  'admin',
  { delegable: false }
)

export const ADMIN_AUDIT = cap(
  'admin:audit',
  'Audit Logs',
  'View and export audit logs',
  'admin'
)

// ============================================================================
// AI Capabilities
// ============================================================================

export const AI_INVOKE = cap(
  'ai:invoke',
  'Invoke AI',
  'Make AI model API calls',
  'ai'
)

export const AI_EMBED = cap(
  'ai:embed',
  'Generate Embeddings',
  'Generate vector embeddings',
  'ai'
)

export const AI_FINETUNE = cap(
  'ai:finetune',
  'Fine-tune Models',
  'Fine-tune AI models with custom data',
  'ai',
  { requires: ['ai:invoke'], delegable: false }
)

export const AI_AUTONOMOUS = cap(
  'ai:autonomous',
  'Autonomous Operation',
  'Operate autonomously without human approval',
  'ai',
  { requires: ['ai:invoke'], delegable: false }
)

// ============================================================================
// Tool Capabilities
// ============================================================================

export const TOOLS_BASH = cap(
  'tools:bash',
  'Bash Shell',
  'Execute bash commands',
  'tools',
  { delegable: false }
)

export const TOOLS_GIT = cap(
  'tools:git',
  'Git Operations',
  'Perform git operations (commit, push, etc.)',
  'tools',
  { requires: ['code:read'] }
)

export const TOOLS_FILE_READ = cap(
  'tools:file:read',
  'Read Files',
  'Read files from the filesystem',
  'tools'
)

export const TOOLS_FILE_WRITE = cap(
  'tools:file:write',
  'Write Files',
  'Write files to the filesystem',
  'tools',
  { requires: ['tools:file:read'] }
)

export const TOOLS_HTTP = cap(
  'tools:http',
  'HTTP Requests',
  'Make HTTP requests to external services',
  'tools'
)

// ============================================================================
// Workflow Capabilities
// ============================================================================

export const WORKFLOW_CREATE = cap(
  'workflow:create',
  'Create Workflows',
  'Create and define workflows',
  'workflow'
)

export const WORKFLOW_EXECUTE = cap(
  'workflow:execute',
  'Execute Workflows',
  'Execute and run workflows',
  'workflow',
  { requires: ['workflow:create'] }
)

export const WORKFLOW_APPROVE = cap(
  'workflow:approve',
  'Approve Workflow Steps',
  'Approve workflow steps and stages',
  'workflow'
)

export const WORKFLOW_ESCALATE = cap(
  'workflow:escalate',
  'Escalate Workflows',
  'Escalate workflows to humans or other agents',
  'workflow'
)

export const WORKFLOW_HANDOFF = cap(
  'workflow:handoff',
  'Handoff Tasks',
  'Hand off tasks to other agents',
  'workflow'
)

// ============================================================================
// Capability Registry
// ============================================================================

/**
 * All defined capabilities indexed by ID
 */
export const CAPABILITIES: Record<CapabilityId, Capability> = {
  // Code
  'code:read': CODE_READ,
  'code:write': CODE_WRITE,
  'code:execute': CODE_EXECUTE,
  'code:review': CODE_REVIEW,
  'code:deploy': CODE_DEPLOY,
  // Data
  'data:read': DATA_READ,
  'data:write': DATA_WRITE,
  'data:delete': DATA_DELETE,
  'data:export': DATA_EXPORT,
  'data:analytics': DATA_ANALYTICS,
  // Communications
  'comms:email:read': COMMS_EMAIL_READ,
  'comms:email:send': COMMS_EMAIL_SEND,
  'comms:slack:read': COMMS_SLACK_READ,
  'comms:slack:send': COMMS_SLACK_SEND,
  'comms:customer': COMMS_CUSTOMER,
  // Finance
  'finance:view': FINANCE_VIEW,
  'finance:transact': FINANCE_TRANSACT,
  'finance:budget': FINANCE_BUDGET,
  'finance:approve': FINANCE_APPROVE,
  // Admin
  'admin:users': ADMIN_USERS,
  'admin:settings': ADMIN_SETTINGS,
  'admin:audit': ADMIN_AUDIT,
  // AI
  'ai:invoke': AI_INVOKE,
  'ai:embed': AI_EMBED,
  'ai:finetune': AI_FINETUNE,
  'ai:autonomous': AI_AUTONOMOUS,
  // Tools
  'tools:bash': TOOLS_BASH,
  'tools:git': TOOLS_GIT,
  'tools:file:read': TOOLS_FILE_READ,
  'tools:file:write': TOOLS_FILE_WRITE,
  'tools:http': TOOLS_HTTP,
  // Workflow
  'workflow:create': WORKFLOW_CREATE,
  'workflow:execute': WORKFLOW_EXECUTE,
  'workflow:approve': WORKFLOW_APPROVE,
  'workflow:escalate': WORKFLOW_ESCALATE,
  'workflow:handoff': WORKFLOW_HANDOFF,
}

/**
 * Get a capability by ID
 */
export function getCapability(id: CapabilityId): Capability | undefined {
  return CAPABILITIES[id]
}

/**
 * Get all capabilities in a category
 */
export function getCapabilitiesByCategory(category: CapabilityCategory): Capability[] {
  return Object.values(CAPABILITIES).filter(cap => cap.category === category)
}

/**
 * Check if a capability has all its dependencies satisfied
 */
export function checkCapabilityDependencies(
  id: CapabilityId,
  availableCapabilities: Set<CapabilityId>
): { satisfied: boolean; missing: CapabilityId[] } {
  const cap = CAPABILITIES[id]
  if (!cap) {
    return { satisfied: false, missing: [id] }
  }

  if (!cap.requires || cap.requires.length === 0) {
    return { satisfied: true, missing: [] }
  }

  const missing = cap.requires.filter(reqId => !availableCapabilities.has(reqId))
  return {
    satisfied: missing.length === 0,
    missing,
  }
}

/**
 * Get all capability IDs
 */
export function getAllCapabilityIds(): CapabilityId[] {
  return Object.keys(CAPABILITIES)
}
