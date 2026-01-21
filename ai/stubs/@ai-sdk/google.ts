/**
 * Stub for @ai-sdk/google module during testing.
 * Throws MODULE_NOT_FOUND error to trigger mock fallback.
 */
const error = new Error('Cannot find package \'@ai-sdk/google\' - this is a test stub');
(error as Error & { code: string }).code = 'ERR_MODULE_NOT_FOUND';
throw error;
