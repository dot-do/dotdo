/**
 * Stub fiu-control.h for WASM builds
 * Fault injection control is not available in WASM sandbox
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// No-op stub functions
static inline int fiu_init(unsigned int flags) { (void)flags; return 0; }
static inline int fiu_enable(const char *name, int failnum, void *failinfo, unsigned int flags) {
    (void)name; (void)failnum; (void)failinfo; (void)flags;
    return 0;
}
static inline int fiu_enable_random(const char *name, double probability, int failnum, void *failinfo, unsigned int flags) {
    (void)name; (void)probability; (void)failnum; (void)failinfo; (void)flags;
    return 0;
}
static inline int fiu_disable(const char *name) { (void)name; return 0; }
static inline int fiu_rc_fifo(const char *basename) { (void)basename; return 0; }

#ifdef __cplusplus
}
#endif
