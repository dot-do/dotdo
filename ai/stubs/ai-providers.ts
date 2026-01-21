/**
 * Stub for ai-providers module during testing.
 *
 * This stub is used when the real ai-providers package is not installed.
 * It throws a MODULE_NOT_FOUND-like error that triggers the mock fallback
 * in the models.ts module.
 *
 * @module ai/stubs/ai-providers
 */

// Throw an error that matches the pattern in isModuleNotFoundError()
const error = new Error('Cannot find package \'ai-providers\' - this is a test stub');
(error as Error & { code: string }).code = 'ERR_MODULE_NOT_FOUND';
throw error;
