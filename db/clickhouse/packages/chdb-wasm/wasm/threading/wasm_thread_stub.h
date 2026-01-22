/**
 * wasm_thread_stub.h - Single-threaded std::thread replacement for WASM
 *
 * This header provides a std::thread-compatible interface that executes
 * functions synchronously instead of creating actual threads. WASM has
 * limited threading support, and this stub allows code to compile and
 * run in single-threaded mode.
 *
 * Key Features:
 * - Same API as std::thread
 * - Functions execute synchronously in constructor
 * - join()/detach() are no-ops since work is already complete
 * - Thread-local storage emulated via regular variables
 *
 * Usage:
 *   #ifdef __EMSCRIPTEN__
 *   #include "wasm_thread_stub.h"
 *   // Use wasm::thread instead of std::thread
 *   #endif
 */

#pragma once

#ifdef __EMSCRIPTEN__

#include <functional>
#include <memory>
#include <exception>
#include <atomic>
#include <thread>
#include <utility>
#include <tuple>

namespace wasm
{

/**
 * Single-threaded thread stub for WASM.
 *
 * This class provides a std::thread-compatible interface that executes
 * the callable synchronously in the constructor, rather than spawning
 * a new thread.
 *
 * Thread State Machine:
 * - Constructed without callable: not joinable
 * - Constructed with callable: executes immediately, then joinable
 * - After join(): not joinable
 * - After detach(): not joinable
 *
 * Exception Handling:
 * - Exceptions from the callable are captured and rethrown on join()
 * - If detach() is called, exceptions are silently ignored
 */
class thread
{
public:
    using id = std::thread::id;
    using native_handle_type = void*;

    /**
     * Default constructor - creates non-joinable thread.
     */
    thread() noexcept : state(std::make_shared<State>())
    {
        state->joinable = false;
        state->detached = false;
    }

    /**
     * Construct and execute function synchronously.
     *
     * Unlike std::thread, this does NOT create a new thread.
     * Instead, the function is executed immediately in the
     * calling thread's context.
     */
    template <typename Callable, typename... Args>
    explicit thread(Callable&& func, Args&&... args)
        : state(std::make_shared<State>())
    {
        state->joinable = true;
        state->detached = false;

        // Execute synchronously
        try
        {
            std::invoke(std::forward<Callable>(func), std::forward<Args>(args)...);
        }
        catch (...)
        {
            state->exception = std::current_exception();
        }
    }

    /**
     * Move constructor.
     */
    thread(thread&& other) noexcept
        : state(std::move(other.state))
    {
        other.state = std::make_shared<State>();
        other.state->joinable = false;
        other.state->detached = false;
    }

    /**
     * Move assignment.
     */
    thread& operator=(thread&& other) noexcept
    {
        if (this != &other)
        {
            // If we're joinable, we would need to std::terminate() per std::thread semantics
            // but in WASM stub we're more lenient
            state = std::move(other.state);
            other.state = std::make_shared<State>();
            other.state->joinable = false;
            other.state->detached = false;
        }
        return *this;
    }

    // Disable copy
    thread(const thread&) = delete;
    thread& operator=(const thread&) = delete;

    /**
     * Destructor - if joinable, would call std::terminate().
     * In WASM stub, we're lenient and just clean up.
     */
    ~thread()
    {
        // std::thread would call std::terminate() if joinable
        // We're more lenient in the stub
    }

    /**
     * Wait for thread completion and rethrow any exception.
     *
     * Since we execute synchronously, the work is already done.
     * This just marks the thread as joined and rethrows any exception.
     */
    void join()
    {
        if (!state->joinable)
        {
            throw std::system_error(
                std::make_error_code(std::errc::invalid_argument),
                "thread not joinable");
        }

        state->joinable = false;

        if (state->exception)
        {
            std::rethrow_exception(state->exception);
        }
    }

    /**
     * Detach the thread.
     *
     * Since we execute synchronously, the work is already done.
     * This just marks the thread as detached.
     */
    void detach()
    {
        if (!state->joinable)
        {
            throw std::system_error(
                std::make_error_code(std::errc::invalid_argument),
                "thread not joinable");
        }

        state->joinable = false;
        state->detached = true;
        // Exceptions are ignored for detached threads
    }

    /**
     * Check if thread is joinable.
     */
    [[nodiscard]] bool joinable() const noexcept
    {
        return state && state->joinable;
    }

    /**
     * Get thread ID.
     * Returns current thread ID since we run synchronously.
     */
    [[nodiscard]] id get_id() const noexcept
    {
        return std::this_thread::get_id();
    }

    /**
     * Get native handle - not applicable in WASM stub.
     */
    [[nodiscard]] native_handle_type native_handle()
    {
        return nullptr;
    }

    /**
     * Returns hardware concurrency hint.
     * In WASM single-threaded mode, always returns 1.
     */
    [[nodiscard]] static unsigned int hardware_concurrency() noexcept
    {
        return 1;
    }

    /**
     * Swap thread objects.
     */
    void swap(thread& other) noexcept
    {
        std::swap(state, other.state);
    }

private:
    struct State
    {
        bool joinable = false;
        bool detached = false;
        std::exception_ptr exception;
    };

    std::shared_ptr<State> state;
};

/**
 * Swap two thread objects.
 */
inline void swap(thread& lhs, thread& rhs) noexcept
{
    lhs.swap(rhs);
}


/**
 * this_thread namespace - utilities for the current thread.
 */
namespace this_thread
{

/**
 * Get current thread ID.
 */
inline thread::id get_id() noexcept
{
    return std::this_thread::get_id();
}

/**
 * Yield processor hint.
 * No-op in single-threaded WASM.
 */
inline void yield() noexcept
{
    // No-op - single threaded
}

/**
 * Sleep for a duration.
 * Note: This could use emscripten_sleep in async mode.
 */
template <typename Rep, typename Period>
void sleep_for(const std::chrono::duration<Rep, Period>& /*sleep_duration*/)
{
    // In WASM without ASYNCIFY, sleep would block the entire runtime.
    // In single-threaded mode, we just return immediately.
    // With ASYNCIFY enabled, you could use emscripten_sleep().
}

/**
 * Sleep until a time point.
 */
template <typename Clock, typename Duration>
void sleep_until(const std::chrono::time_point<Clock, Duration>& /*sleep_time*/)
{
    // Same limitation as sleep_for
}

} // namespace this_thread


/**
 * jthread stub - joinable thread with stop token support.
 * Simplified implementation for WASM single-threaded mode.
 */
class jthread
{
public:
    using id = thread::id;
    using native_handle_type = thread::native_handle_type;

    jthread() noexcept = default;

    template <typename Callable, typename... Args>
    explicit jthread(Callable&& func, Args&&... args)
        : inner_thread(std::forward<Callable>(func), std::forward<Args>(args)...)
        , stop_requested_(false)
    {}

    ~jthread()
    {
        if (inner_thread.joinable())
        {
            request_stop();
            inner_thread.join();
        }
    }

    // Move only
    jthread(jthread&& other) noexcept = default;
    jthread& operator=(jthread&& other) noexcept
    {
        if (this != &other)
        {
            if (inner_thread.joinable())
            {
                request_stop();
                inner_thread.join();
            }
            inner_thread = std::move(other.inner_thread);
            stop_requested_.store(other.stop_requested_.load());
        }
        return *this;
    }

    jthread(const jthread&) = delete;
    jthread& operator=(const jthread&) = delete;

    void join() { inner_thread.join(); }
    void detach() { inner_thread.detach(); }
    [[nodiscard]] bool joinable() const noexcept { return inner_thread.joinable(); }
    [[nodiscard]] id get_id() const noexcept { return inner_thread.get_id(); }
    [[nodiscard]] native_handle_type native_handle() { return inner_thread.native_handle(); }

    [[nodiscard]] static unsigned int hardware_concurrency() noexcept
    {
        return thread::hardware_concurrency();
    }

    void swap(jthread& other) noexcept
    {
        inner_thread.swap(other.inner_thread);
        bool temp = stop_requested_.load();
        stop_requested_.store(other.stop_requested_.load());
        other.stop_requested_.store(temp);
    }

    bool request_stop() noexcept
    {
        bool expected = false;
        return stop_requested_.compare_exchange_strong(expected, true);
    }

    [[nodiscard]] bool stop_requested() const noexcept
    {
        return stop_requested_.load();
    }

private:
    thread inner_thread;
    std::atomic<bool> stop_requested_{false};
};

inline void swap(jthread& lhs, jthread& rhs) noexcept
{
    lhs.swap(rhs);
}

} // namespace wasm


// Provide std-like interface when WASM_SINGLE_THREADED is defined
#ifdef WASM_SINGLE_THREADED

namespace std
{
    // Note: We can't actually replace std::thread, but code can use
    // wasm::thread directly or through a typedef
}

#endif // WASM_SINGLE_THREADED

#endif // __EMSCRIPTEN__
