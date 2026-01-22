/**
 * wasm_threadpool_stub.h - Single-threaded ThreadPool stub for WASM
 *
 * This header provides a ThreadPool implementation that executes all tasks
 * synchronously/inline in the calling thread. WASM has limited threading
 * support (SharedArrayBuffer + Web Workers), so we provide a single-threaded
 * fallback that maintains API compatibility.
 *
 * Key Design Decisions:
 * - All tasks execute immediately when scheduled (no queuing)
 * - No actual threads are created
 * - Exceptions propagate directly to the caller
 * - wait() is a no-op since tasks complete synchronously
 *
 * Usage:
 *   #ifdef __EMSCRIPTEN__
 *   #include "wasm_threadpool_stub.h"
 *   #endif
 */

#pragma once

#ifdef __EMSCRIPTEN__

#include <cstdint>
#include <functional>
#include <exception>
#include <future>
#include <memory>
#include <vector>
#include <atomic>

#include <Common/CurrentMetrics.h>
#include <Common/Priority.h>

namespace DB
{

/**
 * Single-threaded ThreadPool stub for WASM.
 *
 * This implementation runs all scheduled tasks inline (synchronously)
 * in the thread that calls schedule(). This provides API compatibility
 * with the real ThreadPool while working in WASM's single-threaded
 * environment.
 */
template <typename Thread>
class WasmThreadPoolImpl
{
public:
    static constexpr int MAX_THEORETICAL_THREAD_COUNT = 1; // Single-threaded

    using Job = std::function<void()>;
    using Metric = CurrentMetrics::Metric;

    // Constructors matching ThreadPoolImpl interface
    WasmThreadPoolImpl(Metric /*metric_threads_*/, Metric /*metric_active_threads_*/, Metric /*metric_scheduled_jobs_*/)
        : max_threads(1), max_free_threads(0), queue_size(0) {}

    explicit WasmThreadPoolImpl(
        Metric /*metric_threads_*/,
        Metric /*metric_active_threads_*/,
        Metric /*metric_scheduled_jobs_*/,
        size_t /*max_threads_*/)
        : max_threads(1), max_free_threads(0), queue_size(0) {}

    WasmThreadPoolImpl(
        Metric /*metric_threads_*/,
        Metric /*metric_active_threads_*/,
        Metric /*metric_scheduled_jobs_*/,
        size_t /*max_threads_*/,
        size_t /*max_free_threads_*/,
        size_t /*queue_size_*/,
        bool /*shutdown_on_exception_*/ = true)
        : max_threads(1), max_free_threads(0), queue_size(0) {}

    ~WasmThreadPoolImpl()
    {
        // Run any callbacks registered for destruction
        while (!on_destroy_callbacks.empty())
        {
            on_destroy_callbacks.back()();
            on_destroy_callbacks.pop_back();
        }
    }

    /**
     * Execute job immediately (synchronously).
     * In single-threaded WASM, we run the job inline.
     */
    void scheduleOrThrowOnError(Job job, Priority /*priority*/ = {})
    {
        ++scheduled_jobs;
        try
        {
            job();
        }
        catch (...)
        {
            --scheduled_jobs;
            first_exception = std::current_exception();
            throw;
        }
        --scheduled_jobs;
    }

    /**
     * Try to schedule - always succeeds in single-threaded mode
     * since we execute inline immediately.
     */
    [[nodiscard]] bool trySchedule(Job job, Priority priority = {}, uint64_t /*wait_microseconds*/ = 0) noexcept
    {
        try
        {
            scheduleOrThrowOnError(std::move(job), priority);
            return true;
        }
        catch (...)
        {
            return false;
        }
    }

    /**
     * Schedule with timeout - timeout is ignored in single-threaded mode.
     */
    void scheduleOrThrow(Job job, Priority priority = {}, uint64_t /*wait_microseconds*/ = 0, bool /*propagate_opentelemetry_tracing_context*/ = true)
    {
        scheduleOrThrowOnError(std::move(job), priority);
    }

    /**
     * Wait for all jobs - no-op since jobs execute synchronously.
     * Rethrows any captured exception.
     */
    void wait()
    {
        if (first_exception)
        {
            auto ex = first_exception;
            first_exception = nullptr;
            std::rethrow_exception(ex);
        }
    }

    /**
     * Returns number of running and scheduled jobs.
     * In synchronous mode, this is always 0 after a call completes.
     */
    size_t active() const { return scheduled_jobs.load(); }

    /**
     * Check if pool is finished/shutdown.
     */
    [[nodiscard]] bool finished() const { return shutdown; }

    // Configuration methods - stored but not used in single-threaded mode
    void setMaxThreads(size_t value) { max_threads = value; }
    void setMaxFreeThreads(size_t value) { max_free_threads = value; }
    void setQueueSize(size_t value) { queue_size = value; }
    size_t getMaxThreads() const { return max_threads; }
    size_t getMaxFreeThreads() const { return max_free_threads; }
    size_t getQueueSize() const { return queue_size; }

    using OnDestroyCallback = std::function<void()>;
    void addOnDestroyCallback(OnDestroyCallback && callback)
    {
        on_destroy_callbacks.push_back(std::move(callback));
    }

private:
    size_t max_threads;
    size_t max_free_threads;
    size_t queue_size;
    std::atomic<size_t> scheduled_jobs{0};
    bool shutdown = false;
    std::exception_ptr first_exception;
    std::vector<OnDestroyCallback> on_destroy_callbacks;
};


/**
 * GlobalThreadPool stub for WASM - singleton pattern.
 */
class WasmGlobalThreadPool : public WasmThreadPoolImpl<void*>
{
    static std::unique_ptr<WasmGlobalThreadPool> the_instance;

    WasmGlobalThreadPool()
        : WasmThreadPoolImpl<void*>(
            CurrentMetrics::Metric{}, CurrentMetrics::Metric{}, CurrentMetrics::Metric{})
    {}

public:
    uint64_t global_profiler_real_time_period_ns = 0;
    uint64_t global_profiler_cpu_time_period_ns = 0;

    static void initialize(
        size_t /*max_threads*/ = 10000,
        size_t /*max_free_threads*/ = 1000,
        size_t /*queue_size*/ = 10000,
        uint64_t /*global_profiler_real_time_period_ns_*/ = 0,
        uint64_t /*global_profiler_cpu_time_period_ns_*/ = 0)
    {
        if (!the_instance)
            the_instance = std::unique_ptr<WasmGlobalThreadPool>(new WasmGlobalThreadPool());
    }

    static WasmGlobalThreadPool & instance()
    {
        if (!the_instance)
            initialize();
        return *the_instance;
    }

    static void shutdown()
    {
        the_instance.reset();
    }
};


/**
 * ThreadFromGlobalPool stub - runs function inline immediately.
 *
 * In real ClickHouse, this schedules work on GlobalThreadPool.
 * In WASM, we execute the function synchronously in the constructor.
 */
template <bool propagate_opentelemetry_context = true, bool global_trace_collector_allowed = true>
class WasmThreadFromGlobalPoolImpl
{
public:
    WasmThreadFromGlobalPoolImpl() = default;

    template <typename Function, typename... Args>
    explicit WasmThreadFromGlobalPoolImpl(Function && func, Args &&... args)
    {
        // Execute synchronously instead of scheduling
        completed = false;
        try
        {
            std::invoke(std::forward<Function>(func), std::forward<Args>(args)...);
            completed = true;
        }
        catch (...)
        {
            exception = std::current_exception();
            completed = true;
        }
    }

    WasmThreadFromGlobalPoolImpl(WasmThreadFromGlobalPoolImpl && rhs) noexcept
        : completed(rhs.completed.load()), exception(std::move(rhs.exception))
    {
        rhs.completed = true;
    }

    WasmThreadFromGlobalPoolImpl & operator=(WasmThreadFromGlobalPoolImpl && rhs) noexcept
    {
        completed = rhs.completed.load();
        exception = std::move(rhs.exception);
        rhs.completed = true;
        return *this;
    }

    ~WasmThreadFromGlobalPoolImpl() = default;

    void join()
    {
        // Task already completed synchronously
        if (exception)
            std::rethrow_exception(exception);
        completed = true;
    }

    void detach()
    {
        // No-op - task already completed
        completed = true;
    }

    bool joinable() const
    {
        return !completed.load();
    }

    std::thread::id get_id() const
    {
        return std::this_thread::get_id();
    }

private:
    std::atomic<bool> completed{true};
    std::exception_ptr exception;
};

// Type aliases matching the real ThreadPool interface
using WasmFreeThreadPool = WasmThreadPoolImpl<void*>;
using WasmThreadFromGlobalPoolNoTracingContextPropagation = WasmThreadFromGlobalPoolImpl<false, true>;
using WasmThreadFromGlobalPool = WasmThreadFromGlobalPoolImpl<true, true>;
using WasmThreadFromGlobalPoolWithoutTraceCollector = WasmThreadFromGlobalPoolImpl<true, false>;
using WasmThreadPool = WasmThreadPoolImpl<WasmThreadFromGlobalPoolNoTracingContextPropagation>;


/**
 * ThreadPoolCallbackRunner stub for WASM.
 * Executes callbacks immediately and returns a ready future.
 */
template <typename Result, typename Callback = std::function<Result()>>
class WasmThreadPoolCallbackRunnerLocal final
{
public:
    WasmThreadPoolCallbackRunnerLocal(WasmThreadPool & /*pool*/, const std::string & /*thread_name*/)
    {}

    ~WasmThreadPoolCallbackRunnerLocal() = default;

    void operator() (Callback && callback, Priority /*priority*/ = {}, std::optional<uint64_t> /*wait_microseconds*/ = {})
    {
        std::promise<Result> promise;
        try
        {
            if constexpr (std::is_void_v<Result>)
            {
                callback();
                promise.set_value();
            }
            else
            {
                promise.set_value(callback());
            }
        }
        catch (...)
        {
            promise.set_exception(std::current_exception());
        }
        futures.push_back(promise.get_future());
    }

    void waitForAllToFinish()
    {
        // All tasks already completed synchronously
    }

    void waitForAllToFinishAndRethrowFirstError()
    {
        for (auto & future : futures)
        {
            if (future.valid())
                future.get();
        }
        futures.clear();
    }

private:
    std::vector<std::future<Result>> futures;
};


/**
 * ThreadPoolCallbackRunnerUnsafe type alias for WASM.
 * Returns a function that executes callbacks immediately.
 */
template <typename Result, typename Callback = std::function<Result()>>
using WasmThreadPoolCallbackRunnerUnsafe = std::function<std::future<Result>(Callback &&, Priority)>;

template <typename Result, typename Callback = std::function<Result()>>
WasmThreadPoolCallbackRunnerUnsafe<Result, Callback> wasmThreadPoolCallbackRunnerUnsafe(
    WasmThreadPool & /*pool*/, const std::string & /*thread_name*/)
{
    return [](Callback && callback, Priority /*priority*/) -> std::future<Result>
    {
        std::promise<Result> promise;
        try
        {
            if constexpr (std::is_void_v<Result>)
            {
                callback();
                promise.set_value();
            }
            else
            {
                promise.set_value(callback());
            }
        }
        catch (...)
        {
            promise.set_exception(std::current_exception());
        }
        return promise.get_future();
    };
}

} // namespace DB


// Redirect real types to WASM stubs when building for Emscripten
#ifdef WASM_SINGLE_THREADED

namespace DB
{
    // Replace ThreadPoolImpl with WASM version
    template <typename Thread>
    using ThreadPoolImpl = WasmThreadPoolImpl<Thread>;

    using FreeThreadPool = WasmFreeThreadPool;
    using GlobalThreadPool = WasmGlobalThreadPool;

    template <bool A, bool B>
    using ThreadFromGlobalPoolImpl = WasmThreadFromGlobalPoolImpl<A, B>;

    using ThreadFromGlobalPoolNoTracingContextPropagation = WasmThreadFromGlobalPoolNoTracingContextPropagation;
    using ThreadFromGlobalPool = WasmThreadFromGlobalPool;
    using ThreadFromGlobalPoolWithoutTraceCollector = WasmThreadFromGlobalPoolWithoutTraceCollector;
    using ThreadPool = WasmThreadPool;

    template <typename Result, typename PoolT = ThreadPool, typename Callback = std::function<Result()>>
    using ThreadPoolCallbackRunnerLocal = WasmThreadPoolCallbackRunnerLocal<Result, Callback>;

    template <typename Result, typename Callback = std::function<Result()>>
    using ThreadPoolCallbackRunnerUnsafe = WasmThreadPoolCallbackRunnerUnsafe<Result, Callback>;
}

#endif // WASM_SINGLE_THREADED

#endif // __EMSCRIPTEN__
