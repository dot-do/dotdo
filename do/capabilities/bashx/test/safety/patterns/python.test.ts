// test/safety/patterns/python.test.ts
import { describe, it, expect } from 'vitest'
import { analyzePython } from '../../../core/safety/patterns/python.js'

describe('Python safety patterns', () => {
  describe('dangerous patterns', () => {
    it('should detect eval()', () => {
      const result = analyzePython('eval(user_input)')
      expect(result.impact).toBe('critical')
      expect(result.patterns).toContain('eval')
    })

    it('should detect exec()', () => {
      const result = analyzePython('exec(code)')
      expect(result.impact).toBe('critical')
      expect(result.patterns).toContain('exec')
    })

    it('should detect subprocess.call with shell=True', () => {
      const result = analyzePython('subprocess.call(cmd, shell=True)')
      expect(result.impact).toBe('high')
      expect(result.patterns).toContain('subprocess-shell')
    })

    it('should detect os.system()', () => {
      const result = analyzePython('os.system(command)')
      expect(result.impact).toBe('high')
      expect(result.patterns).toContain('os-system')
    })
  })

  describe('safe patterns', () => {
    it('should allow print()', () => {
      const result = analyzePython('print("hello")')
      expect(result.impact).toBe('none')
    })
  })
})
