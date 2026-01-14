import { describe, it, expect } from 'vitest'
import {
  generateFullPackfile,
  FullPackGenerator,
  FullPackOptions,
  PackableObjectSet,
  GeneratedFullPack,
  optimizeDeltaChains,
  DeltaChainOptimizer,
  DeltaChainConfig,
  OptimizedDeltaChain,
  PackOrderingStrategy,
  applyOrderingStrategy,
  OrderingStrategyConfig,
  OrderedObjectSet,
  LargeRepositoryHandler,
  LargeRepoConfig,
  StreamingPackWriter,
  IncrementalPackUpdater,
  IncrementalUpdateOptions,
  IncrementalPackResult,
  PackGenerationProgress,
  computeObjectDependencies,
  ObjectDependencyGraph,
  selectOptimalBases,
  BaseSelectionResult,
  validatePackIntegrity,
  PackValidationResult
} from '../../src/pack/full-generation'
import { PackObjectType } from '../../src/pack/format'

// Helper functions
const encoder = new TextEncoder()

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function createTestSha(prefix: string): string {
  // Convert string to hex representation, then pad with zeros
  const hexPrefix = Array.from(prefix).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return hexPrefix.slice(0, 40).padEnd(40, '0')
}

function createRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

describe('Full Packfile Generation', () => {
  describe('Complete pack from object set', () => {
    describe('generateFullPackfile', () => {
      it('should generate a complete packfile from an object set', () => {
        const objectSet: PackableObjectSet = {
          objects: [
            {
              sha: createTestSha('blob1'),
              type: PackObjectType.OBJ_BLOB,
              data: encoder.encode('Hello, World!')
            },
            {
              sha: createTestSha('blob2'),
              type: PackObjectType.OBJ_BLOB,
              data: encoder.encode('Goodbye, World!')
            },
            {
              sha: createTestSha('tree1'),
              type: PackObjectType.OBJ_TREE,
              data: new Uint8Array([0x31, 0x30, 0x30, 0x36, 0x34, 0x34])
            }
          ]
        }

        const result = generateFullPackfile(objectSet)

        expect(result).toBeInstanceOf(Uint8Array)
        // Verify PACK header
        expect(String.fromCharCode(result[0], result[1], result[2], result[3])).toBe('PACK')
        // Verify version 2
        expect(result[7]).toBe(2)
        // Verify object count (3 objects)
        expect(result[11]).toBe(3)
      })

      it('should include all reachable objects in the pack', () => {
        // Create a commit with tree and blob dependencies
        const blobSha = createTestSha('blob')
        const treeSha = createTestSha('tree')
        const commitSha = createTestSha('commit')

        const objectSet: PackableObjectSet = {
          objects: [
            {
              sha: blobSha,
              type: PackObjectType.OBJ_BLOB,
              data: encoder.encode('file content')
            },
            {
              sha: treeSha,
              type: PackObjectType.OBJ_TREE,
              data: encoder.encode(`100644 file.txt\0${hexToBytes(blobSha).slice(0, 20)}`)
            },
            {
              sha: commitSha,
              type: PackObjectType.OBJ_COMMIT,
              data: encoder.encode(`tree ${treeSha}\nauthor Test <test@test.com> 1234567890 +0000\n\nInitial commit`)
            }
          ],
          roots: [commitSha]
        }

        const result = generateFullPackfile(objectSet)

        expect(result).toBeInstanceOf(Uint8Array)
        // All objects should be included
        const objectCount = (result[8] << 24) | (result[9] << 16) | (result[10] << 8) | result[11]
        expect(objectCount).toBe(3)
      })

      it('should handle object set with duplicate references', () => {
        const sharedBlobSha = createTestSha('shared')

        const objectSet: PackableObjectSet = {
          objects: [
            {
              sha: sharedBlobSha,
              type: PackObjectType.OBJ_BLOB,
              data: encoder.encode('shared content')
            },
            {
              sha: createTestSha('tree1'),
              type: PackObjectType.OBJ_TREE,
              data: encoder.encode('tree referencing shared')
            },
            {
              sha: createTestSha('tree2'),
              type: PackObjectType.OBJ_TREE,
              data: encoder.encode('another tree referencing shared')
            }
          ]
        }

        const result = generateFullPackfile(objectSet)

        // Should only have 3 unique objects despite multiple references
        const objectCount = (result[8] << 24) | (result[9] << 16) | (result[10] << 8) | result[11]
        expect(objectCount).toBe(3)
      })

      it('should preserve object integrity through pack generation', () => {
        const originalData = encoder.encode('test content for integrity check')
        const objectSet: PackableObjectSet = {
          objects: [
            {
              sha: createTestSha('integrity'),
              type: PackObjectType.OBJ_BLOB,
              data: originalData
            }
          ]
        }

        const result = generateFullPackfile(objectSet)

        // Should have valid checksum (last 20 bytes)
        expect(result.length).toBeGreaterThan(32) // header + checksum minimum
        const checksum = result.slice(-20)
        expect(checksum.length).toBe(20)
      })

      it('should handle empty object set', () => {
        const objectSet: PackableObjectSet = {
          objects: []
        }

        const result = generateFullPackfile(objectSet)

        expect(result).toBeInstanceOf(Uint8Array)
        // Should still have valid header + checksum
        expect(result.length).toBe(32) // 12 header + 20 checksum
      })

      it('should generate consistent output for same input', () => {
        const objectSet: PackableObjectSet = {
          objects: [
            {
              sha: createTestSha('deterministic'),
              type: PackObjectType.OBJ_BLOB,
              data: encoder.encode('deterministic content')
            }
          ]
        }

        const result1 = generateFullPackfile(objectSet)
        const result2 = generateFullPackfile(objectSet)

        expect(bytesToHex(result1)).toBe(bytesToHex(result2))
      })
    })

    describe('FullPackGenerator class', () => {
      it('should create generator with default configuration', () => {
        const generator = new FullPackGenerator()

        expect(generator).toBeInstanceOf(FullPackGenerator)
        expect(generator.objectCount).toBe(0)
      })

      it('should accept custom options', () => {
        const options: FullPackOptions = {
          enableDeltaCompression: true,
          maxDeltaDepth: 50,
          windowSize: 16,
          compressionLevel: 9,
          orderingStrategy: PackOrderingStrategy.RECENCY
        }

        const generator = new FullPackGenerator(options)

        expect(generator).toBeInstanceOf(FullPackGenerator)
      })

      it('should add objects from multiple sources', () => {
        const generator = new FullPackGenerator()

        generator.addObject({
          sha: createTestSha('obj1'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('content1')
        })

        generator.addObjectSet({
          objects: [
            { sha: createTestSha('obj2'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('content2') },
            { sha: createTestSha('obj3'), type: PackObjectType.OBJ_TREE, data: new Uint8Array([1, 2, 3]) }
          ]
        })

        expect(generator.objectCount).toBe(3)
      })

      it('should track progress during generation', () => {
        const generator = new FullPackGenerator()
        const progressUpdates: PackGenerationProgress[] = []

        generator.onProgress((progress) => {
          progressUpdates.push({ ...progress })
        })

        for (let i = 0; i < 10; i++) {
          generator.addObject({
            sha: createTestSha(`obj${i}`),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode(`content ${i}`)
          })
        }

        const result = generator.generate()

        expect(result.packData).toBeInstanceOf(Uint8Array)
        expect(progressUpdates.length).toBeGreaterThan(0)
        expect(progressUpdates[progressUpdates.length - 1].phase).toBe('complete')
      })

      it('should generate complete pack with statistics', () => {
        const generator = new FullPackGenerator({ enableDeltaCompression: true })

        generator.addObject({
          sha: createTestSha('base'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('base content for testing')
        })
        generator.addObject({
          sha: createTestSha('derived'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('base content for testing with modifications')
        })

        const result: GeneratedFullPack = generator.generate()

        expect(result.packData).toBeInstanceOf(Uint8Array)
        expect(result.checksum).toBeInstanceOf(Uint8Array)
        expect(result.stats.totalObjects).toBe(2)
        expect(result.stats.totalSize).toBeGreaterThan(0)
        expect(result.stats.compressedSize).toBeGreaterThan(0)
        expect(typeof result.stats.deltaObjects).toBe('number')
        expect(typeof result.stats.compressionRatio).toBe('number')
      })
    })
  })

  describe('Delta chain optimization', () => {
    describe('optimizeDeltaChains', () => {
      it('should optimize delta chains for similar objects', () => {
        const objects = [
          {
            sha: createTestSha('v1'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('version 1 of the file with some content')
          },
          {
            sha: createTestSha('v2'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('version 2 of the file with some content and changes')
          },
          {
            sha: createTestSha('v3'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('version 3 of the file with some content and more changes')
          }
        ]

        const optimized = optimizeDeltaChains(objects)

        expect(optimized.chains.length).toBeGreaterThan(0)
        expect(optimized.totalSavings).toBeGreaterThan(0)
      })

      it('should respect maximum delta depth', () => {
        const config: DeltaChainConfig = {
          maxDepth: 3,
          minSavingsThreshold: 0.1
        }

        const objects = []
        for (let i = 0; i < 10; i++) {
          objects.push({
            sha: createTestSha(`obj${i}`),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode(`content version ${i} with incremental changes`)
          })
        }

        const optimized = optimizeDeltaChains(objects, config)

        // No chain should exceed max depth
        for (const chain of optimized.chains) {
          expect(chain.depth).toBeLessThanOrEqual(3)
        }
      })

      it('should avoid delta for incompressible pairs', () => {
        const objects = [
          {
            sha: createTestSha('random1'),
            type: PackObjectType.OBJ_BLOB,
            data: createRandomBytes(1000)
          },
          {
            sha: createTestSha('random2'),
            type: PackObjectType.OBJ_BLOB,
            data: createRandomBytes(1000)
          }
        ]

        const optimized = optimizeDeltaChains(objects)

        // Random data should not form delta chains
        expect(optimized.chains.filter(c => c.depth > 0).length).toBe(0)
      })

      it('should select optimal base objects', () => {
        const baseContent = encoder.encode('this is the base content that will be used')
        const objects = [
          {
            sha: createTestSha('base'),
            type: PackObjectType.OBJ_BLOB,
            data: baseContent
          },
          {
            sha: createTestSha('derived1'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('this is the base content that will be used with addition 1')
          },
          {
            sha: createTestSha('derived2'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('this is the base content that will be used with addition 2')
          }
        ]

        const optimized = optimizeDeltaChains(objects)

        // Base should be identified as optimal base for both derived objects
        expect(optimized.baseSelections.get(createTestSha('derived1'))).toBe(createTestSha('base'))
        expect(optimized.baseSelections.get(createTestSha('derived2'))).toBe(createTestSha('base'))
      })
    })

    describe('DeltaChainOptimizer class', () => {
      it('should build optimal delta chain graph', () => {
        const optimizer = new DeltaChainOptimizer()

        optimizer.addObject({
          sha: createTestSha('a'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('content a')
        })
        optimizer.addObject({
          sha: createTestSha('b'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('content a with b modifications')
        })

        const graph = optimizer.buildGraph()

        expect(graph.nodes.length).toBe(2)
        expect(graph.edges.length).toBeGreaterThanOrEqual(0)
      })

      it('should compute delta savings for each pair', () => {
        const optimizer = new DeltaChainOptimizer({
          windowSize: 10,
          minMatchLength: 4
        })

        const base = encoder.encode('the quick brown fox jumps over the lazy dog')
        const derived = encoder.encode('the quick brown cat jumps over the lazy dog')

        optimizer.addObject({
          sha: createTestSha('base'),
          type: PackObjectType.OBJ_BLOB,
          data: base
        })
        optimizer.addObject({
          sha: createTestSha('derived'),
          type: PackObjectType.OBJ_BLOB,
          data: derived
        })

        const savings = optimizer.computeSavings()

        expect(savings.get(createTestSha('derived'))).toBeGreaterThan(0)
      })

      it('should handle type-specific delta constraints', () => {
        const optimizer = new DeltaChainOptimizer()

        // Commits should not delta against blobs
        optimizer.addObject({
          sha: createTestSha('blob'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('blob content')
        })
        optimizer.addObject({
          sha: createTestSha('commit'),
          type: PackObjectType.OBJ_COMMIT,
          data: encoder.encode('tree abc\nauthor x <x> 1 +0\n\nmsg')
        })

        const chains = optimizer.optimize()

        // Should not have cross-type delta chains
        for (const chain of chains.chains) {
          if (chain.depth > 0) {
            expect(chain.baseType).toBe(chain.objectType)
          }
        }
      })

      it('should recompute chains when objects are added', () => {
        const optimizer = new DeltaChainOptimizer()

        optimizer.addObject({
          sha: createTestSha('a'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('content')
        })

        const chains1 = optimizer.optimize()

        optimizer.addObject({
          sha: createTestSha('b'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('content with more')
        })

        const chains2 = optimizer.optimize()

        // Adding similar object should change optimization
        expect(chains2.totalSavings).toBeGreaterThanOrEqual(chains1.totalSavings)
      })
    })

    describe('selectOptimalBases', () => {
      it('should select bases that minimize total pack size', () => {
        const objects = [
          {
            sha: createTestSha('large'),
            type: PackObjectType.OBJ_BLOB,
            data: new Uint8Array(10000).fill(0x41)
          },
          {
            sha: createTestSha('small'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('small')
          },
          {
            sha: createTestSha('derived'),
            type: PackObjectType.OBJ_BLOB,
            data: new Uint8Array(10000).fill(0x41).map((b, i) => i < 100 ? 0x42 : b)
          }
        ]

        const result: BaseSelectionResult = selectOptimalBases(objects)

        // Derived should use large as base (more similar)
        expect(result.selections.get(createTestSha('derived'))).toBe(createTestSha('large'))
      })

      it('should consider path hints for base selection', () => {
        const objects = [
          {
            sha: createTestSha('old'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('function foo() { return 1; }'),
            path: 'src/main.ts'
          },
          {
            sha: createTestSha('new'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('function foo() { return 2; }'),
            path: 'src/main.ts'
          },
          {
            sha: createTestSha('unrelated'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('function bar() { return 1; }'),
            path: 'src/other.ts'
          }
        ]

        const result = selectOptimalBases(objects, { preferSamePath: true })

        // Should prefer same-path objects as bases
        expect(result.selections.get(createTestSha('new'))).toBe(createTestSha('old'))
      })
    })
  })

  describe('Pack ordering strategies', () => {
    describe('PackOrderingStrategy enum', () => {
      it('should have expected ordering strategies', () => {
        expect(PackOrderingStrategy.TYPE_FIRST).toBeDefined()
        expect(PackOrderingStrategy.SIZE_DESCENDING).toBeDefined()
        expect(PackOrderingStrategy.RECENCY).toBeDefined()
        expect(PackOrderingStrategy.PATH_BASED).toBeDefined()
        expect(PackOrderingStrategy.DELTA_OPTIMIZED).toBeDefined()
      })
    })

    describe('applyOrderingStrategy', () => {
      it('should order objects by type (commits, trees, blobs, tags)', () => {
        const objects = [
          { sha: createTestSha('blob'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('blob') },
          { sha: createTestSha('commit'), type: PackObjectType.OBJ_COMMIT, data: encoder.encode('commit') },
          { sha: createTestSha('tree'), type: PackObjectType.OBJ_TREE, data: new Uint8Array([1, 2, 3]) },
          { sha: createTestSha('tag'), type: PackObjectType.OBJ_TAG, data: encoder.encode('tag') }
        ]

        const ordered: OrderedObjectSet = applyOrderingStrategy(objects, PackOrderingStrategy.TYPE_FIRST)

        // Standard git order: commits first, then trees, then blobs, then tags
        expect(ordered.objects[0].type).toBe(PackObjectType.OBJ_COMMIT)
        expect(ordered.objects[1].type).toBe(PackObjectType.OBJ_TREE)
        expect(ordered.objects[2].type).toBe(PackObjectType.OBJ_BLOB)
        expect(ordered.objects[3].type).toBe(PackObjectType.OBJ_TAG)
      })

      it('should order objects by size descending', () => {
        const objects = [
          { sha: createTestSha('small'), type: PackObjectType.OBJ_BLOB, data: new Uint8Array(100) },
          { sha: createTestSha('large'), type: PackObjectType.OBJ_BLOB, data: new Uint8Array(10000) },
          { sha: createTestSha('medium'), type: PackObjectType.OBJ_BLOB, data: new Uint8Array(1000) }
        ]

        const ordered = applyOrderingStrategy(objects, PackOrderingStrategy.SIZE_DESCENDING)

        expect(ordered.objects[0].sha).toBe(createTestSha('large'))
        expect(ordered.objects[1].sha).toBe(createTestSha('medium'))
        expect(ordered.objects[2].sha).toBe(createTestSha('small'))
      })

      it('should order objects by recency when timestamps provided', () => {
        const objects = [
          {
            sha: createTestSha('old'),
            type: PackObjectType.OBJ_COMMIT,
            data: encoder.encode('commit'),
            timestamp: 1000
          },
          {
            sha: createTestSha('new'),
            type: PackObjectType.OBJ_COMMIT,
            data: encoder.encode('commit'),
            timestamp: 3000
          },
          {
            sha: createTestSha('mid'),
            type: PackObjectType.OBJ_COMMIT,
            data: encoder.encode('commit'),
            timestamp: 2000
          }
        ]

        const ordered = applyOrderingStrategy(objects, PackOrderingStrategy.RECENCY)

        // Most recent first
        expect(ordered.objects[0].sha).toBe(createTestSha('new'))
        expect(ordered.objects[1].sha).toBe(createTestSha('mid'))
        expect(ordered.objects[2].sha).toBe(createTestSha('old'))
      })

      it('should order objects by path for delta efficiency', () => {
        const objects = [
          { sha: createTestSha('z'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('z'), path: 'z.txt' },
          { sha: createTestSha('a'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('a'), path: 'a.txt' },
          { sha: createTestSha('m'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('m'), path: 'm.txt' }
        ]

        const ordered = applyOrderingStrategy(objects, PackOrderingStrategy.PATH_BASED)

        // Should be ordered by path
        expect(ordered.objects[0].path).toBe('a.txt')
        expect(ordered.objects[1].path).toBe('m.txt')
        expect(ordered.objects[2].path).toBe('z.txt')
      })

      it('should apply delta-optimized ordering', () => {
        const objects = [
          { sha: createTestSha('base'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('base content') },
          { sha: createTestSha('delta1'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('base content extended') },
          { sha: createTestSha('delta2'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('base content more') }
        ]

        const config: OrderingStrategyConfig = {
          deltaChains: new Map([
            [createTestSha('delta1'), createTestSha('base')],
            [createTestSha('delta2'), createTestSha('base')]
          ])
        }

        const ordered = applyOrderingStrategy(objects, PackOrderingStrategy.DELTA_OPTIMIZED, config)

        // Base objects should come before their deltas
        const baseIndex = ordered.objects.findIndex(o => o.sha === createTestSha('base'))
        const delta1Index = ordered.objects.findIndex(o => o.sha === createTestSha('delta1'))
        const delta2Index = ordered.objects.findIndex(o => o.sha === createTestSha('delta2'))

        expect(baseIndex).toBeLessThan(delta1Index)
        expect(baseIndex).toBeLessThan(delta2Index)
      })

      it('should handle mixed ordering with configuration', () => {
        const objects = [
          { sha: createTestSha('a'), type: PackObjectType.OBJ_BLOB, data: new Uint8Array(100), path: 'src/a.ts' },
          { sha: createTestSha('b'), type: PackObjectType.OBJ_TREE, data: new Uint8Array(50), path: 'src' },
          { sha: createTestSha('c'), type: PackObjectType.OBJ_COMMIT, data: new Uint8Array(200) }
        ]

        const config: OrderingStrategyConfig = {
          primaryStrategy: PackOrderingStrategy.TYPE_FIRST,
          secondaryStrategy: PackOrderingStrategy.SIZE_DESCENDING
        }

        const ordered = applyOrderingStrategy(objects, PackOrderingStrategy.TYPE_FIRST, config)

        // Type first, then size within type
        expect(ordered.objects.length).toBe(3)
      })
    })
  })

  describe('Large repository handling', () => {
    describe('LargeRepositoryHandler', () => {
      it('should handle repositories with many objects', () => {
        const handler = new LargeRepositoryHandler()
        const objects = []

        for (let i = 0; i < 10000; i++) {
          objects.push({
            sha: i.toString(16).padStart(40, '0'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode(`object content ${i}`)
          })
        }

        handler.setObjects(objects)
        const result = handler.generatePack()

        expect(result.packData).toBeInstanceOf(Uint8Array)
        expect(result.stats.totalObjects).toBe(10000)
      })

      it('should stream pack generation for memory efficiency', () => {
        const config: LargeRepoConfig = {
          maxMemoryUsage: 100 * 1024 * 1024, // 100MB
          chunkSize: 1000,
          enableStreaming: true
        }

        const handler = new LargeRepositoryHandler(config)
        const memoryUsages: number[] = []

        handler.onMemoryUsage((usage) => {
          memoryUsages.push(usage)
        })

        const objects = []
        for (let i = 0; i < 5000; i++) {
          objects.push({
            sha: i.toString(16).padStart(40, '0'),
            type: PackObjectType.OBJ_BLOB,
            data: new Uint8Array(1000).fill(i % 256)
          })
        }

        handler.setObjects(objects)
        handler.generatePack()

        // Memory usage should stay within limits
        expect(Math.max(...memoryUsages)).toBeLessThanOrEqual(config.maxMemoryUsage)
      })

      it('should partition large object sets into manageable chunks', () => {
        const handler = new LargeRepositoryHandler({
          chunkSize: 100
        })

        const objects = []
        for (let i = 0; i < 500; i++) {
          objects.push({
            sha: i.toString(16).padStart(40, '0'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode(`content ${i}`)
          })
        }

        const chunks = handler.partitionObjects(objects)

        expect(chunks.length).toBe(5) // 500 / 100
        expect(chunks[0].length).toBe(100)
      })

      it('should support parallel delta computation', () => {
        const handler = new LargeRepositoryHandler({
          parallelDeltaComputation: true,
          workerCount: 4
        })

        const objects = []
        for (let i = 0; i < 1000; i++) {
          objects.push({
            sha: i.toString(16).padStart(40, '0'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode(`version ${i} content with some common parts`)
          })
        }

        handler.setObjects(objects)

        const start = Date.now()
        const result = handler.generatePack()
        const elapsed = Date.now() - start

        expect(result.packData).toBeInstanceOf(Uint8Array)
        // Should complete in reasonable time
        expect(elapsed).toBeLessThan(30000)
      })

      it('should report progress for large operations', () => {
        const handler = new LargeRepositoryHandler()
        const progressReports: PackGenerationProgress[] = []

        handler.onProgress((progress) => {
          progressReports.push({ ...progress })
        })

        const objects = []
        for (let i = 0; i < 1000; i++) {
          objects.push({
            sha: i.toString(16).padStart(40, '0'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode(`content ${i}`)
          })
        }

        handler.setObjects(objects)
        handler.generatePack()

        expect(progressReports.length).toBeGreaterThan(0)
        expect(progressReports.some(p => p.phase === 'compressing')).toBe(true)
        expect(progressReports.some(p => p.phase === 'writing')).toBe(true)
      })
    })

    describe('StreamingPackWriter', () => {
      it('should write pack data in streaming fashion', () => {
        const writer = new StreamingPackWriter()
        const chunks: Uint8Array[] = []

        writer.onChunk((chunk) => {
          chunks.push(chunk)
        })

        writer.writeHeader(10)

        for (let i = 0; i < 10; i++) {
          writer.writeObject({
            sha: i.toString(16).padStart(40, '0'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode(`content ${i}`)
          })
        }

        writer.finalize()

        expect(chunks.length).toBeGreaterThan(0)
        // Concatenated chunks should form valid pack
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
        expect(totalLength).toBeGreaterThan(32)
      })

      it('should write to provided output stream', async () => {
        const outputChunks: Uint8Array[] = []
        const mockStream = {
          write: (chunk: Uint8Array) => {
            outputChunks.push(chunk)
            return Promise.resolve()
          }
        }

        const writer = new StreamingPackWriter({ outputStream: mockStream })

        writer.writeHeader(1)
        writer.writeObject({
          sha: createTestSha('test'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('test')
        })
        await writer.finalize()

        expect(outputChunks.length).toBeGreaterThan(0)
      })

      it('should handle backpressure in streaming', async () => {
        let writeCount = 0
        const mockStream = {
          write: async (chunk: Uint8Array) => {
            writeCount++
            // Simulate slow write
            await new Promise(resolve => setTimeout(resolve, 1))
          }
        }

        const writer = new StreamingPackWriter({
          outputStream: mockStream,
          highWaterMark: 1024
        })

        writer.writeHeader(100)

        for (let i = 0; i < 100; i++) {
          writer.writeObject({
            sha: i.toString(16).padStart(40, '0'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode(`content ${i}`)
          })
        }

        await writer.finalize()

        expect(writeCount).toBeGreaterThan(0)
      })
    })
  })

  describe('Incremental pack updates', () => {
    describe('IncrementalPackUpdater', () => {
      it('should create incremental pack from existing pack', () => {
        const updater = new IncrementalPackUpdater()

        const existingObjects = [
          { sha: createTestSha('existing1'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('existing1') },
          { sha: createTestSha('existing2'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('existing2') }
        ]

        const newObjects = [
          { sha: createTestSha('new1'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('new1') },
          { sha: createTestSha('new2'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('new2') }
        ]

        updater.setExistingObjects(existingObjects)
        const result: IncrementalPackResult = updater.addObjects(newObjects)

        expect(result.packData).toBeInstanceOf(Uint8Array)
        expect(result.addedObjects).toBe(2)
        expect(result.reusedDeltas).toBeDefined()
      })

      it('should reuse delta bases from existing pack', () => {
        const updater = new IncrementalPackUpdater({ reuseDeltas: true })

        const baseContent = encoder.encode('this is the base content for delta')
        const existingObjects = [
          { sha: createTestSha('base'), type: PackObjectType.OBJ_BLOB, data: baseContent }
        ]

        const newObjects = [
          {
            sha: createTestSha('derived'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('this is the base content for delta with additions')
          }
        ]

        updater.setExistingObjects(existingObjects)
        const result = updater.addObjects(newObjects)

        // Should create delta referencing existing base
        expect(result.deltaReferences).toContain(createTestSha('base'))
      })

      it('should detect and skip already-packed objects', () => {
        const updater = new IncrementalPackUpdater()

        const sharedSha = createTestSha('shared')
        const existingObjects = [
          { sha: sharedSha, type: PackObjectType.OBJ_BLOB, data: encoder.encode('shared') }
        ]

        const newObjects = [
          { sha: sharedSha, type: PackObjectType.OBJ_BLOB, data: encoder.encode('shared') },
          { sha: createTestSha('new'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('new') }
        ]

        updater.setExistingObjects(existingObjects)
        const result = updater.addObjects(newObjects)

        expect(result.addedObjects).toBe(1)
        expect(result.skippedObjects).toBe(1)
      })

      it('should generate thin pack for network transfer', () => {
        const options: IncrementalUpdateOptions = {
          generateThinPack: true,
          externalBases: new Set([createTestSha('external')])
        }

        const updater = new IncrementalPackUpdater(options)

        const newObjects = [
          {
            sha: createTestSha('derived'),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode('content derived from external')
          }
        ]

        const result = updater.addObjects(newObjects)

        expect(result.isThin).toBe(true)
        expect(result.missingBases).toBeDefined()
      })

      it('should compute efficient diffs between pack states', () => {
        const updater = new IncrementalPackUpdater()

        const oldPackObjects = [
          { sha: createTestSha('obj1'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('obj1') },
          { sha: createTestSha('obj2'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('obj2') }
        ]

        const newPackObjects = [
          { sha: createTestSha('obj1'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('obj1') },
          { sha: createTestSha('obj3'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('obj3') }
        ]

        const diff = updater.computeDiff(oldPackObjects, newPackObjects)

        expect(diff.added).toContain(createTestSha('obj3'))
        expect(diff.removed).toContain(createTestSha('obj2'))
        expect(diff.unchanged).toContain(createTestSha('obj1'))
      })
    })

    describe('Pack merging', () => {
      it('should merge multiple packs into one', () => {
        const updater = new IncrementalPackUpdater()

        const pack1Objects = [
          { sha: createTestSha('a'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('a') }
        ]
        const pack2Objects = [
          { sha: createTestSha('b'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('b') }
        ]

        const merged = updater.mergePacks([pack1Objects, pack2Objects])

        expect(merged.objects.length).toBe(2)
        expect(merged.objects.map(o => o.sha)).toContain(createTestSha('a'))
        expect(merged.objects.map(o => o.sha)).toContain(createTestSha('b'))
      })

      it('should deduplicate objects when merging', () => {
        const updater = new IncrementalPackUpdater()

        const sharedSha = createTestSha('shared')
        const pack1 = [
          { sha: sharedSha, type: PackObjectType.OBJ_BLOB, data: encoder.encode('shared') },
          { sha: createTestSha('a'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('a') }
        ]
        const pack2 = [
          { sha: sharedSha, type: PackObjectType.OBJ_BLOB, data: encoder.encode('shared') },
          { sha: createTestSha('b'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('b') }
        ]

        const merged = updater.mergePacks([pack1, pack2])

        // Should have 3 unique objects, not 4
        expect(merged.objects.length).toBe(3)
      })

      it('should reoptimize deltas during merge', () => {
        const updater = new IncrementalPackUpdater({ reoptimizeDeltas: true })

        const baseContent = encoder.encode('base content')
        const pack1 = [
          { sha: createTestSha('base'), type: PackObjectType.OBJ_BLOB, data: baseContent }
        ]
        const pack2 = [
          { sha: createTestSha('derived'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('base content extended') }
        ]

        const merged = updater.mergePacks([pack1, pack2])

        // Merged pack should have optimized delta chain
        expect(merged.stats.deltaObjects).toBeGreaterThan(0)
      })
    })
  })

  describe('Object dependency computation', () => {
    describe('computeObjectDependencies', () => {
      it('should compute tree dependencies on blobs', () => {
        const blobSha = createTestSha('blob')
        const treeSha = createTestSha('tree')

        const objects = [
          { sha: blobSha, type: PackObjectType.OBJ_BLOB, data: encoder.encode('content') },
          { sha: treeSha, type: PackObjectType.OBJ_TREE, data: encoder.encode(`100644 file\0${hexToBytes(blobSha).slice(0, 20)}`) }
        ]

        const graph: ObjectDependencyGraph = computeObjectDependencies(objects)

        expect(graph.getDependencies(treeSha)).toContain(blobSha)
        expect(graph.getDependents(blobSha)).toContain(treeSha)
      })

      it('should compute commit dependencies on trees and parents', () => {
        const treeSha = createTestSha('tree')
        const parentSha = createTestSha('parent')
        const commitSha = createTestSha('commit')

        const objects = [
          { sha: treeSha, type: PackObjectType.OBJ_TREE, data: new Uint8Array([1, 2, 3]) },
          { sha: parentSha, type: PackObjectType.OBJ_COMMIT, data: encoder.encode('parent commit') },
          {
            sha: commitSha,
            type: PackObjectType.OBJ_COMMIT,
            data: encoder.encode(`tree ${treeSha}\nparent ${parentSha}\n\nmessage`)
          }
        ]

        const graph = computeObjectDependencies(objects)

        expect(graph.getDependencies(commitSha)).toContain(treeSha)
        expect(graph.getDependencies(commitSha)).toContain(parentSha)
      })

      it('should detect cyclic dependencies', () => {
        // Note: Real git objects shouldn't have cycles, but we should handle gracefully
        const objects = [
          { sha: createTestSha('a'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('a') },
          { sha: createTestSha('b'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('b') }
        ]

        const graph = computeObjectDependencies(objects)

        expect(graph.hasCycles()).toBe(false)
      })

      it('should compute topological order for pack writing', () => {
        const blobSha = createTestSha('blob')
        const treeSha = createTestSha('tree')
        const commitSha = createTestSha('commit')

        const objects = [
          { sha: commitSha, type: PackObjectType.OBJ_COMMIT, data: encoder.encode(`tree ${treeSha}\n\nmsg`) },
          { sha: blobSha, type: PackObjectType.OBJ_BLOB, data: encoder.encode('content') },
          { sha: treeSha, type: PackObjectType.OBJ_TREE, data: encoder.encode('tree data') }
        ]

        const graph = computeObjectDependencies(objects)
        const order = graph.topologicalSort()

        // Dependencies should come before dependents
        const blobIndex = order.indexOf(blobSha)
        const treeIndex = order.indexOf(treeSha)
        const commitIndex = order.indexOf(commitSha)

        expect(blobIndex).toBeLessThan(treeIndex)
        expect(treeIndex).toBeLessThan(commitIndex)
      })
    })
  })

  describe('Pack integrity validation', () => {
    describe('validatePackIntegrity', () => {
      it('should validate complete pack structure', () => {
        const generator = new FullPackGenerator()
        generator.addObject({
          sha: createTestSha('test'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('test content')
        })

        const pack = generator.generate()
        const result: PackValidationResult = validatePackIntegrity(pack.packData)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should detect invalid pack header', () => {
        const invalidPack = new Uint8Array([
          0x00, 0x00, 0x00, 0x00, // Invalid signature
          0x00, 0x00, 0x00, 0x02,
          0x00, 0x00, 0x00, 0x00
        ])

        const result = validatePackIntegrity(invalidPack)

        expect(result.valid).toBe(false)
        expect(result.errors.some(e => e.includes('signature'))).toBe(true)
      })

      it('should detect checksum mismatch', () => {
        const generator = new FullPackGenerator()
        generator.addObject({
          sha: createTestSha('test'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('test')
        })

        const pack = generator.generate()
        // Corrupt the checksum
        pack.packData[pack.packData.length - 1] ^= 0xff

        const result = validatePackIntegrity(pack.packData)

        expect(result.valid).toBe(false)
        expect(result.errors.some(e => e.includes('checksum'))).toBe(true)
      })

      it('should detect object count mismatch', () => {
        const generator = new FullPackGenerator()
        generator.addObject({
          sha: createTestSha('test'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('test')
        })

        const pack = generator.generate()
        // Modify object count in header
        pack.packData[11] = 99

        const result = validatePackIntegrity(pack.packData)

        expect(result.valid).toBe(false)
        expect(result.errors.some(e => e.includes('object count'))).toBe(true)
      })

      it('should validate all delta references exist', () => {
        const generator = new FullPackGenerator({ enableDeltaCompression: true })
        generator.addObject({
          sha: createTestSha('base'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('base content')
        })
        generator.addObject({
          sha: createTestSha('derived'),
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('base content with changes')
        })

        const pack = generator.generate()
        const result = validatePackIntegrity(pack.packData, { validateDeltas: true })

        expect(result.valid).toBe(true)
        expect(result.deltaChainStats).toBeDefined()
      })

      it('should report detailed validation statistics', () => {
        const generator = new FullPackGenerator()
        for (let i = 0; i < 10; i++) {
          generator.addObject({
            sha: createTestSha(`obj${i}`),
            type: PackObjectType.OBJ_BLOB,
            data: encoder.encode(`content ${i}`)
          })
        }

        const pack = generator.generate()
        const result = validatePackIntegrity(pack.packData, { collectStats: true })

        expect(result.stats).toBeDefined()
        expect(result.stats!.objectCount).toBe(10)
        expect(result.stats!.headerValid).toBe(true)
        expect(result.stats!.checksumValid).toBe(true)
      })
    })
  })

  describe('Edge cases and error handling', () => {
    it('should handle very large single objects', () => {
      const generator = new FullPackGenerator()

      // 10MB object
      const largeData = new Uint8Array(10 * 1024 * 1024)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      generator.addObject({
        sha: createTestSha('large'),
        type: PackObjectType.OBJ_BLOB,
        data: largeData
      })

      const result = generator.generate()

      expect(result.packData).toBeInstanceOf(Uint8Array)
      expect(result.stats.totalSize).toBe(10 * 1024 * 1024)
    })

    it('should handle objects with maximum delta chain depth', () => {
      const generator = new FullPackGenerator({
        enableDeltaCompression: true,
        maxDeltaDepth: 50
      })

      let content = encoder.encode('base')
      for (let i = 0; i < 60; i++) {
        const newContent = new Uint8Array(content.length + 10)
        newContent.set(content)
        newContent.set(encoder.encode(` v${i}`), content.length)

        generator.addObject({
          sha: createTestSha(`v${i}`),
          type: PackObjectType.OBJ_BLOB,
          data: newContent
        })

        content = newContent
      }

      const result = generator.generate()

      expect(result.stats.maxDeltaDepth).toBeLessThanOrEqual(50)
    })

    it('should handle empty objects', () => {
      const generator = new FullPackGenerator()

      generator.addObject({
        sha: createTestSha('empty'),
        type: PackObjectType.OBJ_BLOB,
        data: new Uint8Array(0)
      })

      const result = generator.generate()

      expect(result.packData).toBeInstanceOf(Uint8Array)
      expect(result.stats.totalObjects).toBe(1)
    })

    it('should handle binary data with null bytes', () => {
      const generator = new FullPackGenerator()

      const binaryData = new Uint8Array([0x00, 0x01, 0x00, 0xff, 0x00, 0xfe])
      generator.addObject({
        sha: createTestSha('binary'),
        type: PackObjectType.OBJ_BLOB,
        data: binaryData
      })

      const result = generator.generate()

      expect(result.packData).toBeInstanceOf(Uint8Array)
    })

    it('should handle concurrent generation calls', async () => {
      const objects = [
        { sha: createTestSha('obj1'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('obj1') },
        { sha: createTestSha('obj2'), type: PackObjectType.OBJ_BLOB, data: encoder.encode('obj2') }
      ]

      const promises = []
      for (let i = 0; i < 5; i++) {
        promises.push(Promise.resolve().then(() => {
          const generator = new FullPackGenerator()
          generator.addObjectSet({ objects })
          return generator.generate()
        }))
      }

      const results = await Promise.all(promises)

      // All should produce valid, identical packs
      const firstHex = bytesToHex(results[0].packData)
      for (const result of results) {
        expect(bytesToHex(result.packData)).toBe(firstHex)
      }
    })

    it('should throw on invalid object types', () => {
      const generator = new FullPackGenerator()

      expect(() => {
        generator.addObject({
          sha: createTestSha('invalid'),
          type: 99 as PackObjectType,
          data: encoder.encode('data')
        })
      }).toThrow()
    })

    it('should throw on invalid SHA format', () => {
      const generator = new FullPackGenerator()

      expect(() => {
        generator.addObject({
          sha: 'not-a-valid-sha',
          type: PackObjectType.OBJ_BLOB,
          data: encoder.encode('data')
        })
      }).toThrow()
    })
  })
})
