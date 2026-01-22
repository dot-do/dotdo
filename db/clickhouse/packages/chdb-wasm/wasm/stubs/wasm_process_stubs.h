/**
 * wasm_process_stubs.h - Process spawning stubs for WASM
 *
 * WASM cannot spawn processes. This header declares stub implementations
 * for process spawning functions that return -1 with errno=ENOTSUP.
 *
 * STUBBED FUNCTIONS
 * =================
 *
 * Process Creation:
 * - fork()        - Creates a new process by duplicating the calling process
 * - vfork()       - Creates a new process with shared memory
 *
 * Program Execution:
 * - execl()       - Execute a file with argument list
 * - execlp()      - Execute a file with argument list (searches PATH)
 * - execle()      - Execute a file with argument list and environment
 * - execv()       - Execute a file with argument vector
 * - execvp()      - Execute a file with argument vector (searches PATH)
 * - execve()      - Execute a file with argument vector and environment
 * - execvpe()     - Execute a file with argument vector, environment (searches PATH)
 *
 * Shell Commands:
 * - system()      - Execute a shell command
 * - popen()       - Open a process by creating a pipe
 * - pclose()      - Close a pipe opened by popen()
 *
 * POSIX Spawn:
 * - posix_spawn()      - Spawn a new process
 * - posix_spawnp()     - Spawn a new process (searches PATH)
 *
 * WHY THESE ARE STUBBED
 * =====================
 *
 * WebAssembly runs in a sandboxed environment without access to the
 * operating system's process management facilities. These functions
 * fundamentally cannot work in WASM because:
 *
 * 1. No process isolation - WASM runs as a single logical process
 * 2. No kernel interface - No syscalls for process creation
 * 3. Security model - WASM's sandbox prevents process spawning
 *
 * USAGE
 * =====
 *
 * Link wasm_process_stubs.cpp with your WASM build. The stubs will
 * override the libc implementations.
 *
 * BEHAVIOR
 * ========
 *
 * All stubbed functions:
 * - Return -1 (or NULL for popen)
 * - Set errno to ENOTSUP (Operation not supported)
 * - Do not perform any actual process operations
 *
 * AFFECTED CLICKHOUSE COMPONENTS
 * ==============================
 *
 * - ShellCommand (src/Common/ShellCommand.cpp)
 *   Uses vfork() + execv() for external command execution
 *
 * - BaseDaemon (src/Daemon/BaseDaemon.cpp)
 *   Uses fork() for daemon mode and watchdog processes
 *
 * - EnvironmentChecks (src/Common/EnvironmentChecks.cpp)
 *   Uses execvp() for environment validation
 *
 * - ReplxxLineReader (src/Client/ReplxxLineReader.cpp)
 *   Uses execvp() for external editor integration
 */

#ifndef CLICKHOUSE_WASM_PROCESS_STUBS_H
#define CLICKHOUSE_WASM_PROCESS_STUBS_H

#ifdef __EMSCRIPTEN__

#include <sys/types.h>
#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Stub for fork() - Returns -1 with errno=ENOTSUP
 *
 * In WASM, process forking is not possible as there is no OS-level
 * process management available.
 */
pid_t fork(void);

/**
 * Stub for vfork() - Returns -1 with errno=ENOTSUP
 *
 * vfork() is a variant of fork() with shared memory, equally
 * unsupported in WASM.
 */
pid_t vfork(void);

/**
 * Stub for execl() - Returns -1 with errno=ENOTSUP
 *
 * Execute a file with a NULL-terminated argument list.
 */
int execl(const char *path, const char *arg, ...);

/**
 * Stub for execlp() - Returns -1 with errno=ENOTSUP
 *
 * Execute a file (searching PATH) with a NULL-terminated argument list.
 */
int execlp(const char *file, const char *arg, ...);

/**
 * Stub for execle() - Returns -1 with errno=ENOTSUP
 *
 * Execute a file with argument list and environment.
 */
int execle(const char *path, const char *arg, ...);

/**
 * Stub for execv() - Returns -1 with errno=ENOTSUP
 *
 * Execute a file with an argument vector.
 */
int execv(const char *path, char *const argv[]);

/**
 * Stub for execvp() - Returns -1 with errno=ENOTSUP
 *
 * Execute a file (searching PATH) with an argument vector.
 */
int execvp(const char *file, char *const argv[]);

/**
 * Stub for execve() - Returns -1 with errno=ENOTSUP
 *
 * Execute a file with argument vector and environment.
 */
int execve(const char *path, char *const argv[], char *const envp[]);

/**
 * Stub for execvpe() - Returns -1 with errno=ENOTSUP
 *
 * Execute a file (searching PATH) with argument vector and environment.
 * Note: This is a GNU extension, not POSIX.
 */
int execvpe(const char *file, char *const argv[], char *const envp[]);

/**
 * Stub for system() - Returns -1 with errno=ENOTSUP
 *
 * Execute a shell command. Returns -1 since no shell is available.
 */
int system(const char *command);

/**
 * Stub for popen() - Returns NULL with errno=ENOTSUP
 *
 * Open a pipe to a process. Returns NULL since process spawning
 * is not available.
 */
FILE *popen(const char *command, const char *type);

/**
 * Stub for pclose() - Returns -1 with errno=ENOTSUP
 *
 * Close a pipe opened by popen(). Returns -1 since popen() always
 * returns NULL.
 */
int pclose(FILE *stream);

/**
 * Stub for posix_spawn() - Returns ENOTSUP
 *
 * Spawn a new process. Returns ENOTSUP (not -1) per POSIX spec.
 */
int posix_spawn(pid_t *pid, const char *path,
                const void *file_actions,
                const void *attrp,
                char *const argv[], char *const envp[]);

/**
 * Stub for posix_spawnp() - Returns ENOTSUP
 *
 * Spawn a new process (searching PATH). Returns ENOTSUP per POSIX spec.
 */
int posix_spawnp(pid_t *pid, const char *file,
                 const void *file_actions,
                 const void *attrp,
                 char *const argv[], char *const envp[]);

#ifdef __cplusplus
}
#endif

#endif /* __EMSCRIPTEN__ */

#endif /* CLICKHOUSE_WASM_PROCESS_STUBS_H */
