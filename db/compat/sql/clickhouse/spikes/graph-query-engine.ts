/**
 * SPIKE: Graph Query Engine for Things + Relationships
 *
 * True graph queries and traversals using columnar storage + DO-based indexes
 *
 * Key Insight: Graph traversals can be 99% index-only operations!
 * - Adjacency lookups: O(1) from DO index
 * - Path exists: Bloom filter check, no R2 fetch
 * - BFS/DFS: Traverse indexes only, fetch properties on demand
 */

// ============================================================================
// Types - Graph Model
// ============================================================================

export interface Thing {
  id: string
  type: string
  ns: string
  data: Record<string, unknown>
  embedding?: Float32Array
  createdAt: number
  updatedAt: number
}

export interface Relationship {
  id: string
  type: string
  from: string
  to: string
  data?: Record<string, unknown>
  createdAt: number
}

export interface AdjacencyEntry {
  to: string
  type: string
  relId: string
  data?: Record<string, unknown>
}

export interface ReverseAdjacencyEntry {
  from: string
  type: string
  relId: string
  data?: Record<string, unknown>
}

// ============================================================================
// Types - Query Language
// ============================================================================

export type Direction = 'out' | 'in' | 'both'

export interface TraversalStep {
  direction: Direction
  edgeTypes?: string[]
  minHops: number
  maxHops: number
  filter?: VertexFilter
  limit?: number
}

export interface VertexFilter {
  types?: string[]
  predicates?: Predicate[]
}

export interface Predicate {
  field: string
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'CONTAINS' | 'EXISTS'
  value: unknown
}

export interface GraphQuery {
  startVertices: string[] | VertexFilter
  traversals: TraversalStep[]
  returnPath?: boolean
  returnProperties?: string[]
  distinct?: boolean
  limit?: number
  skip?: number
}

export interface GraphPath {
  vertices: string[]
  edges: string[]
  length: number
}

export interface GraphQueryResult {
  vertices: Thing[]
  paths?: GraphPath[]
  stats: GraphQueryStats
}

export interface GraphQueryStats {
  parseTimeMs: number
  planTimeMs: number
  executeTimeMs: number
  totalTimeMs: number
  verticesVisited: number
  edgesTraversed: number
  indexLookups: number
  coldFetches: number
  cacheHits: number
}

// ============================================================================
// Adjacency Index - Columnar storage in DO SQLite
// ============================================================================

export class AdjacencyIndex {
  private outgoing: Map<string, AdjacencyEntry[]> = new Map()
  private incoming: Map<string, ReverseAdjacencyEntry[]> = new Map()
  private degrees: Map<string, { out: number; in: number }> = new Map()
  
  private vertexBloom: BloomFilter
  private edgeBloom: BloomFilter
  
  private vertexCount = 0
  private edgeCount = 0
  private readCount = 0
  private writeCount = 0

  constructor(expectedVertices = 100000, expectedEdges = 1000000) {
    this.vertexBloom = new BloomFilter(expectedVertices, 0.01)
    this.edgeBloom = new BloomFilter(expectedEdges, 0.01)
  }

  addEdge(rel: Relationship): void {
    if (!this.outgoing.has(rel.from)) {
      this.outgoing.set(rel.from, [])
      this.vertexBloom.add(rel.from)
      this.vertexCount++
    }
    this.outgoing.get(rel.from)!.push({
      to: rel.to,
      type: rel.type,
      relId: rel.id,
      data: rel.data,
    })

    if (!this.incoming.has(rel.to)) {
      this.incoming.set(rel.to, [])
      this.vertexBloom.add(rel.to)
    }
    this.incoming.get(rel.to)!.push({
      from: rel.from,
      type: rel.type,
      relId: rel.id,
      data: rel.data,
    })

    const fromDeg = this.degrees.get(rel.from) ?? { out: 0, in: 0 }
    fromDeg.out++
    this.degrees.set(rel.from, fromDeg)

    const toDeg = this.degrees.get(rel.to) ?? { out: 0, in: 0 }
    toDeg.in++
    this.degrees.set(rel.to, toDeg)

    this.edgeBloom.add(rel.id)
    this.edgeBloom.add(rel.from + '->' + rel.to)
    this.edgeCount++
    this.writeCount++
  }

  getOutgoing(vertexId: string, edgeTypes?: string[]): AdjacencyEntry[] {
    this.readCount++
    const edges = this.outgoing.get(vertexId) ?? []
    if (!edgeTypes || edgeTypes.length === 0) return edges
    return edges.filter(e => edgeTypes.includes(e.type))
  }

  getIncoming(vertexId: string, edgeTypes?: string[]): ReverseAdjacencyEntry[] {
    this.readCount++
    const edges = this.incoming.get(vertexId) ?? []
    if (!edgeTypes || edgeTypes.length === 0) return edges
    return edges.filter(e => edgeTypes.includes(e.type))
  }

  getNeighbors(vertexId: string, direction: Direction, edgeTypes?: string[]): string[] {
    const neighbors: Set<string> = new Set()

    if (direction === 'out' || direction === 'both') {
      for (const edge of this.getOutgoing(vertexId, edgeTypes)) {
        neighbors.add(edge.to)
      }
    }

    if (direction === 'in' || direction === 'both') {
      for (const edge of this.getIncoming(vertexId, edgeTypes)) {
        neighbors.add(edge.from)
      }
    }

    return Array.from(neighbors)
  }

  mightExist(vertexId: string): boolean {
    return this.vertexBloom.mightContain(vertexId)
  }

  mightHaveEdge(from: string, to: string): boolean {
    return this.edgeBloom.mightContain(from + '->' + to)
  }

  getDegree(vertexId: string): { out: number; in: number; total: number } {
    const deg = this.degrees.get(vertexId) ?? { out: 0, in: 0 }
    return { ...deg, total: deg.out + deg.in }
  }

  isHighDegree(vertexId: string, threshold = 1000): boolean {
    return this.getDegree(vertexId).total > threshold
  }

  getStats(): { vertices: number; edges: number; reads: number; writes: number } {
    return {
      vertices: this.vertexCount,
      edges: this.edgeCount,
      reads: this.readCount,
      writes: this.writeCount,
    }
  }

  serialize(): Map<string, string | Uint8Array> {
    const rows = new Map<string, string | Uint8Array>()
    for (const [vertexId, edges] of this.outgoing) {
      rows.set('adj:' + vertexId, JSON.stringify(edges))
    }
    for (const [vertexId, edges] of this.incoming) {
      rows.set('rev:' + vertexId, JSON.stringify(edges))
    }
    for (const [vertexId, deg] of this.degrees) {
      rows.set('deg:' + vertexId, JSON.stringify(deg))
    }
    rows.set('_bloom:vertices', this.vertexBloom.serialize())
    rows.set('_bloom:edges', this.edgeBloom.serialize())
    rows.set('_stats', JSON.stringify({
      vertexCount: this.vertexCount,
      edgeCount: this.edgeCount,
    }))
    return rows
  }
}

// ============================================================================
// Graph Traversal Engine
// ============================================================================

export class GraphTraversalEngine {
  private index: AdjacencyIndex
  private stats: GraphQueryStats

  constructor(index: AdjacencyIndex) {
    this.index = index
    this.stats = this.initStats()
  }

  private initStats(): GraphQueryStats {
    return {
      parseTimeMs: 0,
      planTimeMs: 0,
      executeTimeMs: 0,
      totalTimeMs: 0,
      verticesVisited: 0,
      edgesTraversed: 0,
      indexLookups: 0,
      coldFetches: 0,
      cacheHits: 0,
    }
  }

  bfs(
    startVertices: string[],
    step: TraversalStep
  ): { vertices: string[]; paths: GraphPath[] } {
    const visited = new Set<string>()
    const result: string[] = []
    const paths: GraphPath[] = []
    
    let frontier: [string, GraphPath, number][] = startVertices.map(v => [
      v,
      { vertices: [v], edges: [], length: 0 },
      0,
    ])

    while (frontier.length > 0) {
      const nextFrontier: [string, GraphPath, number][] = []

      for (const [vertexId, path, depth] of frontier) {
        if (visited.has(vertexId)) continue
        visited.add(vertexId)
        this.stats.verticesVisited++

        if (depth >= step.minHops && depth <= step.maxHops) {
          result.push(vertexId)
          paths.push(path)
          
          if (step.limit && result.length >= step.limit) {
            return { vertices: result, paths }
          }
        }

        if (depth < step.maxHops) {
          const neighbors = this.index.getNeighbors(vertexId, step.direction, step.edgeTypes)
          this.stats.indexLookups++

          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              this.stats.edgesTraversed++
              nextFrontier.push([
                neighbor,
                {
                  vertices: [...path.vertices, neighbor],
                  edges: [...path.edges, vertexId + '->' + neighbor],
                  length: path.length + 1,
                },
                depth + 1,
              ])
            }
          }
        }
      }

      frontier = nextFrontier
    }

    return { vertices: result, paths }
  }

  pathExists(from: string, to: string, maxDepth = 6, edgeTypes?: string[]): boolean {
    if (!this.index.mightExist(from) || !this.index.mightExist(to)) {
      return false
    }

    if (this.index.mightHaveEdge(from, to)) {
      const outgoing = this.index.getOutgoing(from, edgeTypes)
      if (outgoing.some(e => e.to === to)) {
        return true
      }
    }

    const forwardVisited = new Set<string>([from])
    const backwardVisited = new Set<string>([to])
    let forwardFrontier = [from]
    let backwardFrontier = [to]

    for (let depth = 0; depth < maxDepth / 2; depth++) {
      const nextForward: string[] = []
      for (const v of forwardFrontier) {
        for (const neighbor of this.index.getNeighbors(v, 'out', edgeTypes)) {
          if (backwardVisited.has(neighbor)) return true
          if (!forwardVisited.has(neighbor)) {
            forwardVisited.add(neighbor)
            nextForward.push(neighbor)
          }
        }
      }
      forwardFrontier = nextForward

      const nextBackward: string[] = []
      for (const v of backwardFrontier) {
        for (const neighbor of this.index.getNeighbors(v, 'in', edgeTypes)) {
          if (forwardVisited.has(neighbor)) return true
          if (!backwardVisited.has(neighbor)) {
            backwardVisited.add(neighbor)
            nextBackward.push(neighbor)
          }
        }
      }
      backwardFrontier = nextBackward

      if (forwardFrontier.length === 0 && backwardFrontier.length === 0) {
        return false
      }
    }

    return false
  }

  shortestPath(
    from: string,
    to: string,
    maxDepth = 10,
    edgeTypes?: string[]
  ): GraphPath | null {
    if (from === to) {
      return { vertices: [from], edges: [], length: 0 }
    }

    const visited = new Map<string, GraphPath>()
    visited.set(from, { vertices: [from], edges: [], length: 0 })

    let frontier = [from]

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = []

      for (const v of frontier) {
        const currentPath = visited.get(v)!
        
        for (const edge of this.index.getOutgoing(v, edgeTypes)) {
          if (edge.to === to) {
            return {
              vertices: [...currentPath.vertices, to],
              edges: [...currentPath.edges, edge.relId],
              length: currentPath.length + 1,
            }
          }

          if (!visited.has(edge.to)) {
            visited.set(edge.to, {
              vertices: [...currentPath.vertices, edge.to],
              edges: [...currentPath.edges, edge.relId],
              length: currentPath.length + 1,
            })
            nextFrontier.push(edge.to)
          }
        }
      }

      frontier = nextFrontier
    }

    return null
  }

  allPaths(
    from: string,
    to: string,
    maxDepth = 5,
    maxPaths = 100,
    edgeTypes?: string[]
  ): GraphPath[] {
    const paths: GraphPath[] = []
    const stack: [string, GraphPath, Set<string>][] = [[
      from,
      { vertices: [from], edges: [], length: 0 },
      new Set([from]),
    ]]

    while (stack.length > 0 && paths.length < maxPaths) {
      const [current, path, visited] = stack.pop()!

      if (current === to && path.length > 0) {
        paths.push(path)
        continue
      }

      if (path.length >= maxDepth) continue

      for (const edge of this.index.getOutgoing(current, edgeTypes)) {
        if (!visited.has(edge.to)) {
          const newVisited = new Set(visited)
          newVisited.add(edge.to)
          stack.push([
            edge.to,
            {
              vertices: [...path.vertices, edge.to],
              edges: [...path.edges, edge.relId],
              length: path.length + 1,
            },
            newVisited,
          ])
        }
      }
    }

    return paths
  }

  nHopNeighbors(
    startVertex: string,
    n: number,
    direction: Direction = 'out',
    edgeTypes?: string[]
  ): Map<string, number> {
    const distances = new Map<string, number>()
    distances.set(startVertex, 0)

    let frontier = [startVertex]

    for (let hop = 1; hop <= n && frontier.length > 0; hop++) {
      const nextFrontier: string[] = []

      for (const v of frontier) {
        const neighbors = this.index.getNeighbors(v, direction, edgeTypes)
        
        for (const neighbor of neighbors) {
          if (!distances.has(neighbor)) {
            distances.set(neighbor, hop)
            nextFrontier.push(neighbor)
          }
        }
      }

      frontier = nextFrontier
    }

    distances.delete(startVertex)
    return distances
  }

  commonNeighbors(
    vertex1: string,
    vertex2: string,
    direction: Direction = 'out',
    edgeTypes?: string[]
  ): string[] {
    const neighbors1 = new Set(this.index.getNeighbors(vertex1, direction, edgeTypes))
    const neighbors2 = new Set(this.index.getNeighbors(vertex2, direction, edgeTypes))
    
    return Array.from(neighbors1).filter(n => neighbors2.has(n))
  }

  getStats(): GraphQueryStats {
    return { ...this.stats }
  }

  resetStats(): void {
    this.stats = this.initStats()
  }
}

// ============================================================================
// Cypher Parser (simplified)
// ============================================================================

export class CypherParser {
  parse(cypher: string): GraphQuery {
    const matchMatch = cypher.match(/MATCH\s+(.+?)(?:\s+WHERE|\s+RETURN|$)/i)
    if (!matchMatch) {
      throw new Error('Invalid Cypher: No MATCH clause found')
    }

    const pattern = matchMatch[1].trim()
    const parsed = this.parsePattern(pattern)

    const whereMatch = cypher.match(/WHERE\s+(.+?)(?:\s+RETURN|$)/i)
    const wherePredicates = whereMatch ? this.parseWhere(whereMatch[1]) : []

    const returnMatch = cypher.match(/RETURN\s+(.+?)$/i)
    const returnFields = returnMatch ? this.parseReturn(returnMatch[1]) : undefined

    const limitMatch = cypher.match(/LIMIT\s+(\d+)/i)
    const limit = limitMatch ? parseInt(limitMatch[1]) : undefined

    return {
      startVertices: this.buildStartFilter(parsed.start, wherePredicates),
      traversals: parsed.relationships.map(rel => ({
        direction: rel.direction,
        edgeTypes: rel.types,
        minHops: rel.minHops,
        maxHops: rel.maxHops,
        filter: rel.target.labels ? { types: rel.target.labels } : undefined,
      })),
      returnProperties: returnFields,
      limit,
    }
  }

  private parsePattern(pattern: string): {
    start: { variable?: string; labels?: string[]; properties?: Record<string, unknown> }
    relationships: {
      variable?: string
      types?: string[]
      direction: Direction
      minHops: number
      maxHops: number
      target: { variable?: string; labels?: string[] }
    }[]
  } {
    const nodes: { variable?: string; labels?: string[]; properties?: Record<string, unknown> }[] = []
    const relationships: {
      variable?: string
      types?: string[]
      direction: Direction
      minHops: number
      maxHops: number
      target: { variable?: string; labels?: string[] }
    }[] = []

    const nodeRegex = /\((\w+)?(?::(\w+))?(?:\s*\{([^}]+)\})?\)/g
    let match
    while ((match = nodeRegex.exec(pattern)) !== null) {
      nodes.push({
        variable: match[1],
        labels: match[2] ? [match[2]] : undefined,
        properties: match[3] ? this.parseProperties(match[3]) : undefined,
      })
    }

    const relMatches = pattern.matchAll(/-\[(\w+)?(?::(\w+))?(?:\*(\d+)?\.\.(\d+)?)?\]->/g)
    let idx = 0
    for (const relMatch of relMatches) {
      relationships.push({
        variable: relMatch[1],
        types: relMatch[2] ? [relMatch[2]] : undefined,
        direction: 'out',
        minHops: relMatch[3] ? parseInt(relMatch[3]) : 1,
        maxHops: relMatch[4] ? parseInt(relMatch[4]) : 1,
        target: nodes[idx + 1] ?? { variable: 'b' },
      })
      idx++
    }

    return {
      start: nodes[0] ?? { variable: 'a' },
      relationships,
    }
  }

  private parseProperties(propsStr: string): Record<string, unknown> {
    const props: Record<string, unknown> = {}
    const pairs = propsStr.split(',')
    
    for (const pair of pairs) {
      const [key, value] = pair.split(':').map(s => s.trim())
      if (key && value) {
        if (value.startsWith("'") && value.endsWith("'")) {
          props[key] = value.slice(1, -1)
        } else if (value === 'true') {
          props[key] = true
        } else if (value === 'false') {
          props[key] = false
        } else if (!isNaN(Number(value))) {
          props[key] = Number(value)
        } else {
          props[key] = value
        }
      }
    }
    
    return props
  }

  private parseWhere(whereClause: string): Predicate[] {
    const predicates: Predicate[] = []
    const conditions = whereClause.split(/\s+AND\s+/i)

    for (const condition of conditions) {
      const eqMatch = condition.match(/(\w+\.\w+)\s*=\s*['"]?([^'"]+)['"]?/)
      if (eqMatch) {
        predicates.push({
          field: eqMatch[1],
          op: '=',
          value: eqMatch[2],
        })
      }
    }

    return predicates
  }

  private parseReturn(returnClause: string): string[] {
    return returnClause.split(',').map(f => f.trim())
  }

  private buildStartFilter(
    node: { variable?: string; labels?: string[]; properties?: Record<string, unknown> },
    predicates: Predicate[]
  ): VertexFilter {
    const filter: VertexFilter = {}
    
    if (node.labels) {
      filter.types = node.labels
    }
    
    if (node.properties) {
      filter.predicates = Object.entries(node.properties).map(([field, value]) => ({
        field,
        op: '=' as const,
        value,
      }))
    }

    if (predicates.length > 0) {
      filter.predicates = [...(filter.predicates ?? []), ...predicates]
    }

    return filter
  }
}

// ============================================================================
// MongoDB $graphLookup Support
// ============================================================================

export interface GraphLookupSpec {
  from: string
  startWith: string
  connectFromField: string
  connectToField: string
  as: string
  maxDepth?: number
  depthField?: string
  restrictSearchWithMatch?: Record<string, unknown>
}

export class MongoGraphLookup {
  private engine: GraphTraversalEngine

  constructor(engine: GraphTraversalEngine) {
    this.engine = engine
  }

  execute(
    docs: Record<string, unknown>[],
    spec: GraphLookupSpec
  ): Record<string, unknown>[] {
    const maxDepth = spec.maxDepth ?? 10

    return docs.map(doc => {
      const startValue = this.getField(doc, spec.startWith)
      if (!startValue) return { ...doc, [spec.as]: [] }

      const startId = typeof startValue === 'string' ? startValue : String(startValue)
      
      const { vertices, paths } = this.engine.bfs([startId], {
        direction: 'out',
        minHops: 1,
        maxHops: maxDepth,
      })

      const results = vertices.map((v, i) => {
        const result: Record<string, unknown> = { _id: v }
        if (spec.depthField) {
          result[spec.depthField] = paths[i]?.length ?? 0
        }
        return result
      })

      return { ...doc, [spec.as]: results }
    })
  }

  private getField(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.replace('$', '').split('.')
    let current: unknown = obj
    
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }
    
    return current
  }
}

// ============================================================================
// Bloom Filter
// ============================================================================

export class BloomFilter {
  private bits: Uint8Array
  private hashCount: number
  private size: number

  constructor(expectedItems: number, fpr = 0.01) {
    this.size = Math.ceil((-expectedItems * Math.log(fpr)) / Math.log(2) ** 2)
    this.hashCount = Math.ceil((this.size / expectedItems) * Math.log(2))
    this.bits = new Uint8Array(Math.ceil(this.size / 8))
  }

  private hash(value: string, seed: number): number {
    let h = seed
    for (let i = 0; i < value.length; i++) {
      h = ((h * 31 + value.charCodeAt(i)) >>> 0)
    }
    return h % this.size
  }

  add(value: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(value, i)
      this.bits[Math.floor(idx / 8)] |= 1 << idx % 8
    }
  }

  mightContain(value: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(value, i)
      if (!(this.bits[Math.floor(idx / 8)] & (1 << idx % 8))) {
        return false
      }
    }
    return true
  }

  serialize(): Uint8Array {
    const header = new Uint8Array(8)
    const view = new DataView(header.buffer)
    view.setUint32(0, this.size, true)
    view.setUint32(4, this.hashCount, true)
    const result = new Uint8Array(header.length + this.bits.length)
    result.set(header)
    result.set(this.bits, header.length)
    return result
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

export function generateSocialGraph(
  userCount: number,
  avgFollows: number
): { things: Thing[]; relationships: Relationship[] } {
  const things: Thing[] = []
  const relationships: Relationship[] = []

  for (let i = 0; i < userCount; i++) {
    things.push({
      id: 'user-' + i,
      type: 'User',
      ns: 'social',
      data: {
        name: 'User ' + i,
        email: 'user' + i + '@example.com',
        verified: i % 10 === 0,
      },
      createdAt: Date.now() - i * 86400000,
      updatedAt: Date.now(),
    })
  }

  for (let i = 1; i < userCount; i++) {
    const followCount = Math.min(
      Math.floor(Math.random() * avgFollows * 2) + 1,
      i
    )
    
    const following = new Set<number>()
    while (following.size < followCount) {
      const target = Math.floor(Math.random() ** 2 * i)
      if (target !== i) {
        following.add(target)
      }
    }

    for (const target of following) {
      relationships.push({
        id: 'follows-' + i + '-' + target,
        type: 'FOLLOWS',
        from: 'user-' + i,
        to: 'user-' + target,
        createdAt: Date.now() - Math.random() * 30 * 86400000,
      })
    }
  }

  return { things, relationships }
}

export function graphCostAnalysis(
  vertexCount: number,
  edgeCount: number,
  avgDegree: number
): {
  query: string
  withoutIndex: { operations: number; estimatedMs: number }
  withIndex: { operations: number; estimatedMs: number }
  savings: string
}[] {
  const pct = (val: number) => Math.round(val * 100) + '%'
  
  return [
    {
      query: '1-hop neighbors',
      withoutIndex: { operations: edgeCount, estimatedMs: edgeCount * 0.001 },
      withIndex: { operations: avgDegree, estimatedMs: avgDegree * 0.0001 },
      savings: pct(1 - avgDegree / edgeCount),
    },
    {
      query: '2-hop neighbors',
      withoutIndex: { operations: edgeCount * 2, estimatedMs: edgeCount * 2 * 0.001 },
      withIndex: { operations: avgDegree ** 2, estimatedMs: avgDegree ** 2 * 0.0001 },
      savings: pct(1 - (avgDegree ** 2) / (edgeCount * 2)),
    },
    {
      query: 'Path exists (depth 4)',
      withoutIndex: { operations: edgeCount * 4, estimatedMs: edgeCount * 4 * 0.001 },
      withIndex: { operations: avgDegree ** 2, estimatedMs: avgDegree ** 2 * 0.0001 },
      savings: pct(1 - (avgDegree ** 2) / (edgeCount * 4)),
    },
    {
      query: 'Shortest path',
      withoutIndex: { operations: vertexCount * edgeCount, estimatedMs: vertexCount * edgeCount * 0.00001 },
      withIndex: { operations: vertexCount * avgDegree, estimatedMs: vertexCount * avgDegree * 0.0001 },
      savings: pct(1 - avgDegree / edgeCount),
    },
    {
      query: 'Common neighbors',
      withoutIndex: { operations: edgeCount * 2, estimatedMs: edgeCount * 2 * 0.001 },
      withIndex: { operations: avgDegree * 2, estimatedMs: avgDegree * 2 * 0.0001 },
      savings: pct(1 - avgDegree / edgeCount),
    },
  ]
}
