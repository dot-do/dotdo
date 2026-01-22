/**
 * WASM stub implementations for POSIX functions not available in Emscripten
 */

#include <errno.h>
#include <stddef.h>

#ifdef __EMSCRIPTEN__

// Thread scheduling stubs
int sched_get_priority_min(int policy) {
    (void)policy;
    return 0;
}

int sched_get_priority_max(int policy) {
    (void)policy;
    return 99;  // Default Linux maximum
}

struct sched_param;
typedef unsigned long pthread_t;

int pthread_setschedparam(pthread_t thread, int policy, const struct sched_param *param) {
    (void)thread;
    (void)policy;
    (void)param;
    // Silently succeed - thread priorities aren't meaningful in WASM single-threaded context
    return 0;
}

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

#endif // __EMSCRIPTEN__
