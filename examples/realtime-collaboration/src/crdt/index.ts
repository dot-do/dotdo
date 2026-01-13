/**
 * CRDT (Conflict-free Replicated Data Types) Implementation
 *
 * This module provides Yjs-inspired CRDT primitives for real-time collaboration:
 * - YText: Collaborative text editing with character-level granularity
 * - YArray: Collaborative arrays (ordered lists)
 * - YMap: Collaborative key-value maps
 *
 * Uses YATA (Yet Another Transformation Approach) algorithm for text,
 * which provides better performance than traditional OT.
 */

export * from './clock'
export * from './id'
export * from './ytext'
export * from './yarray'
export * from './ymap'
export * from './doc'
export * from './operations'
