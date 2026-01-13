/**
 * Agent Graph Module
 *
 * Complete graph-based model for Agents with:
 * - Memory Things: Long-term and conversation memory stored as graph nodes
 * - Tool Relationships: HAS_TOOL, CAN_USE relationships to tools
 * - Conversation Threads: PARTICIPATES_IN relationships to conversations
 * - Agent-to-Agent: HANDED_OFF_TO, SPAWNED relationships
 *
 * @see dotdo-ucolo - Agents as Graph Things (Epic)
 * @module db/graph/agents
 */

// Re-export Agent Thing
export {
  // Constants
  AGENT_TYPE,
  AGENT_TYPE_ID,
  AGENT_TYPE_NAME,
  DEFAULT_AGENT_MODEL,
  NAMED_AGENTS,
  AGENT_VERBS,
  // Types
  type AgentMode,
  type AgentRole,
  type AgentPersonaData,
  type AgentThingData,
  type CreateAgentThingInput,
  type UpdateAgentThingInput,
  type AgentThing,
  type NamedAgentName,
  type AgentVerb,
  // CRUD
  createAgentThing,
  getAgentThing,
  getAllAgents,
  getAgentsByRole,
  updateAgentThing,
  deleteAgentThing,
  // Named agents
  registerNamedAgents,
  // Type guards
  isAgentThingData,
  isAgentThing,
} from '../agent-thing'

// Memory Thing exports
export {
  // Constants
  MEMORY_TYPE_ID,
  MEMORY_TYPE_NAME,
  // Types
  type MemoryKind,
  type MemoryThingData,
  type CreateMemoryInput,
  type MemoryThing,
  // CRUD
  createMemory,
  getMemory,
  getMemoriesByAgent,
  getMemoriesByKind,
  searchMemories,
  updateMemory,
  deleteMemory,
  // Type guards
  isMemoryThingData,
  isMemoryThing,
} from './memory'

// Conversation Thing exports
export {
  // Constants
  CONVERSATION_TYPE_ID,
  CONVERSATION_TYPE_NAME,
  CONVERSATION_STATUS,
  // Types
  type ConversationStatus,
  type ConversationThingData,
  type CreateConversationInput,
  type ConversationThing,
  type ConversationMessageData,
  // CRUD
  createConversation,
  getConversation,
  getAgentConversations,
  getActiveConversations,
  addAgentToConversation,
  removeAgentFromConversation,
  addMessageToConversation,
  updateConversationStatus,
  deleteConversation,
  // Type guards
  isConversationThingData,
  isConversationThing,
} from './conversation'

// Relationship operations
export {
  // Tool relationships
  addToolToAgent,
  removeToolFromAgent,
  getAgentTools,
  agentHasTool,
  // Memory relationships
  linkMemoryToAgent,
  unlinkMemoryFromAgent,
  // Conversation relationships
  linkConversationToAgent,
  getConversationParticipants,
  // Handoff relationships
  recordHandoff,
  getHandoffHistory,
  // Spawn relationships
  recordSpawn,
  getSpawnedAgents,
  getParentAgent,
} from './relationships'
