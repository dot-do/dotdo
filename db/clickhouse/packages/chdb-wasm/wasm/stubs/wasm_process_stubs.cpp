/**
 * wasm_process_stubs.cpp - Process spawning stubs for WASM
 *
 * WASM cannot spawn processes. This file provides stub implementations
 * for process spawning functions that return -1 with errno=ENOTSUP.
 *
 * All functions follow POSIX semantics for error returns:
 * - fork/vfork: return -1, set errno
 * - exec* family: return -1, set errno (never return on success)
 * - system: return -1, set errno
 * - popen: return NULL, set errno
 * - pclose: return -1, set errno
 * - posix_spawn*: return error code directly (per POSIX)
 *
 * CLICKHOUSE USAGE PATTERNS
 * =========================
 *
 * ShellCommand.cpp:
 *   pid_t pid = vfork();
 *   if (pid == -1)
 *       throw ErrnoException("Cannot vfork");
 *   if (pid == 0) {
 *       execv(filename, argv);
 *       _exit(CANNOT_EXEC);
 *   }
 *
 * With our stubs:
 *   - vfork() returns -1
 *   - ShellCommand throws "Cannot vfork" exception
 *   - This is the expected behavior for WASM builds
 *
 * BaseDaemon.cpp:
 *   pid = fork();
 *   if (pid < 0)
 *       throw Exception("Cannot fork");
 *
 * With our stubs:
 *   - fork() returns -1
 *   - BaseDaemon throws "Cannot fork" exception
 *   - Daemon mode and watchdog disabled in WASM
 */

#ifdef __EMSCRIPTEN__

#include "wasm_process_stubs.h"

#include <errno.h>
#include <stdarg.h>
#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * ENOTSUP (95 on Linux, 45 on macOS) indicates that the operation
 * is not supported. This is the appropriate error for WASM where
 * process operations are fundamentally impossible.
 *
 * Alternative considered: ENOSYS (Function not implemented)
 * We chose ENOTSUP because the functions ARE implemented (as stubs),
 * they just cannot perform their operation in this environment.
 */

/* ========================================================================
 * Process Creation
 * ======================================================================== */

pid_t fork(void)
{
    errno = ENOTSUP;
    return -1;
}

pid_t vfork(void)
{
    errno = ENOTSUP;
    return -1;
}

/* ========================================================================
 * exec* Family - Program Execution
 *
 * All exec* functions replace the current process image with a new one.
 * On success, they never return. On failure, they return -1 and set errno.
 * Since we always fail, we always return -1.
 * ======================================================================== */

int execl(const char *path, const char *arg, ...)
{
    (void)path;
    (void)arg;
    errno = ENOTSUP;
    return -1;
}

int execlp(const char *file, const char *arg, ...)
{
    (void)file;
    (void)arg;
    errno = ENOTSUP;
    return -1;
}

int execle(const char *path, const char *arg, ...)
{
    (void)path;
    (void)arg;
    errno = ENOTSUP;
    return -1;
}

int execv(const char *path, char *const argv[])
{
    (void)path;
    (void)argv;
    errno = ENOTSUP;
    return -1;
}

int execvp(const char *file, char *const argv[])
{
    (void)file;
    (void)argv;
    errno = ENOTSUP;
    return -1;
}

int execve(const char *path, char *const argv[], char *const envp[])
{
    (void)path;
    (void)argv;
    (void)envp;
    errno = ENOTSUP;
    return -1;
}

int execvpe(const char *file, char *const argv[], char *const envp[])
{
    (void)file;
    (void)argv;
    (void)envp;
    errno = ENOTSUP;
    return -1;
}

/* ========================================================================
 * Shell Commands
 * ======================================================================== */

int system(const char *command)
{
    (void)command;
    /*
     * Per POSIX, system(NULL) should return non-zero if a shell is available.
     * Since no shell is available in WASM, return 0 for NULL command.
     */
    if (command == NULL) {
        return 0;  /* No shell available */
    }
    errno = ENOTSUP;
    return -1;
}

FILE *popen(const char *command, const char *type)
{
    (void)command;
    (void)type;
    errno = ENOTSUP;
    return NULL;
}

int pclose(FILE *stream)
{
    (void)stream;
    errno = ENOTSUP;
    return -1;
}

/* ========================================================================
 * POSIX Spawn
 *
 * Unlike other functions, posix_spawn* return error codes directly
 * instead of returning -1 and setting errno.
 * ======================================================================== */

int posix_spawn(pid_t *pid, const char *path,
                const void *file_actions,
                const void *attrp,
                char *const argv[], char *const envp[])
{
    (void)pid;
    (void)path;
    (void)file_actions;
    (void)attrp;
    (void)argv;
    (void)envp;
    return ENOTSUP;
}

int posix_spawnp(pid_t *pid, const char *file,
                 const void *file_actions,
                 const void *attrp,
                 char *const argv[], char *const envp[])
{
    (void)pid;
    (void)file;
    (void)file_actions;
    (void)attrp;
    (void)argv;
    (void)envp;
    return ENOTSUP;
}

#ifdef __cplusplus
}
#endif

#endif /* __EMSCRIPTEN__ */
