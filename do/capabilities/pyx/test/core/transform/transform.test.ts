import { describe, it, expect } from 'vitest'
import {
  wrapAsync,
  rewriteImports,
  wrapTopLevelAwait,
  capturePrint,
  extractReturnValue,
  mockInput,
  wrapExceptions,
} from '../../../core/transform'

describe('Python Code Transformations', () => {
  describe('Async Wrapping', () => {
    it('should wrap synchronous code in async function for Pyodide', () => {
      const input = `x = 1
y = 2
result = x + y`

      const output = wrapAsync(input)

      expect(output).toContain('async def')
      expect(output).toContain('x = 1')
      expect(output).toContain('y = 2')
      expect(output).toContain('result = x + y')
    })

    it('should preserve indentation when wrapping in async function', () => {
      const input = `def foo():
    return 42`

      const output = wrapAsync(input)

      expect(output).toMatch(/async def __pyx_main__\(\):/)
      // Inner code should be indented
      expect(output).toMatch(/\s{4}def foo\(\):/)
      expect(output).toMatch(/\s{8}return 42/)
    })

    it('should handle empty code', () => {
      const output = wrapAsync('')
      expect(output).toContain('async def')
    })
  })

  describe('Import Rewriting', () => {
    it('should rewrite numpy import for Pyodide compatibility', () => {
      const input = `import numpy as np`

      const output = rewriteImports(input)

      expect(output).toContain('await micropip.install')
      expect(output).toContain('numpy')
    })

    it('should rewrite pandas import for Pyodide compatibility', () => {
      const input = `import pandas as pd`

      const output = rewriteImports(input)

      expect(output).toContain('await micropip.install')
      expect(output).toContain('pandas')
    })

    it('should handle from-style imports', () => {
      const input = `from matplotlib import pyplot as plt`

      const output = rewriteImports(input)

      expect(output).toContain('await micropip.install')
      expect(output).toContain('matplotlib')
    })

    it('should not modify standard library imports', () => {
      const input = `import os
import sys
import json`

      const output = rewriteImports(input)

      expect(output).toBe(input)
    })

    it('should handle multiple imports on separate lines', () => {
      const input = `import numpy as np
import pandas as pd
import os`

      const output = rewriteImports(input)

      expect(output).toContain('numpy')
      expect(output).toContain('pandas')
      expect(output).not.toContain('micropip.install("os")')
    })
  })

  describe('Top-Level Await', () => {
    it('should wrap top-level await in async context', () => {
      const input = `result = await fetch_data()`

      const output = wrapTopLevelAwait(input)

      expect(output).toContain('async def')
      expect(output).toContain('await fetch_data()')
    })

    it('should detect and wrap code with top-level await', () => {
      const input = `data = await api.get("/users")
print(data)`

      const output = wrapTopLevelAwait(input)

      expect(output).toMatch(/async def/)
      expect(output).toContain('await api.get')
    })

    it('should not modify code without top-level await', () => {
      const input = `async def foo():
    return await bar()`

      const output = wrapTopLevelAwait(input)

      // Should not double-wrap
      expect(output).toBe(input)
    })
  })

  describe('Print Capture', () => {
    it('should redirect print() to stdout buffer', () => {
      const input = `print("Hello, World!")`

      const output = capturePrint(input)

      expect(output).toContain('__pyx_stdout__')
      expect(output).toContain('print("Hello, World!"')
    })

    it('should capture multiple print statements', () => {
      const input = `print("Line 1")
print("Line 2")
print("Line 3")`

      const output = capturePrint(input)

      expect(output).toContain('__pyx_stdout__')
      // All prints should be captured
      expect(output.match(/__pyx_stdout__/g)?.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle print with multiple arguments', () => {
      const input = `print("Name:", name, "Age:", age)`

      const output = capturePrint(input)

      expect(output).toContain('__pyx_stdout__')
    })

    it('should handle print with keyword arguments', () => {
      const input = `print("Hello", end="")`

      const output = capturePrint(input)

      expect(output).toContain('__pyx_stdout__')
      expect(output).toContain('end=""')
    })
  })

  describe('Return Value Extraction', () => {
    it('should capture the last expression value', () => {
      const input = `x = 5
y = 10
x + y`

      const output = extractReturnValue(input)

      expect(output).toContain('__pyx_result__')
      expect(output).toContain('x + y')
    })

    it('should not capture assignment as return value', () => {
      const input = `x = 5
y = 10
z = x + y`

      const output = extractReturnValue(input)

      // Assignment should not be treated as expression to return
      expect(output).not.toMatch(/__pyx_result__\s*=\s*z\s*=/)
    })

    it('should capture function call as last expression', () => {
      const input = `def compute():
    return 42

compute()`

      const output = extractReturnValue(input)

      expect(output).toContain('__pyx_result__')
      expect(output).toContain('compute()')
    })

    it('should handle code ending with comment', () => {
      const input = `result = 42
result  # Return this value`

      const output = extractReturnValue(input)

      expect(output).toContain('__pyx_result__')
    })
  })

  describe('Input Mocking', () => {
    it('should replace input() with async version', () => {
      const input = `name = input("Enter your name: ")`

      const output = mockInput(input)

      expect(output).toContain('await')
      expect(output).toContain('__pyx_input__')
    })

    it('should handle multiple input() calls', () => {
      const input = `name = input("Name: ")
age = input("Age: ")
city = input("City: ")`

      const output = mockInput(input)

      const awaitCount = (output.match(/await\s+__pyx_input__/g) || []).length
      expect(awaitCount).toBe(3)
    })

    it('should handle input() without prompt', () => {
      const input = `value = input()`

      const output = mockInput(input)

      expect(output).toContain('await')
      expect(output).toContain('__pyx_input__')
    })

    it('should preserve the prompt string', () => {
      const input = `name = input("What is your name? ")`

      const output = mockInput(input)

      expect(output).toContain('What is your name?')
    })
  })

  describe('Exception Wrapping', () => {
    it('should wrap code to capture and serialize exceptions', () => {
      const input = `x = 1 / 0`

      const output = wrapExceptions(input)

      expect(output).toContain('try:')
      expect(output).toContain('except')
      expect(output).toContain('__pyx_error__')
    })

    it('should capture exception type and message', () => {
      const input = `raise ValueError("Invalid value")`

      const output = wrapExceptions(input)

      expect(output).toContain('try:')
      expect(output).toContain('except Exception as')
      expect(output).toContain('__pyx_error__')
    })

    it('should include traceback information', () => {
      const input = `def foo():
    raise RuntimeError("Something went wrong")
foo()`

      const output = wrapExceptions(input)

      expect(output).toContain('traceback')
    })

    it('should preserve original code structure inside try block', () => {
      const input = `x = 1
y = 2
z = x + y`

      const output = wrapExceptions(input)

      expect(output).toContain('x = 1')
      expect(output).toContain('y = 2')
      expect(output).toContain('z = x + y')
      expect(output).toContain('try:')
    })
  })

  describe('Combined Transformations', () => {
    it('should handle code requiring multiple transformations', () => {
      const input = `import numpy as np
data = await fetch_data()
result = np.sum(data)
print(result)
result`

      // Apply transformations in sequence
      let code = rewriteImports(input)
      code = wrapTopLevelAwait(code)
      code = capturePrint(code)
      code = extractReturnValue(code)
      code = wrapExceptions(code)
      code = wrapAsync(code)

      expect(code).toContain('async def')
      expect(code).toContain('micropip.install')
      expect(code).toContain('__pyx_stdout__')
      expect(code).toContain('__pyx_result__')
      expect(code).toContain('try:')
    })
  })
})
