/**
 * WASM stub implementations for POSIX functions not available in Emscripten
 * This file provides C-linkage stubs for POSIX functions that don't exist in WASM.
 *
 * NOTE: Thread scheduling stubs (sched_get_priority_min/max, pthread_setschedparam)
 * are already provided by Poco Foundation in Thread_POSIX.cpp under __EMSCRIPTEN__.
 * Do NOT duplicate them here to avoid linker duplicate symbol errors.
 */

#include <errno.h>
#include <stddef.h>

#ifdef __EMSCRIPTEN__

extern "C" {

// Process spawning stub (not possible in WASM)
typedef void* posix_spawn_file_actions_t;
typedef void* posix_spawnattr_t;

int posix_spawnp(
    int *pid,
    const char *file,
    const posix_spawn_file_actions_t *file_actions,
    const posix_spawnattr_t *attrp,
    char *const argv[],
    char *const envp[])
{
    (void)pid;
    (void)file;
    (void)file_actions;
    (void)attrp;
    (void)argv;
    (void)envp;
    // Cannot spawn processes in WASM
    errno = ENOSYS;
    return -1;
}

} // extern "C"

#endif // __EMSCRIPTEN__
