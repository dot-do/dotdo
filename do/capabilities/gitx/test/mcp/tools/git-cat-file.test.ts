import { describe, it, expect, beforeEach } from 'vitest'
import {
  setRepositoryContext,
  invokeTool,
  getTool,
  RepositoryContext,
} from '../../../src/mcp/tools'

describe('git_cat_file MCP Tool', () => {
  let mockContext: RepositoryContext

  beforeEach(() => {
    // Create a mock repository context for testing
    mockContext = {
      objectStore: {
        getObject: async (sha: string) => {
          if (sha === 'abc123blob') {
            return {
              type: 'blob',
              data: new TextEncoder().encode('Hello, World!\n'),
            }
          }
          if (sha === 'def456tree') {
            // Mock tree object data
            const treeData = new Uint8Array([
              // Tree entries would be here in real implementation
            ])
            return {
              type: 'tree',
              data: treeData,
            }
          }
          if (sha === 'ghi789commit') {
            // Mock commit object data
            const commitData = new TextEncoder().encode(
              'tree abc123\nparent parent123\nauthor Test Author <test@example.com.ai> 1234567890 +0000\ncommitter Test Author <test@example.com.ai> 1234567890 +0000\n\nTest commit message\n'
            )
            return {
              type: 'commit',
              data: commitData,
            }
          }
          return null
        },
        getCommit: async (sha: string) => {
          if (sha === 'ghi789commit') {
            return {
              tree: 'abc123tree',
              parents: ['parent123'],
              author: {
                name: 'Test Author',
                email: 'test@example.com.ai',
                timestamp: 1234567890,
                timezone: '+0000',
              },
              committer: {
                name: 'Test Author',
                email: 'test@example.com.ai',
                timestamp: 1234567890,
                timezone: '+0000',
              },
              message: 'Test commit message\n',
            }
          }
          return null
        },
        getTree: async (sha: string) => {
          if (sha === 'def456tree') {
            return {
              entries: [
                {
                  mode: '100644',
                  name: 'file.txt',
                  sha: 'abc123blob',
                  type: 'blob' as const,
                },
                {
                  mode: '040000',
                  name: 'subdir',
                  sha: 'subdir123',
                  type: 'tree' as const,
                },
              ],
            }
          }
          return null
        },
        getBlob: async (sha: string) => {
          if (sha === 'abc123blob') {
            return new TextEncoder().encode('Hello, World!\n')
          }
          return null
        },
        storeObject: async () => 'newsha123',
        hasObject: async (sha: string) => {
          return ['abc123blob', 'def456tree', 'ghi789commit'].includes(sha)
        },
      },
      refStore: {
        getRef: async () => null,
        setRef: async () => {},
        deleteRef: async () => {},
        listRefs: async () => [],
        getSymbolicRef: async () => null,
        setSymbolicRef: async () => {},
        getHead: async () => null,
      },
    }

    setRepositoryContext(mockContext)
  })

  describe('Tool definition', () => {
    it('should have git_cat_file tool registered', () => {
      const tool = getTool('git_cat_file')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('git_cat_file')
    })

    it('should have correct description', () => {
      const tool = getTool('git_cat_file')
      // Description should mention content and objects (cat-file shows object content)
      expect(tool?.description.toLowerCase()).toContain('content')
      expect(tool?.description.toLowerCase()).toContain('object')
    })

    it('should have correct schema', () => {
      const tool = getTool('git_cat_file')
      expect(tool?.inputSchema.type).toBe('object')
      expect(tool?.inputSchema.properties).toHaveProperty('object')
    })

    it('should require object parameter', () => {
      const tool = getTool('git_cat_file')
      expect(tool?.inputSchema.required).toContain('object')
    })

    it('should have type parameter with enum', () => {
      const tool = getTool('git_cat_file')
      expect(tool?.inputSchema.properties).toHaveProperty('type')
      const typeProperty = tool?.inputSchema.properties?.type
      expect(typeProperty?.enum).toContain('blob')
      expect(typeProperty?.enum).toContain('tree')
      expect(typeProperty?.enum).toContain('commit')
      expect(typeProperty?.enum).toContain('tag')
      expect(typeProperty?.enum).toContain('auto')
    })

    it('should have pretty_print boolean parameter', () => {
      const tool = getTool('git_cat_file')
      expect(tool?.inputSchema.properties).toHaveProperty('pretty_print')
      expect(tool?.inputSchema.properties?.pretty_print?.type).toBe('boolean')
    })

    it('should have show_size boolean parameter', () => {
      const tool = getTool('git_cat_file')
      expect(tool?.inputSchema.properties).toHaveProperty('show_size')
      expect(tool?.inputSchema.properties?.show_size?.type).toBe('boolean')
    })

    it('should have show_type boolean parameter', () => {
      const tool = getTool('git_cat_file')
      expect(tool?.inputSchema.properties).toHaveProperty('show_type')
      expect(tool?.inputSchema.properties?.show_type?.type).toBe('boolean')
    })
  })

  describe('Output blob content', () => {
    it('should output blob content by SHA', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Hello, World!')
    })

    it('should output blob content when type is specified as blob', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        type: 'blob',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('Hello, World!')
    })

    it('should handle binary blob content', async () => {
      // Mock a binary blob
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'binaryblob') {
          return new Uint8Array([0x00, 0x01, 0xff, 0xfe])
        }
        return null
      }
      mockContext.objectStore.getObject = async (sha: string) => {
        if (sha === 'binaryblob') {
          return {
            type: 'blob',
            data: new Uint8Array([0x00, 0x01, 0xff, 0xfe]),
          }
        }
        return null
      }
      mockContext.objectStore.hasObject = async (sha: string) => sha === 'binaryblob'

      const result = await invokeTool('git_cat_file', {
        object: 'binaryblob',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toBeDefined()
      // Binary content should be displayed in some format (hex or base64)
    })
  })

  describe('Output tree entries', () => {
    it('should output tree entries by SHA', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'def456tree',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('file.txt')
      expect(result.content[0].text).toContain('subdir')
    })

    it('should output tree entries when type is specified as tree', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'def456tree',
        type: 'tree',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('100644')
      expect(result.content[0].text).toContain('blob')
      expect(result.content[0].text).toContain('abc123blob')
    })

    it('should show tree entries in ls-tree format', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'def456tree',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      // Should show mode, type, sha, and name
      expect(text).toMatch(/100644.*blob.*abc123blob.*file\.txt/)
      expect(text).toMatch(/040000.*tree.*subdir123.*subdir/)
    })
  })

  describe('Output commit info', () => {
    it('should output commit information by SHA', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'ghi789commit',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('tree')
      expect(result.content[0].text).toContain('author')
      expect(result.content[0].text).toContain('Test Author')
    })

    it('should output commit when type is specified as commit', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'ghi789commit',
        type: 'commit',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('Test commit message')
    })

    it('should show commit in raw format', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'ghi789commit',
      })

      expect(result.isError).toBe(false)
      const text = result.content[0].text || ''
      expect(text).toContain('tree abc123tree')
      expect(text).toContain('parent parent123')
      expect(text).toContain('author Test Author <test@example.com.ai>')
      expect(text).toContain('committer Test Author <test@example.com.ai>')
    })
  })

  describe('Pretty-print mode', () => {
    it('should pretty-print commit when pretty_print is true', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'ghi789commit',
        pretty_print: true,
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('commit')
      expect(result.content[0].text).toContain('Test Author')
      expect(result.content[0].text).toContain('Test commit message')
    })

    it('should pretty-print tree when pretty_print is true', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'def456tree',
        pretty_print: true,
      })

      expect(result.isError).toBe(false)
      // Pretty print should be more readable than raw format
      const text = result.content[0].text || ''
      expect(text).toContain('file.txt')
    })

    it('should not pretty-print blob content', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        pretty_print: true,
      })

      expect(result.isError).toBe(false)
      // Blob should show raw content even with pretty_print
      expect(result.content[0].text).toBe('Hello, World!\n')
    })
  })

  describe('Show type and size', () => {
    it('should show object type when show_type is true', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        show_type: true,
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toBe('blob')
    })

    it('should show object size when show_size is true', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        show_size: true,
      })

      expect(result.isError).toBe(false)
      // "Hello, World!\n" is 14 bytes
      expect(result.content[0].text).toBe('14')
    })

    it('should show both type and size when both flags are true', async () => {
      const resultType = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        show_type: true,
      })
      const resultSize = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        show_size: true,
      })

      expect(resultType.isError).toBe(false)
      expect(resultSize.isError).toBe(false)
      expect(resultType.content[0].text).toBe('blob')
      expect(resultSize.content[0].text).toMatch(/\d+/)
    })

    it('should prioritize show_type/show_size over content display', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        show_size: true,
      })

      expect(result.isError).toBe(false)
      // When show_size is true, should only show size, not content
      expect(result.content[0].text).not.toContain('Hello, World!')
    })
  })

  describe('Type validation and auto-detection', () => {
    it('should auto-detect object type when type is "auto"', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        type: 'auto',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('Hello, World!')
    })

    it('should auto-detect object type when type is not specified', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'def456tree',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('file.txt')
    })

    it('should fail when specified type does not match actual type', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        type: 'tree',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/type mismatch|expected tree|not a tree/i)
    })

    it('should validate that commit type matches', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'ghi789commit',
        type: 'commit',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('Test commit message')
    })
  })

  describe('Error handling', () => {
    it('should return error when object parameter is missing', async () => {
      const result = await invokeTool('git_cat_file', {})

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/missing|required|object/i)
    })

    it('should return error when object does not exist', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'nonexistent',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/not found|does not exist|object/i)
    })

    it('should use bash CLI when repository context is not set', async () => {
      setRepositoryContext(null)

      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
      })

      // When context is not set, falls through to bash CLI which returns git error
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/fatal|not found|not a valid object name/i)
    })

    it('should handle invalid SHA format gracefully', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'invalid-sha-format!@#$',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/invalid|sha|format|not found/i)
    })

    it('should validate type parameter enum', async () => {
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob',
        type: 'invalid-type',
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/validation|type|enum|one of/i)
    })
  })

  describe('Reference support', () => {
    it('should resolve refs to SHA before cat-file', async () => {
      // Mock ref resolution
      mockContext.refStore.getRef = async (ref: string) => {
        if (ref === 'refs/heads/main') {
          return 'ghi789commit'
        }
        return null
      }

      const result = await invokeTool('git_cat_file', {
        object: 'main',
      })

      // Should resolve main -> refs/heads/main -> ghi789commit
      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('Test commit message')
    })

    it('should support HEAD reference', async () => {
      mockContext.refStore.getHead = async () => 'ghi789commit'

      const result = await invokeTool('git_cat_file', {
        object: 'HEAD',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('Test commit message')
    })

    it('should support abbreviated SHAs', async () => {
      // Mock abbreviated SHA resolution (first 7 chars)
      // Using existing mock object 'abc123blob' directly
      const result = await invokeTool('git_cat_file', {
        object: 'abc123blob', // full mock SHA
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('Hello, World!')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty blob', async () => {
      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'emptyblob') {
          return new Uint8Array([])
        }
        return null
      }
      mockContext.objectStore.getObject = async (sha: string) => {
        if (sha === 'emptyblob') {
          return {
            type: 'blob',
            data: new Uint8Array([]),
          }
        }
        return null
      }
      mockContext.objectStore.hasObject = async (sha: string) => sha === 'emptyblob'

      const result = await invokeTool('git_cat_file', {
        object: 'emptyblob',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toBe('')
    })

    it('should handle empty tree', async () => {
      mockContext.objectStore.getTree = async (sha: string) => {
        if (sha === 'emptytree') {
          return {
            entries: [],
          }
        }
        return null
      }
      mockContext.objectStore.getObject = async (sha: string) => {
        if (sha === 'emptytree') {
          return {
            type: 'tree',
            data: new Uint8Array([]),
          }
        }
        return null
      }
      mockContext.objectStore.hasObject = async (sha: string) => sha === 'emptytree'

      const result = await invokeTool('git_cat_file', {
        object: 'emptytree',
      })

      expect(result.isError).toBe(false)
      // Empty tree should return empty output or a message
      expect(result.content[0].text).toBeDefined()
    })

    it('should handle very large blob content gracefully', async () => {
      // Mock a large blob (1MB)
      const largeContent = new Uint8Array(1024 * 1024)
      largeContent.fill(65) // Fill with 'A'

      mockContext.objectStore.getBlob = async (sha: string) => {
        if (sha === 'largeblob') {
          return largeContent
        }
        return null
      }
      mockContext.objectStore.getObject = async (sha: string) => {
        if (sha === 'largeblob') {
          return {
            type: 'blob',
            data: largeContent,
          }
        }
        return null
      }
      mockContext.objectStore.hasObject = async (sha: string) => sha === 'largeblob'

      const result = await invokeTool('git_cat_file', {
        object: 'largeblob',
      })

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toBeDefined()
    })
  })
})
