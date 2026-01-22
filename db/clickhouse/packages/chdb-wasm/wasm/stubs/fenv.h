/**
 * Stub fenv.h for WASM builds
 * Floating-point environment control is not available in WASM sandbox
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Rounding mode constants
#define FE_TONEAREST  0
#define FE_DOWNWARD   1
#define FE_UPWARD     2
#define FE_TOWARDZERO 3

// Exception constants
#define FE_DIVBYZERO  1
#define FE_INEXACT    2
#define FE_INVALID    4
#define FE_OVERFLOW   8
#define FE_UNDERFLOW  16
#define FE_ALL_EXCEPT (FE_DIVBYZERO | FE_INEXACT | FE_INVALID | FE_OVERFLOW | FE_UNDERFLOW)

// Default environment
#define FE_DFL_ENV ((const fenv_t*)-1)

typedef unsigned int fexcept_t;
typedef unsigned int fenv_t;

// Exception handling stubs
static inline int feclearexcept(int excepts) { (void)excepts; return 0; }
static inline int fegetexceptflag(fexcept_t *flagp, int excepts) { (void)flagp; (void)excepts; return 0; }
static inline int feraiseexcept(int excepts) { (void)excepts; return 0; }
static inline int fesetexceptflag(const fexcept_t *flagp, int excepts) { (void)flagp; (void)excepts; return 0; }
static inline int fetestexcept(int excepts) { (void)excepts; return 0; }

// Rounding mode stubs
static inline int fegetround(void) { return FE_TONEAREST; }
static inline int fesetround(int round) { (void)round; return 0; }

// Environment stubs
static inline int fegetenv(fenv_t *envp) { (void)envp; return 0; }
static inline int feholdexcept(fenv_t *envp) { (void)envp; return 0; }
static inline int fesetenv(const fenv_t *envp) { (void)envp; return 0; }
static inline int feupdateenv(const fenv_t *envp) { (void)envp; return 0; }

#ifdef __cplusplus
}
#endif
