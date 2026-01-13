/**
 * @module db/schema/cascade/cached-generator
 *
 * CachedCascadeGenerator - Generates entities with caching to reduce redundant generation.
 *
 * This generator supports content-hash and fuzzy matching strategies to deduplicate
 * entities and reduce redundant AI calls.
 */

export interface CachedGeneratorConfig {
  cacheEnabled: boolean
  cacheStrategy?: 'content-hash' | 'fuzzy'
  similarityThreshold?: number // For fuzzy matching (0-1)
}

export interface GenerateOptions {
  type: string
  content: Record<string, unknown>
}

export interface CachedEntity {
  id: string
  type: string
  content: Record<string, unknown>
  fromCache: boolean
  metrics: {
    cacheHit: boolean
    fuzzyMatch?: boolean
    similarity?: number
  }
}

export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  totalLookups: number
}

/**
 * Simple hash function for content
 */
function hashContent(content: Record<string, unknown>): string {
  return JSON.stringify(content)
    .split('')
    .reduce((hash, char) => {
      const chr = char.charCodeAt(0)
      hash = ((hash << 5) - hash) + chr
      hash |= 0 // Convert to 32-bit integer
      return hash
    }, 0)
    .toString(16)
}

/**
 * Common synonyms for fuzzy matching
 */
const SYNONYM_MAP: Record<string, string> = {
  // Problem/Issue synonyms
  'problem': 'issue',
  'problems': 'issues',
  'issue': 'issue',
  'issues': 'issues',
  'challenge': 'issue',
  'challenges': 'issues',
  'difficulty': 'issue',
  'difficulties': 'issues',
  // Solution synonyms
  'solution': 'solution',
  'solutions': 'solutions',
  'answer': 'solution',
  'answers': 'solutions',
  'fix': 'solution',
  'fixes': 'solutions',
  // User synonyms
  'user': 'user',
  'users': 'users',
  'customer': 'user',
  'customers': 'users',
  'client': 'user',
  'clients': 'users',
}

/**
 * Normalize text using synonyms
 */
function normalizeSynonyms(text: string): string {
  return text.split(/\s+/).map(word => {
    const lower = word.toLowerCase()
    return SYNONYM_MAP[lower] || lower
  }).join(' ')
}

/**
 * Extract values from JSON object for comparison
 */
function extractValues(obj: Record<string, unknown>): string {
  const values: string[] = []
  for (const value of Object.values(obj)) {
    if (typeof value === 'string') {
      values.push(value)
    } else if (typeof value === 'number') {
      values.push(String(value))
    } else if (value && typeof value === 'object') {
      values.push(extractValues(value as Record<string, unknown>))
    }
  }
  return values.join(' ')
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length
  const n = s2.length

  if (m === 0) return n
  if (n === 0) return m

  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      )
    }
  }

  return dp[m][n]
}

/**
 * Calculate similarity between two content objects
 * Uses combination of Levenshtein ratio, Jaccard, and bigram Dice
 */
function calculateSimilarity(str1: string, str2: string): number {
  // Try to parse as JSON and compare values only (ignore keys)
  let content1 = str1
  let content2 = str2

  try {
    const obj1 = JSON.parse(str1)
    const obj2 = JSON.parse(str2)
    content1 = extractValues(obj1)
    content2 = extractValues(obj2)
  } catch {
    // Not JSON, use raw strings
  }

  // Normalize strings and apply synonym mapping
  const norm1 = normalizeSynonyms(content1.toLowerCase().replace(/[^a-z0-9\s]/g, ' '))
  const norm2 = normalizeSynonyms(content2.toLowerCase().replace(/[^a-z0-9\s]/g, ' '))

  // Levenshtein similarity ratio
  const clean1 = norm1.replace(/\s+/g, '')
  const clean2 = norm2.replace(/\s+/g, '')
  const maxLen = Math.max(clean1.length, clean2.length)
  const levenshteinSim = maxLen > 0
    ? 1 - (levenshteinDistance(clean1, clean2) / maxLen)
    : 1

  // Jaccard word similarity
  const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 0))
  const words2 = new Set(norm2.split(/\s+/).filter(w => w.length > 0))

  const intersection = new Set([...words1].filter(x => words2.has(x)))
  const union = new Set([...words1, ...words2])

  const jaccardSim = union.size > 0 ? intersection.size / union.size : 0

  // Character-level similarity (Dice coefficient on bigrams)
  const bigrams1 = new Set<string>()
  const bigrams2 = new Set<string>()

  for (let i = 0; i < clean1.length - 1; i++) {
    bigrams1.add(clean1.slice(i, i + 2))
  }
  for (let i = 0; i < clean2.length - 1; i++) {
    bigrams2.add(clean2.slice(i, i + 2))
  }

  const bigramIntersection = [...bigrams1].filter(x => bigrams2.has(x)).length
  const diceSim = (bigrams1.size + bigrams2.size) > 0
    ? (2 * bigramIntersection) / (bigrams1.size + bigrams2.size)
    : 0

  // Weighted combination - Levenshtein is most forgiving for small edits
  return (levenshteinSim * 0.5) + (jaccardSim * 0.2) + (diceSim * 0.3)
}

/**
 * CachedCascadeGenerator - Generates entities with caching
 */
export class CachedCascadeGenerator {
  private config: CachedGeneratorConfig
  private cache: Map<string, CachedEntity> = new Map()
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    totalLookups: 0,
  }
  private entityCounter: number = 0

  constructor(config: CachedGeneratorConfig) {
    this.config = {
      cacheStrategy: 'content-hash',
      similarityThreshold: 0.85,
      ...config,
    }
  }

  /**
   * Generate a single entity with caching
   */
  async generate(options: GenerateOptions): Promise<CachedEntity> {
    const { type, content } = options
    this.stats.totalLookups++

    if (!this.config.cacheEnabled) {
      return this.createNewEntity(type, content)
    }

    if (this.config.cacheStrategy === 'content-hash') {
      return this.generateWithContentHash(type, content)
    } else {
      return this.generateWithFuzzyMatch(type, content)
    }
  }

  /**
   * Generate using content hash caching
   */
  private async generateWithContentHash(type: string, content: Record<string, unknown>): Promise<CachedEntity> {
    const hash = hashContent(content)
    const cacheKey = `${type}:${hash}`

    if (this.cache.has(cacheKey)) {
      this.stats.hits++
      this.updateHitRate()
      const cached = this.cache.get(cacheKey)!
      return {
        ...cached,
        fromCache: true,
        metrics: {
          cacheHit: true,
        },
      }
    }

    this.stats.misses++
    this.updateHitRate()

    const entity = this.createNewEntity(type, content)
    this.cache.set(cacheKey, entity)
    return entity
  }

  /**
   * Generate using fuzzy matching
   */
  private async generateWithFuzzyMatch(type: string, content: Record<string, unknown>): Promise<CachedEntity> {
    const contentStr = JSON.stringify(content)
    const threshold = this.config.similarityThreshold || 0.85

    // Check for fuzzy matches
    for (const [key, cached] of this.cache.entries()) {
      if (!key.startsWith(`${type}:`)) continue

      const cachedStr = JSON.stringify(cached.content)
      const similarity = calculateSimilarity(contentStr, cachedStr)

      if (similarity >= threshold) {
        this.stats.hits++
        this.updateHitRate()
        return {
          ...cached,
          fromCache: true,
          metrics: {
            cacheHit: true,
            fuzzyMatch: true,
            similarity,
          },
        }
      }
    }

    this.stats.misses++
    this.updateHitRate()

    const entity = this.createNewEntity(type, content)
    const hash = hashContent(content)
    this.cache.set(`${type}:${hash}`, entity)
    return entity
  }

  /**
   * Generate multiple entities in batch
   */
  async generateBatch(options: GenerateOptions[]): Promise<CachedEntity[]> {
    const results: CachedEntity[] = []
    for (const opt of options) {
      const entity = await this.generate(opt)
      results.push(entity)
    }
    return results
  }

  /**
   * Create a new entity
   */
  private createNewEntity(type: string, content: Record<string, unknown>): CachedEntity {
    this.entityCounter++
    return {
      id: `${type.toLowerCase()}-${this.entityCounter}`,
      type,
      content,
      fromCache: false,
      metrics: {
        cacheHit: false,
      },
    }
  }

  /**
   * Update hit rate statistic
   */
  private updateHitRate(): void {
    this.stats.hitRate = this.stats.totalLookups > 0
      ? this.stats.hits / this.stats.totalLookups
      : 0
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear()
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalLookups: 0,
    }
  }
}

export default CachedCascadeGenerator
