// dotdo - Main Package
// Re-exports all @dotdo/* packages for unified consumption

// === @dotdo/do - Durable Objects ===
export * from '@dotdo/do'
export { DO, type DOEnv, type DOOptions } from '@dotdo/do'
export { createContext, type WorkflowContext, type $ } from '@dotdo/do'

// === @dotdo/db - Database Layer ===
export * from '@dotdo/db'
// Things, Relationships, Events, Query utils

// === @dotdo/ai - AI Routing Layer ===
export * from '@dotdo/ai'
// Template literals, AIPromise, multi-provider routing

// === @dotdo/auth - Authentication ===
export * from '@dotdo/auth'
// Hono middleware and guards

// === @dotdo/rpc - RPC Communication ===
export * from '@dotdo/rpc'
export { createClient, createDOStub } from '@dotdo/rpc'
export { createServer, createWorkerFromTarget } from '@dotdo/rpc'

// === @dotdo/mcp - MCP Server ===
export * from '@dotdo/mcp'
export { createMCPServer } from '@dotdo/mcp'
export { searchTool, fetchTool, doTool } from '@dotdo/mcp'

// === @dotdo/api - Self-Describing API ===
export * from '@dotdo/api'
export { createAPI } from '@dotdo/api'
export { defineResource } from '@dotdo/api'
export { generateOpenAPI, generateSDK } from '@dotdo/api'
