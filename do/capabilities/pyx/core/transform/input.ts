/**
 * Input mocking utilities for browser-based Python execution
 */

/**
 * Replace input() calls with async version for browser compatibility.
 * Transforms input(...) to await __pyx_input__(...).
 */
export function mockInput(code: string): string {
  // Replace input(...) with await __pyx_input__(...)
  // Handle both input() and input("prompt")
  // The regex matches:
  // - input() - empty call
  // - input("string") - with string argument
  // - input(variable) - with variable
  // - But not words ending in "input" like "myinput()"

  // Use a regex that matches standalone input( calls
  return code.replace(/\binput\s*\(/g, 'await __pyx_input__(')
}
