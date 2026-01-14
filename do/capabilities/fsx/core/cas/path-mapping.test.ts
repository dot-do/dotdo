import { describe, it, expect } from 'vitest'
import { hashToPath, pathToHash, createPathMapper, isValidHash, isValidPath } from './path-mapping'

describe('hashToPath', () => {
  describe('SHA-1 hashes (40 characters)', () => {
    it('should generate correct objects/xx/yyyy... format', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash)
      expect(path).toBe('objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should use first 2 chars as directory', () => {
      const hash = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
      const path = hashToPath(hash)
      expect(path.startsWith('objects/da/')).toBe(true)
    })

    it('should use remaining chars as filename', () => {
      const hash = '494179714a6cd627239dfededf2de9ef994caf03'
      const path = hashToPath(hash)
      expect(path).toBe('objects/49/4179714a6cd627239dfededf2de9ef994caf03')
      // Filename should be 38 chars (40 - 2 = 38)
      const filename = path.split('/')[2]
      expect(filename).toHaveLength(38)
    })

    it('should handle hash starting with zeros', () => {
      const hash = '00a4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash)
      expect(path).toBe('objects/00/a4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should handle hash starting with "ff"', () => {
      const hash = 'ff39a3ee5e6b4b0d3255bfef95601890afd80709'
      const path = hashToPath(hash)
      expect(path).toBe('objects/ff/39a3ee5e6b4b0d3255bfef95601890afd80709')
    })
  })

  describe('SHA-256 hashes (64 characters)', () => {
    it('should generate correct objects/xx/yyyy... format', () => {
      const hash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      const path = hashToPath(hash)
      expect(path).toBe('objects/2c/f24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('should use first 2 chars as directory', () => {
      const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      const path = hashToPath(hash)
      expect(path.startsWith('objects/e3/')).toBe(true)
    })

    it('should use remaining chars as filename', () => {
      const hash = '1f825aa2f0020ef7cf91dfa30da4668d791c5d4824fc8e41354b89ec05795ab3'
      const path = hashToPath(hash)
      expect(path).toBe('objects/1f/825aa2f0020ef7cf91dfa30da4668d791c5d4824fc8e41354b89ec05795ab3')
      // Filename should be 62 chars (64 - 2 = 62)
      const filename = path.split('/')[2]
      expect(filename).toHaveLength(62)
    })
  })

  describe('case sensitivity', () => {
    it('should accept lowercase hash', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      expect(() => hashToPath(hash)).not.toThrow()
    })

    it('should normalize uppercase hash to lowercase path', () => {
      const hash = 'AAF4C61DDCC5E8A2DABEDE0F3B482CD9AEA9434D'
      const path = hashToPath(hash)
      expect(path).toBe('objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should normalize mixed-case hash to lowercase path', () => {
      const hash = 'AaF4c61dDCC5e8a2dabede0f3B482cd9aea9434D'
      const path = hashToPath(hash)
      expect(path).toBe('objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })
  })

  describe('invalid hashes', () => {
    it('should reject hash that is too short', () => {
      const hash = 'aaf4c61'
      expect(() => hashToPath(hash)).toThrow()
    })

    it('should reject hash that is too long', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d00'
      expect(() => hashToPath(hash)).toThrow()
    })

    it('should reject hash with invalid length (not 40 or 64)', () => {
      // 50 characters - neither SHA-1 nor SHA-256
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d1234567890'
      expect(() => hashToPath(hash)).toThrow()
    })

    it('should reject hash with non-hex characters', () => {
      const hash = 'ghijklmnopqrstuvwxyzabcdef1234567890123456'
      expect(() => hashToPath(hash)).toThrow()
    })

    it('should reject empty string', () => {
      expect(() => hashToPath('')).toThrow()
    })

    it('should reject hash with spaces', () => {
      const hash = 'aaf4c61ddcc5e8a2 dabede0f3b482cd9aea9434d'
      expect(() => hashToPath(hash)).toThrow()
    })

    it('should reject hash with special characters', () => {
      const hash = 'aaf4c61ddcc5e8a2-dabede0f3b482cd9aea9434d'
      expect(() => hashToPath(hash)).toThrow()
    })
  })
})

describe('pathToHash', () => {
  describe('SHA-1 paths (40 character hashes)', () => {
    it('should extract hash correctly from path', () => {
      const path = 'objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path)
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should combine directory and filename into hash', () => {
      const path = 'objects/da/39a3ee5e6b4b0d3255bfef95601890afd80709'
      const hash = pathToHash(path)
      expect(hash).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    })

    it('should handle path starting with zeros', () => {
      const path = 'objects/00/a4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path)
      expect(hash).toBe('00a4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })
  })

  describe('SHA-256 paths (64 character hashes)', () => {
    it('should extract hash correctly from path', () => {
      const path = 'objects/2c/f24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      const hash = pathToHash(path)
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('should combine directory and filename for long hashes', () => {
      const path = 'objects/e3/b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      const hash = pathToHash(path)
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    })
  })

  describe('case handling', () => {
    it('should preserve lowercase in extracted hash', () => {
      const path = 'objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path)
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should normalize uppercase directory to lowercase hash', () => {
      const path = 'objects/AA/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path)
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should normalize uppercase filename to lowercase hash', () => {
      const path = 'objects/aa/F4C61DDCC5E8A2DABEDE0F3B482CD9AEA9434D'
      const hash = pathToHash(path)
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })
  })

  describe('invalid paths', () => {
    it('should reject path not starting with objects/', () => {
      const path = 'blobs/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      expect(() => pathToHash(path)).toThrow()
    })

    it('should reject path with wrong directory length', () => {
      const path = 'objects/aaa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434'
      expect(() => pathToHash(path)).toThrow()
    })

    it('should reject path with single char directory', () => {
      const path = 'objects/a/af4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      expect(() => pathToHash(path)).toThrow()
    })

    it('should reject empty path', () => {
      expect(() => pathToHash('')).toThrow()
    })

    it('should reject path with missing directory', () => {
      const path = 'objects/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      expect(() => pathToHash(path)).toThrow()
    })

    it('should reject path with non-hex directory', () => {
      const path = 'objects/gg/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      expect(() => pathToHash(path)).toThrow()
    })

    it('should reject path with non-hex filename', () => {
      const path = 'objects/aa/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
      expect(() => pathToHash(path)).toThrow()
    })
  })
})

describe('round-trip: hash -> path -> hash', () => {
  describe('SHA-1 hashes', () => {
    it('should round-trip correctly for known SHA-1 hash', () => {
      const originalHash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(originalHash)
      const extractedHash = pathToHash(path)
      expect(extractedHash).toBe(originalHash)
    })

    it('should round-trip correctly for hash starting with zeros', () => {
      const originalHash = '00a4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(originalHash)
      const extractedHash = pathToHash(path)
      expect(extractedHash).toBe(originalHash)
    })

    it('should round-trip correctly for hash ending with zeros', () => {
      const originalHash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea94300'
      const path = hashToPath(originalHash)
      const extractedHash = pathToHash(path)
      expect(extractedHash).toBe(originalHash)
    })

    it('should normalize uppercase to lowercase during round-trip', () => {
      const originalHash = 'AAF4C61DDCC5E8A2DABEDE0F3B482CD9AEA9434D'
      const path = hashToPath(originalHash)
      const extractedHash = pathToHash(path)
      expect(extractedHash).toBe(originalHash.toLowerCase())
    })
  })

  describe('SHA-256 hashes', () => {
    it('should round-trip correctly for known SHA-256 hash', () => {
      const originalHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      const path = hashToPath(originalHash)
      const extractedHash = pathToHash(path)
      expect(extractedHash).toBe(originalHash)
    })

    it('should round-trip correctly for SHA-256 hash starting with zeros', () => {
      const originalHash = '00b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      const path = hashToPath(originalHash)
      const extractedHash = pathToHash(path)
      expect(extractedHash).toBe(originalHash)
    })

    it('should normalize uppercase SHA-256 to lowercase during round-trip', () => {
      const originalHash = '2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824'
      const path = hashToPath(originalHash)
      const extractedHash = pathToHash(path)
      expect(extractedHash).toBe(originalHash.toLowerCase())
    })
  })
})

describe('round-trip: path -> hash -> path', () => {
  describe('SHA-1 paths', () => {
    it('should round-trip correctly for valid SHA-1 path', () => {
      const originalPath = 'objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(originalPath)
      const reconstructedPath = hashToPath(hash)
      expect(reconstructedPath).toBe(originalPath)
    })

    it('should normalize uppercase path during round-trip', () => {
      const originalPath = 'objects/AA/F4C61DDCC5E8A2DABEDE0F3B482CD9AEA9434D'
      const hash = pathToHash(originalPath)
      const reconstructedPath = hashToPath(hash)
      expect(reconstructedPath).toBe(originalPath.toLowerCase())
    })
  })

  describe('SHA-256 paths', () => {
    it('should round-trip correctly for valid SHA-256 path', () => {
      const originalPath = 'objects/2c/f24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      const hash = pathToHash(originalPath)
      const reconstructedPath = hashToPath(hash)
      expect(reconstructedPath).toBe(originalPath)
    })
  })
})

describe('configurable options', () => {
  describe('custom base directory', () => {
    it('should use custom base directory when specified', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash, { baseDir: 'blobs' })
      expect(path).toBe('blobs/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should handle nested base directory', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash, { baseDir: '.git/objects' })
      expect(path).toBe('.git/objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should strip trailing slash from base directory', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash, { baseDir: 'objects/' })
      expect(path).toBe('objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should use default "objects" when baseDir is empty string', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash, { baseDir: '' })
      expect(path).toBe('objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })
  })

  describe('custom prefix length', () => {
    it('should use 1-character prefix when prefixLen is 1', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash, { prefixLen: 1 })
      expect(path).toBe('objects/a/af4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should use 3-character prefix when prefixLen is 3', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash, { prefixLen: 3 })
      expect(path).toBe('objects/aaf/4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should use 4-character prefix when prefixLen is 4', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash, { prefixLen: 4 })
      expect(path).toBe('objects/aaf4/c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should reject prefixLen less than 1', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      expect(() => hashToPath(hash, { prefixLen: 0 })).toThrow('prefixLen must be between 1 and 8')
    })

    it('should reject prefixLen greater than 8', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      expect(() => hashToPath(hash, { prefixLen: 9 })).toThrow('prefixLen must be between 1 and 8')
    })

    it('should reject non-integer prefixLen', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      expect(() => hashToPath(hash, { prefixLen: 2.5 })).toThrow('prefixLen must be an integer')
    })
  })

  describe('combined options', () => {
    it('should apply both baseDir and prefixLen together', () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash, { baseDir: 'store', prefixLen: 3 })
      expect(path).toBe('store/aaf/4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should work with SHA-256 and custom options', () => {
      const hash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      const path = hashToPath(hash, { baseDir: 'cas', prefixLen: 4 })
      expect(path).toBe('cas/2cf2/4dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })
  })
})

describe('pathToHash with options', () => {
  describe('custom base directory', () => {
    it('should extract hash from custom base directory path', () => {
      const path = 'blobs/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path, { baseDir: 'blobs' })
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should handle nested base directory', () => {
      const path = '.git/objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path, { baseDir: '.git/objects' })
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should reject path that does not match baseDir', () => {
      const path = 'wrong/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      expect(() => pathToHash(path, { baseDir: 'blobs' })).toThrow()
    })
  })

  describe('custom prefix length', () => {
    it('should extract hash with 1-character prefix', () => {
      const path = 'objects/a/af4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path, { prefixLen: 1 })
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should extract hash with 3-character prefix', () => {
      const path = 'objects/aaf/4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path, { prefixLen: 3 })
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should extract hash with 4-character prefix', () => {
      const path = 'objects/aaf4/c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path, { prefixLen: 4 })
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should reject path with wrong prefix length', () => {
      const path = 'objects/aaa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434' // 3-char prefix
      expect(() => pathToHash(path, { prefixLen: 2 })).toThrow()
    })
  })

  describe('combined options', () => {
    it('should extract hash with both baseDir and prefixLen', () => {
      const path = 'store/aaf/4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const hash = pathToHash(path, { baseDir: 'store', prefixLen: 3 })
      expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should work with SHA-256 and custom options', () => {
      const path = 'cas/2cf2/4dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      const hash = pathToHash(path, { baseDir: 'cas', prefixLen: 4 })
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })
  })

  describe('round-trip with custom options', () => {
    it('should round-trip with custom baseDir', () => {
      const originalHash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const options = { baseDir: 'blobs' }
      const path = hashToPath(originalHash, options)
      const extractedHash = pathToHash(path, options)
      expect(extractedHash).toBe(originalHash)
    })

    it('should round-trip with custom prefixLen', () => {
      const originalHash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const options = { prefixLen: 3 }
      const path = hashToPath(originalHash, options)
      const extractedHash = pathToHash(path, options)
      expect(extractedHash).toBe(originalHash)
    })

    it('should round-trip with both custom options', () => {
      const originalHash = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      const options = { baseDir: 'store', prefixLen: 4 }
      const path = hashToPath(originalHash, options)
      const extractedHash = pathToHash(path, options)
      expect(extractedHash).toBe(originalHash)
    })
  })
})

describe('createPathMapper factory', () => {
  it('should create a mapper with default options', () => {
    const mapper = createPathMapper()
    const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
    expect(mapper.hashToPath(hash)).toBe('objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
  })

  it('should create a mapper with custom baseDir', () => {
    const mapper = createPathMapper({ baseDir: 'blobs' })
    const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
    expect(mapper.hashToPath(hash)).toBe('blobs/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
  })

  it('should create a mapper with custom prefixLen', () => {
    const mapper = createPathMapper({ prefixLen: 3 })
    const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
    expect(mapper.hashToPath(hash)).toBe('objects/aaf/4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
  })

  it('should create a mapper with both custom options', () => {
    const mapper = createPathMapper({ baseDir: 'store', prefixLen: 4 })
    const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
    expect(mapper.hashToPath(hash)).toBe('store/aaf4/c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    expect(mapper.pathToHash('store/aaf4/c61ddcc5e8a2dabede0f3b482cd9aea9434d')).toBe(hash)
  })

  it('should expose the options used to create the mapper', () => {
    const mapper = createPathMapper({ baseDir: 'cas', prefixLen: 3 })
    expect(mapper.options.baseDir).toBe('cas')
    expect(mapper.options.prefixLen).toBe(3)
  })
})

describe('validation utilities', () => {
  describe('isValidHash', () => {
    it('should return true for valid SHA-1 hash', () => {
      expect(isValidHash('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')).toBe(true)
    })

    it('should return true for valid SHA-256 hash', () => {
      expect(isValidHash('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')).toBe(true)
    })

    it('should return false for invalid length', () => {
      expect(isValidHash('aaf4c61')).toBe(false)
    })

    it('should return false for non-hex characters', () => {
      expect(isValidHash('gggggggggggggggggggggggggggggggggggggggg')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isValidHash('')).toBe(false)
    })

    it('should accept uppercase hex', () => {
      expect(isValidHash('AAF4C61DDCC5E8A2DABEDE0F3B482CD9AEA9434D')).toBe(true)
    })
  })

  describe('isValidPath', () => {
    it('should return true for valid path with default options', () => {
      expect(isValidPath('objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')).toBe(true)
    })

    it('should return true for valid path with custom baseDir', () => {
      expect(isValidPath('blobs/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d', { baseDir: 'blobs' })).toBe(true)
    })

    it('should return true for valid path with custom prefixLen', () => {
      expect(isValidPath('objects/aaf/4c61ddcc5e8a2dabede0f3b482cd9aea9434d', { prefixLen: 3 })).toBe(true)
    })

    it('should return false for path with wrong baseDir', () => {
      expect(isValidPath('wrong/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')).toBe(false)
    })

    it('should return false for path with wrong prefix length', () => {
      expect(isValidPath('objects/aaa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434')).toBe(false)
    })

    it('should return false for path with non-hex directory', () => {
      expect(isValidPath('objects/gg/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d')).toBe(false)
    })
  })
})

describe('edge cases', () => {
  it('should handle all possible 2-char hex prefixes', () => {
    // Test a sample of prefixes: 00, 0f, f0, ff, aa, 5a
    const prefixes = ['00', '0f', 'f0', 'ff', 'aa', '5a']
    for (const prefix of prefixes) {
      const hash = prefix + 'f4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const path = hashToPath(hash)
      expect(path).toBe(`objects/${prefix}/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d`)
    }
  })

  it('should handle hash with all same characters', () => {
    const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const path = hashToPath(hash)
    expect(path).toBe('objects/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('should handle hash with alternating characters', () => {
    const hash = 'abababababababababababababababababababab'
    const path = hashToPath(hash)
    expect(path).toBe('objects/ab/ababababababababababababababababababab')
  })

  it('should handle all-zeros SHA-1 hash', () => {
    const hash = '0000000000000000000000000000000000000000'
    const path = hashToPath(hash)
    expect(path).toBe('objects/00/00000000000000000000000000000000000000')
  })

  it('should handle all-fs SHA-1 hash', () => {
    const hash = 'ffffffffffffffffffffffffffffffffffffffff'
    const path = hashToPath(hash)
    expect(path).toBe('objects/ff/ffffffffffffffffffffffffffffffffffffff')
  })

  it('should handle all-zeros SHA-256 hash', () => {
    const hash = '0000000000000000000000000000000000000000000000000000000000000000'
    const path = hashToPath(hash)
    expect(path).toBe('objects/00/00000000000000000000000000000000000000000000000000000000000000')
  })

  it('should handle all-fs SHA-256 hash', () => {
    const hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    const path = hashToPath(hash)
    expect(path).toBe('objects/ff/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
  })
})
