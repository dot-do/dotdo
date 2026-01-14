import { describe, it, expect } from 'vitest'
import { generateSandboxCode, validateUserCode } from '../../../src/mcp/sandbox/template'

describe('generateSandboxCode', () => {
  it('should wrap user code in sandbox structure', () => {
    const userCode = 'console.log("hello")'
    const wrapped = generateSandboxCode(userCode)
    expect(wrapped).toContain(userCode)
    expect(wrapped).toContain('export default')
  })

  it('should expose store API to sandboxed code', () => {
    const wrapped = generateSandboxCode('store.getObject("abc")')
    expect(wrapped).toContain('store')
  })

  it('should intercept console.log calls', () => {
    const wrapped = generateSandboxCode('console.log("test")')
    expect(wrapped).toContain('console')
  })

  it('should handle async user code', () => {
    const wrapped = generateSandboxCode('await store.getObject("abc")')
    expect(wrapped).toContain('async')
  })
})

describe('validateUserCode', () => {
  it('should reject eval()', () => {
    const result = validateUserCode('eval("malicious")')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('eval')
  })

  it('should reject new Function()', () => {
    const result = validateUserCode('new Function("return 1")')
    expect(result.valid).toBe(false)
  })

  it('should reject process access', () => {
    const result = validateUserCode('process.env.SECRET')
    expect(result.valid).toBe(false)
  })

  it('should reject require()', () => {
    const result = validateUserCode('require("fs")')
    expect(result.valid).toBe(false)
  })

  it('should reject dynamic import()', () => {
    const result = validateUserCode('import("./malicious")')
    expect(result.valid).toBe(false)
  })

  it('should allow safe code', () => {
    const result = validateUserCode('const x = 1 + 2; console.log(x)')
    expect(result.valid).toBe(true)
  })
})
