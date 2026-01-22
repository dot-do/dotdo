/**
 * Stub fiu.h (Fault Injection Utility) for WASM builds
 * Fault injection is not available in WASM sandbox
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Flag values
#define FIU_ONETIME 0x1

// Stub function declarations (not macros, to avoid conflicts with fiu-control.h)
static inline int fiu_fail(const char *name) { (void)name; return 0; }
static inline void *fiu_failinfo(void) { return NULL; }

// Macro wrappers that use the functions
#define fiu_do_on(name, action)
#define fiu_exit_on(name)
#define fiu_return_on(name, retval)

#ifdef __cplusplus
}
#endif
