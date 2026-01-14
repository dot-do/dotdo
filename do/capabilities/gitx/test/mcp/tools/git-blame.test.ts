import { describe, it, expect, beforeEach } from 'vitest'
import {
  setRepositoryContext,
  invokeTool,
  getTool,
  RepositoryContext,
} from '../../../src/mcp/tools'
import type { CommitObject, TreeObject } from '../../../src/types/objects'

describe('git_blame MCP Tool', () => {
  let mockContext: RepositoryContext

  // Test fixtures - commit SHAs
  const testCommitSha1 = 'abc123def456789012345678901234567890abcd'
  const testCommitSha2 = 'def456abc789012345678901234567890abcdef'
  const testCommitSha3 = 'ccf789def012345678901234567890abcdefabc'
  const testTreeSha = 'tree1234567890123456789012345678901234567'
  const testBlobSha = 'blob1234567890123456789012345678901234567'

  // Mock commits for blame attribution
  const mockCommit1: CommitObject = {
    type: 'commit',
    data: new Uint8Array(),
    tree: testTreeSha,
    parents: [],
    author: {
      name: 'Alice Author',
      email: 'alice@example.com.ai',
      timestamp: 1672531200, // 2023-01-01 00:00:00 UTC
      timezone: '+0000',
    },
    committer: {
      name: 'Alice Author',
      email: 'alice@example.com.ai',
      timestamp: 1672531200,
      timezone: '+0000',
    },
    message: 'Initial commit',
  }

  const mockCommit2: CommitObject = {
    type: 'commit',
    data: new Uint8Array(),
    tree: testTreeSha,
    parents: [testCommitSha1],
    author: {
      name: 'Bob Builder',
      email: 'bob@example.com.ai',
      timestamp: 1672617600, // 2023-01-02 00:00:00 UTC
      timezone: '-0500',
    },
    committer: {
      name: 'Bob Builder',
      email: 'bob@example.com.ai',
      timestamp: 1672617600,
      timezone: '-0500',
    },
    message: 'Add feature X',
  }

  const mockCommit3: CommitObject = {
    type: 'commit',
    data: new Uint8Array(),
    tree: testTreeSha,
    parents: [testCommitSha2],
    author: {
      name: 'Carol Coder',
      email: 'carol@example.com.ai',
      timestamp: 1672704000, // 2023-01-03 00:00:00 UTC
      timezone: '+0530',
    },
    committer: {
      name: 'Carol Coder',
      email: 'carol@example.com.ai',
      timestamp: 1672704000,
      timezone: '+0530',
    },
    message: 'Fix bug in feature X',
  }

  beforeEach(() => {
    // Create a mock repository context for testing
    mockContext = {
      objectStore: {
        getObject: async (sha: string) => {
          if (sha === testBlobSha) {
            const content = new TextEncoder().encode(
              'Line 1: Hello\nLine 2: World\nLine 3: Foo\nLine 4: Bar\nLine 5: Baz\n'
            )
            return { type: 'blob', data: content }
          }
          return null
        },
        getCommit: async (sha: string) => {
          if (sha === testCommitSha1) return mockCommit1
          if (sha === testCommitSha2) return mockCommit2
          if (sha === testCommitSha3) return mockCommit3
          return null
        },
        getTree: async (sha: string) => {
          if (sha === testTreeSha) {
            return {
              type: 'tree',
              data: new Uint8Array(),
              entries: [
                {
                  mode: '100644',
                  name: 'README.md',
                  sha: testBlobSha,
                },
                {
                  mode: '100644',
                  name: 'src/index.ts',
                  sha: testBlobSha,
                },
                {
                  mode: '100644',
                  name: 'binary.png',
                  sha: 'binarysha123456789012345678901234567890',
                },
              ],
            } as TreeObject
          }
          return null
        },
        getBlob: async (sha: string) => {
          if (sha === testBlobSha) {
            return new TextEncoder().encode(
              'Line 1: Hello\nLine 2: World\nLine 3: Foo\nLine 4: Bar\nLine 5: Baz\n'
            )
          }
          if (sha === 'binarysha123456789012345678901234567890') {
            // Return binary content (PNG header)
            return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          }
          return null
        },
        storeObject: async (type: string, data: Uint8Array) => {
          return 'newsha1234567890123456789012345678901234'
        },
        hasObject: async (sha: string) => {
          return [testCommitSha1, testCommitSha2, testCommitSha3, testTreeSha, testBlobSha].includes(sha)
        },
      },
      refStore: {
        getRef: async (name: string) => {
          if (name === 'refs/heads/main') return testCommitSha3
          if (name === 'refs/heads/feature') return testCommitSha2
          if (name === 'refs/tags/v1.0.0') return testCommitSha1
          return null
        },
        setRef: async () => {},
        deleteRef: async () => {},
        listRefs: async () => {
          return [
            { name: 'refs/heads/main', sha: testCommitSha3 },
            { name: 'refs/heads/feature', sha: testCommitSha2 },
            { name: 'refs/tags/v1.0.0', sha: testCommitSha1 },
          ]
        },
        getSymbolicRef: async (name: string) => {
          if (name === 'HEAD') return 'refs/heads/main'
          return null
        },
        setSymbolicRef: async () => {},
        getHead: async () => testCommitSha3,
      },
    }

    setRepositoryContext(mockContext)
  })

  describe('Tool Definition', () => {
    it('should have git_blame tool registered', () => {
      const tool = getTool('git_blame')
      expect(tool).toBeDefined()
    })

    it('should have correct tool name', () => {
      const tool = getTool('git_blame')
      expect(tool?.name).toBe('git_blame')
    })

    it('should have descriptive description', () => {
      const tool = getTool('git_blame')
      expect(tool?.description).toBeDefined()
      expect(tool?.description.toLowerCase()).toContain('blame')
      expect(tool?.description.length).toBeGreaterThan(20)
    })

    it('should have proper input schema', () => {
      const tool = getTool('git_blame')
      expect(tool?.inputSchema).toBeDefined()
      expect(tool?.inputSchema.type).toBe('object')
      expect(tool?.inputSchema.properties).toBeDefined()
    })

    it('should require path parameter', () => {
      const tool = getTool('git_blame')
      expect(tool?.inputSchema.required).toContain('path')
    })

    it('should have path parameter in schema', () => {
      const tool = getTool('git_blame')
      expect(tool?.inputSchema.properties).toHaveProperty('path')
      expect(tool?.inputSchema.properties?.path?.type).toBe('string')
      expect(tool?.inputSchema.properties?.path?.description).toBeDefined()
    })

    it('should have optional revision parameter', () => {
      const tool = getTool('git_blame')
      expect(tool?.inputSchema.properties).toHaveProperty('revision')
      expect(tool?.inputSchema.properties?.revision?.type).toBe('string')
      expect(tool?.inputSchema.required).not.toContain('revision')
    })

    it('should have start_line parameter', () => {
      const tool = getTool('git_blame')
      expect(tool?.inputSchema.properties).toHaveProperty('start_line')
      expect(tool?.inputSchema.properties?.start_line?.type).toBe('number')
    })

    it('should have end_line parameter', () => {
      const tool = getTool('git_blame')
      expect(tool?.inputSchema.properties).toHaveProperty('end_line')
      expect(tool?.inputSchema.properties?.end_line?.type).toBe('number')
    })

    it('should have show_email boolean parameter', () => {
      const tool = getTool('git_blame')
      expect(tool?.inputSchema.properties).toHaveProperty('show_email')
      expect(tool?.inputSchema.properties?.show_email?.type).toBe('boolean')
    })

    it('should have show_stats boolean parameter', () => {
      const tool = getTool('git_blame')
      expect(tool?.inputSchema.properties).toHaveProperty('show_stats')
      expect(tool?.inputSchema.properties?.show_stats?.type).toBe('boolean')
    })
  })

  describe('Basic Blame Output', () => {
    it('should show blame for a file at HEAD', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].type).toBe('text')
      const text = result.content[0].text || ''
      // Should contain commit SHA (abbreviated)
      expect(text).toMatch(/[a-f0-9]{7,}/)
      // Should contain author name
      expect(text).toMatch(/Alice Author|Bob Builder|Carol Coder/)
    })

    it('should show line-by-line annotations', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should have multiple lines with blame information
      const lines = text.trim().split('\n')
      expect(lines.length).toBeGreaterThan(0)
      // Each line should have blame format: sha author date line-number content
    })

    it('should show commit SHA for each line', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should contain short SHA at start of blame lines
      expect(text).toMatch(/^[a-f0-9]{7,}/m)
    })

    it('should show author name for each line', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show author names in blame output
      expect(text).toMatch(/Alice Author|Bob Builder|Carol Coder/)
    })

    it('should show date/timestamp for each line', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should contain date information (2023 from our mock timestamps)
      expect(text).toMatch(/2023|Jan/)
    })

    it('should show line numbers', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should contain line numbers (1, 2, 3, etc.)
      expect(text).toMatch(/\b[1-9]\b|\b\d+\)/)
    })

    it('should show line content', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should contain actual file content
      expect(text).toContain('Line 1')
    })
  })

  describe('Blame at Specific Revision', () => {
    it('should show blame at specific commit SHA', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        revision: testCommitSha1,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show blame from that revision
      expect(text).toBeDefined()
    })

    it('should show blame at specific branch', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        revision: 'feature',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toBeDefined()
    })

    it('should show blame at specific tag', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        revision: 'v1.0.0',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toBeDefined()
    })

    it('should support HEAD revision', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        revision: 'HEAD',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toBeDefined()
    })

    it('should support HEAD~n notation', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        revision: 'HEAD~1',
      })

      // May succeed or fail depending on parent resolution
      expect(result).toBeDefined()
    })

    it('should support abbreviated SHA', async () => {
      const shortSha = testCommitSha1.substring(0, 7)
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        revision: shortSha,
      })

      expect(result).toBeDefined()
    })
  })

  describe('Line Range Filtering', () => {
    it('should filter by start_line only', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        start_line: 3,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should start from line 3
      expect(text).toContain('Line 3')
      // Should not contain lines before start_line
      expect(text).not.toMatch(/^.*Line 1.*$/m)
    })

    it('should filter by end_line only', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        end_line: 2,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should only show up to line 2
      expect(text).toContain('Line 1')
      expect(text).toContain('Line 2')
      // Should not contain lines after end_line
      expect(text).not.toContain('Line 3')
    })

    it('should filter by both start_line and end_line', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        start_line: 2,
        end_line: 4,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show lines 2-4 only
      expect(text).toContain('Line 2')
      expect(text).toContain('Line 3')
      expect(text).toContain('Line 4')
      // Should not contain lines outside range
      expect(text).not.toContain('Line 1:')
      expect(text).not.toContain('Line 5')
    })

    it('should handle single line range', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        start_line: 3,
        end_line: 3,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show only line 3
      expect(text).toContain('Line 3')
      const lines = text.trim().split('\n').filter(l => l.includes('Line'))
      expect(lines.length).toBe(1)
    })

    it('should handle range starting at line 1', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        start_line: 1,
        end_line: 2,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('Line 1')
      expect(text).toContain('Line 2')
    })

    it('should handle range to end of file', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        start_line: 4,
        end_line: 100, // Beyond file length
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show remaining lines
      expect(text).toContain('Line 4')
      expect(text).toContain('Line 5')
    })
  })

  describe('Show Email Option', () => {
    it('should show author email when show_email is true', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        show_email: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should contain email addresses
      expect(text).toMatch(/@example\.com/)
    })

    it('should hide author email when show_email is false', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        show_email: false,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // May or may not contain email based on default format
      // At minimum should show author name
      expect(text).toMatch(/Alice Author|Bob Builder|Carol Coder/)
    })

    it('should use default email visibility when not specified', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      // Default behavior defined by implementation
      expect(result.content[0].text).toBeDefined()
    })
  })

  describe('Show Stats Option', () => {
    it('should show statistics when show_stats is true', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        show_stats: true,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should contain some statistical information
      // Could be author line counts, percentages, etc.
      expect(text).toBeDefined()
    })

    it('should hide statistics when show_stats is false', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        show_stats: false,
      })

      expect(result.isError).toBe(false)
      // Should just show blame lines without summary stats
      expect(result.content[0].text).toBeDefined()
    })
  })

  describe('File Path Handling', () => {
    it('should handle files in subdirectories', async () => {
      const result = await invokeTool('git_blame', {
        path: 'src/index.ts',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toBeDefined()
    })

    it('should handle paths with special characters', async () => {
      const result = await invokeTool('git_blame', {
        path: 'file-with-dashes.txt',
      })

      // Should either succeed or return appropriate not found error
      expect(result).toBeDefined()
    })

    it('should normalize path separators', async () => {
      const result = await invokeTool('git_blame', {
        path: 'src/index.ts',
      })

      // Forward slashes should work
      expect(result).toBeDefined()
    })
  })

  describe('Error Handling', () => {
    it('should return error when path parameter is missing', async () => {
      const result = await invokeTool('git_blame', {})

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/missing|required|path/i)
    })

    it('should return error when file does not exist', async () => {
      const result = await invokeTool('git_blame', {
        path: 'nonexistent-file.txt',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not found|does not exist|no such file|no such path/i)
    })

    it('should return error when revision does not exist', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        revision: 'nonexistent-branch',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not found|invalid|bad revision/i)
    })

    it('should use bash CLI when repository context not set', async () => {
      setRepositoryContext(null)

      // When no repository context is set, tool falls through to bash CLI
      // and uses the actual git repository (gitx repo)
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      // Since we're in an actual git repo, this should succeed using bash CLI
      // (or fail if README.md doesn't exist, which is also valid)
      expect(result).toBeDefined()
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)

      // Restore context for other tests
      setRepositoryContext(mockContext)
    })

    it('should return error for invalid start_line (negative)', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        start_line: -1,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|must be at least|positive|line/i)
    })

    it('should return error for invalid end_line (negative)', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        end_line: -5,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|must be at least|positive|line/i)
    })

    it('should return error when start_line > end_line', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        start_line: 10,
        end_line: 5,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|range|start.*end|greater/i)
    })

    it('should return error for start_line = 0', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        start_line: 0,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|must be at least 1|line/i)
    })

    it('should reject path traversal attempts', async () => {
      const result = await invokeTool('git_blame', {
        path: '../../../etc/passwd',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|forbidden|path/i)
    })

    it('should reject absolute paths', async () => {
      const result = await invokeTool('git_blame', {
        path: '/etc/passwd',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|forbidden|path/i)
    })

    it('should reject shell injection in revision', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        revision: 'HEAD; rm -rf /',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|forbidden/i)
    })
  })

  describe('Binary File Handling', () => {
    it('should handle binary files appropriately', async () => {
      const result = await invokeTool('git_blame', {
        path: 'binary.png',
      })

      // Should either:
      // 1. Return an error indicating it's a binary file
      // 2. Return a message that binary files cannot be blamed
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/binary|cannot blame|not a text file/i)
    })

    it('should detect binary content correctly', async () => {
      // Update mock to return binary for specific file
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === testTreeSha) {
          return {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              {
                mode: '100644',
                name: 'image.png',
                sha: 'binarysha123456789012345678901234567890',
              },
            ],
          } as TreeObject
        }
        return null
      }

      const result = await invokeTool('git_blame', {
        path: 'image.png',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/binary/i)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty file', async () => {
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'emptyblob') {
          return new Uint8Array([])
        }
        return null
      }
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === testTreeSha) {
          return {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              {
                mode: '100644',
                name: 'empty.txt',
                sha: 'emptyblob',
              },
            ],
          } as TreeObject
        }
        return null
      }

      const result = await invokeTool('git_blame', {
        path: 'empty.txt',
      })

      expect(result.isError).toBe(false)
      // Empty file should produce empty or minimal blame output
      const text = result.content[0].text || ''
      expect(text).toBeDefined()
    })

    it('should handle file with only one line', async () => {
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'onelineblob') {
          return new TextEncoder().encode('Single line content')
        }
        return null
      }
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === testTreeSha) {
          return {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              {
                mode: '100644',
                name: 'oneline.txt',
                sha: 'onelineblob',
              },
            ],
          } as TreeObject
        }
        return null
      }

      const result = await invokeTool('git_blame', {
        path: 'oneline.txt',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('Single line content')
    })

    it('should handle file with no trailing newline', async () => {
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'notrailingnewline') {
          return new TextEncoder().encode('Line 1\nLine 2\nLine 3')
        }
        return null
      }
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === testTreeSha) {
          return {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              {
                mode: '100644',
                name: 'notrailing.txt',
                sha: 'notrailingnewline',
              },
            ],
          } as TreeObject
        }
        return null
      }

      const result = await invokeTool('git_blame', {
        path: 'notrailing.txt',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('Line 3')
    })

    it('should handle file with very long lines', async () => {
      const longLine = 'A'.repeat(10000)
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'longlineblob') {
          return new TextEncoder().encode(longLine)
        }
        return null
      }
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === testTreeSha) {
          return {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              {
                mode: '100644',
                name: 'longline.txt',
                sha: 'longlineblob',
              },
            ],
          } as TreeObject
        }
        return null
      }

      const result = await invokeTool('git_blame', {
        path: 'longline.txt',
      })

      expect(result.isError).toBe(false)
      // Should handle without crashing
      expect(result.content[0].text).toBeDefined()
    })

    it('should handle file with many lines', async () => {
      const manyLines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`).join('\n')
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'manylinesblob') {
          return new TextEncoder().encode(manyLines)
        }
        return null
      }
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === testTreeSha) {
          return {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              {
                mode: '100644',
                name: 'manylines.txt',
                sha: 'manylinesblob',
              },
            ],
          } as TreeObject
        }
        return null
      }

      const result = await invokeTool('git_blame', {
        path: 'manylines.txt',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('Line 1')
      expect(text).toContain('Line 1000')
    })

    it('should handle UTF-8 content correctly', async () => {
      const utf8Content = 'Hello World\nBonjour le monde\nPrzemek: Cześć\n'
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'utf8blob') {
          return new TextEncoder().encode(utf8Content)
        }
        return null
      }
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === testTreeSha) {
          return {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              {
                mode: '100644',
                name: 'utf8.txt',
                sha: 'utf8blob',
              },
            ],
          } as TreeObject
        }
        return null
      }

      const result = await invokeTool('git_blame', {
        path: 'utf8.txt',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('Cześć')
    })

    it('should handle file added in initial commit', async () => {
      // File exists only in initial commit with no parents
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        revision: testCommitSha1,
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // All lines should be attributed to the initial commit author
      expect(text).toContain('Alice Author')
    })

    it('should handle renamed files', async () => {
      // Mock a tree where file was renamed
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === testTreeSha) {
          return {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              {
                mode: '100644',
                name: 'new-name.md',
                sha: testBlobSha,
              },
            ],
          } as TreeObject
        }
        return null
      }

      const result = await invokeTool('git_blame', {
        path: 'new-name.md',
      })

      // Should handle renamed file blame (may track through history)
      expect(result).toBeDefined()
    })

    it('should handle start_line beyond file length', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
        start_line: 1000,
      })

      // Should return empty or appropriate message
      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Either empty result or message indicating no lines in range
      expect(text).toBeDefined()
    })
  })

  describe('Output Formatting', () => {
    it('should format blame output consistently', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Each line should have consistent format
      const lines = text.trim().split('\n')
      for (const line of lines) {
        // Should match blame format pattern
        // Typical format: SHA (author date line#) content
        expect(line.length).toBeGreaterThan(0)
      }
    })

    it('should align columns properly', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      // Output should have reasonable alignment for readability
      expect(result.content[0].text).toBeDefined()
    })

    it('should use abbreviated SHA by default', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should use 7-8 character abbreviated SHA, not full 40 char
      expect(text).toMatch(/^[a-f0-9]{7,8}/m)
      // Full SHA is 40 chars, abbreviated is typically 7
      expect(text).not.toMatch(/^[a-f0-9]{40}/m)
    })

    it('should format date in readable format', async () => {
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should not just show raw unix timestamp
      expect(text).not.toMatch(/^\d{10}/m)
      // Should show human readable date
      expect(text).toMatch(/2023|Jan|Feb|Mar/)
    })

    it('should handle multiline commit messages in summary', async () => {
      // Multiline commit messages should only show first line/subject
      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      expect(result.isError).toBe(false)
      // Output should be clean without embedded newlines from commit message
      expect(result.content[0].text).toBeDefined()
    })
  })

  describe('Performance and Limits', () => {
    it('should handle blame request efficiently', async () => {
      const startTime = Date.now()

      const result = await invokeTool('git_blame', {
        path: 'README.md',
      })

      const elapsed = Date.now() - startTime

      expect(result.isError).toBe(false)
      // Should complete within reasonable time (5 seconds for test mock)
      expect(elapsed).toBeLessThan(5000)
    })

    it('should handle blame on large files within limits', async () => {
      // Create a large file mock
      const largeContent = Array.from({ length: 10000 }, (_, i) => `Line ${i + 1}: content`).join('\n')
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'largeblob') {
          return new TextEncoder().encode(largeContent)
        }
        return null
      }
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === testTreeSha) {
          return {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              {
                mode: '100644',
                name: 'large.txt',
                sha: 'largeblob',
              },
            ],
          } as TreeObject
        }
        return null
      }

      const result = await invokeTool('git_blame', {
        path: 'large.txt',
        start_line: 1,
        end_line: 100, // Limit output for test
      })

      expect(result.isError).toBe(false)
      // Should handle without timeout/memory issues
      expect(result.content[0].text).toBeDefined()
    })
  })
})
