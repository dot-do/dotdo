/**
 * Stub for ai (Vercel AI SDK) module during testing.
 *
 * This stub is used when the real ai package is not installed.
 * It throws a MODULE_NOT_FOUND-like error that triggers the mock fallback.
 *
 * @module ai/stubs/ai
 */

// Throw an error that matches the pattern in isModuleNotFoundError()
const error = new Error('Cannot find package \'ai\' - this is a test stub');
(error as Error & { code: string }).code = 'ERR_MODULE_NOT_FOUND';
throw error;
