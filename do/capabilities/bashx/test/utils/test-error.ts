/**
 * Type-safe test error class with common error properties.
 */
export class TestError extends Error {
  code?: string
  errno?: number
  killed?: boolean
  stdout?: string
  stderr?: string
  syscall?: string

  static withCode(message: string, code: string): TestError {
    const err = new TestError(message)
    err.code = code
    return err
  }

  static processError(
    message: string,
    options: {
      killed?: boolean
      stdout?: string
      stderr?: string
    }
  ): TestError {
    const err = new TestError(message)
    Object.assign(err, options)
    return err
  }
}
