/**
 * wasm_mutex_stub.h - No-op mutex implementations for single-threaded WASM
 *
 * This header provides mutex/synchronization primitive stubs that compile
 * but do nothing, since there's no contention in single-threaded mode.
 *
 * Key Design:
 * - All lock operations are no-ops
 * - All try_lock operations always succeed
 * - Condition variables work but never actually wait
 * - Atomics use relaxed ordering (no actual memory barriers needed)
 *
 * Thread Safety:
 * - These stubs are NOT thread-safe
 * - They are ONLY for single-threaded WASM builds
 * - Using these with actual threads will cause data races
 *
 * Usage:
 *   #ifdef __EMSCRIPTEN__
 *   #include "wasm_mutex_stub.h"
 *   #endif
 */

#pragma once

#ifdef __EMSCRIPTEN__

#include <chrono>
#include <system_error>

namespace wasm
{

/**
 * No-op mutex for single-threaded WASM.
 *
 * All operations are no-ops since there's no contention.
 * Compatible with std::mutex interface.
 */
class mutex
{
public:
    constexpr mutex() noexcept = default;
    ~mutex() = default;

    // Non-copyable, non-movable (same as std::mutex)
    mutex(const mutex&) = delete;
    mutex& operator=(const mutex&) = delete;

    /**
     * Lock the mutex (no-op in single-threaded mode).
     */
    void lock() noexcept
    {
        // No-op - single threaded means no contention
        locked_ = true;
    }

    /**
     * Try to lock the mutex (always succeeds).
     */
    [[nodiscard]] bool try_lock() noexcept
    {
        locked_ = true;
        return true;
    }

    /**
     * Unlock the mutex (no-op in single-threaded mode).
     */
    void unlock() noexcept
    {
        locked_ = false;
    }

    using native_handle_type = void*;
    [[nodiscard]] native_handle_type native_handle() noexcept { return nullptr; }

private:
    bool locked_ = false; // For debugging/assertions if needed
};


/**
 * No-op recursive mutex for single-threaded WASM.
 */
class recursive_mutex
{
public:
    constexpr recursive_mutex() noexcept = default;
    ~recursive_mutex() = default;

    recursive_mutex(const recursive_mutex&) = delete;
    recursive_mutex& operator=(const recursive_mutex&) = delete;

    void lock() noexcept { ++lock_count_; }
    [[nodiscard]] bool try_lock() noexcept { ++lock_count_; return true; }
    void unlock() noexcept { if (lock_count_ > 0) --lock_count_; }

    using native_handle_type = void*;
    [[nodiscard]] native_handle_type native_handle() noexcept { return nullptr; }

private:
    unsigned int lock_count_ = 0;
};


/**
 * No-op timed mutex for single-threaded WASM.
 */
class timed_mutex
{
public:
    constexpr timed_mutex() noexcept = default;
    ~timed_mutex() = default;

    timed_mutex(const timed_mutex&) = delete;
    timed_mutex& operator=(const timed_mutex&) = delete;

    void lock() noexcept { locked_ = true; }
    [[nodiscard]] bool try_lock() noexcept { locked_ = true; return true; }
    void unlock() noexcept { locked_ = false; }

    template <typename Rep, typename Period>
    [[nodiscard]] bool try_lock_for(const std::chrono::duration<Rep, Period>&) noexcept
    {
        locked_ = true;
        return true;
    }

    template <typename Clock, typename Duration>
    [[nodiscard]] bool try_lock_until(const std::chrono::time_point<Clock, Duration>&) noexcept
    {
        locked_ = true;
        return true;
    }

    using native_handle_type = void*;
    [[nodiscard]] native_handle_type native_handle() noexcept { return nullptr; }

private:
    bool locked_ = false;
};


/**
 * No-op recursive timed mutex for single-threaded WASM.
 */
class recursive_timed_mutex
{
public:
    constexpr recursive_timed_mutex() noexcept = default;
    ~recursive_timed_mutex() = default;

    recursive_timed_mutex(const recursive_timed_mutex&) = delete;
    recursive_timed_mutex& operator=(const recursive_timed_mutex&) = delete;

    void lock() noexcept { ++lock_count_; }
    [[nodiscard]] bool try_lock() noexcept { ++lock_count_; return true; }
    void unlock() noexcept { if (lock_count_ > 0) --lock_count_; }

    template <typename Rep, typename Period>
    [[nodiscard]] bool try_lock_for(const std::chrono::duration<Rep, Period>&) noexcept
    {
        ++lock_count_;
        return true;
    }

    template <typename Clock, typename Duration>
    [[nodiscard]] bool try_lock_until(const std::chrono::time_point<Clock, Duration>&) noexcept
    {
        ++lock_count_;
        return true;
    }

    using native_handle_type = void*;
    [[nodiscard]] native_handle_type native_handle() noexcept { return nullptr; }

private:
    unsigned int lock_count_ = 0;
};


/**
 * No-op shared mutex (read-write lock) for single-threaded WASM.
 */
class shared_mutex
{
public:
    constexpr shared_mutex() noexcept = default;
    ~shared_mutex() = default;

    shared_mutex(const shared_mutex&) = delete;
    shared_mutex& operator=(const shared_mutex&) = delete;

    // Exclusive ownership
    void lock() noexcept { exclusive_locked_ = true; }
    [[nodiscard]] bool try_lock() noexcept { exclusive_locked_ = true; return true; }
    void unlock() noexcept { exclusive_locked_ = false; }

    // Shared ownership
    void lock_shared() noexcept { ++shared_count_; }
    [[nodiscard]] bool try_lock_shared() noexcept { ++shared_count_; return true; }
    void unlock_shared() noexcept { if (shared_count_ > 0) --shared_count_; }

    using native_handle_type = void*;
    [[nodiscard]] native_handle_type native_handle() noexcept { return nullptr; }

private:
    bool exclusive_locked_ = false;
    unsigned int shared_count_ = 0;
};


/**
 * No-op shared timed mutex for single-threaded WASM.
 */
class shared_timed_mutex
{
public:
    constexpr shared_timed_mutex() noexcept = default;
    ~shared_timed_mutex() = default;

    shared_timed_mutex(const shared_timed_mutex&) = delete;
    shared_timed_mutex& operator=(const shared_timed_mutex&) = delete;

    // Exclusive ownership
    void lock() noexcept { exclusive_locked_ = true; }
    [[nodiscard]] bool try_lock() noexcept { exclusive_locked_ = true; return true; }
    void unlock() noexcept { exclusive_locked_ = false; }

    template <typename Rep, typename Period>
    [[nodiscard]] bool try_lock_for(const std::chrono::duration<Rep, Period>&) noexcept
    {
        exclusive_locked_ = true;
        return true;
    }

    template <typename Clock, typename Duration>
    [[nodiscard]] bool try_lock_until(const std::chrono::time_point<Clock, Duration>&) noexcept
    {
        exclusive_locked_ = true;
        return true;
    }

    // Shared ownership
    void lock_shared() noexcept { ++shared_count_; }
    [[nodiscard]] bool try_lock_shared() noexcept { ++shared_count_; return true; }
    void unlock_shared() noexcept { if (shared_count_ > 0) --shared_count_; }

    template <typename Rep, typename Period>
    [[nodiscard]] bool try_lock_shared_for(const std::chrono::duration<Rep, Period>&) noexcept
    {
        ++shared_count_;
        return true;
    }

    template <typename Clock, typename Duration>
    [[nodiscard]] bool try_lock_shared_until(const std::chrono::time_point<Clock, Duration>&) noexcept
    {
        ++shared_count_;
        return true;
    }

    using native_handle_type = void*;
    [[nodiscard]] native_handle_type native_handle() noexcept { return nullptr; }

private:
    bool exclusive_locked_ = false;
    unsigned int shared_count_ = 0;
};


/**
 * No-op condition variable for single-threaded WASM.
 *
 * In single-threaded mode, waiting on a condition variable would
 * deadlock (no other thread to signal). We return immediately
 * with a spurious wakeup, which is allowed by the C++ standard.
 */
class condition_variable
{
public:
    constexpr condition_variable() noexcept = default;
    ~condition_variable() = default;

    condition_variable(const condition_variable&) = delete;
    condition_variable& operator=(const condition_variable&) = delete;

    /**
     * Notify one waiting thread (no-op).
     */
    void notify_one() noexcept
    {
        // No-op - no threads to notify
    }

    /**
     * Notify all waiting threads (no-op).
     */
    void notify_all() noexcept
    {
        // No-op - no threads to notify
    }

    /**
     * Wait on condition (returns immediately - spurious wakeup).
     *
     * In single-threaded mode, actually waiting would deadlock.
     * We return immediately, which is a valid spurious wakeup.
     */
    template <typename Lock>
    void wait(Lock& lock)
    {
        // Spurious wakeup - return immediately
        // Caller should check condition in a loop (standard pattern)
        (void)lock;
    }

    /**
     * Wait with predicate.
     *
     * WARNING: If predicate is false, this will spin forever in single-threaded mode!
     * Caller must ensure predicate can become true without other threads.
     */
    template <typename Lock, typename Predicate>
    void wait(Lock& lock, Predicate pred)
    {
        while (!pred())
        {
            wait(lock);
            // In single-threaded mode, if pred() is false, this is an infinite loop!
            // We break after one iteration to avoid deadlock, treating it as spurious wakeup.
            break;
        }
    }

    /**
     * Wait with timeout (returns immediately - timeout).
     */
    template <typename Lock, typename Rep, typename Period>
    std::cv_status wait_for(Lock& /*lock*/, const std::chrono::duration<Rep, Period>& /*rel_time*/)
    {
        // Return timeout immediately - single threaded can't wait
        return std::cv_status::timeout;
    }

    /**
     * Wait with timeout and predicate.
     */
    template <typename Lock, typename Rep, typename Period, typename Predicate>
    bool wait_for(Lock& lock, const std::chrono::duration<Rep, Period>& rel_time, Predicate pred)
    {
        (void)lock;
        (void)rel_time;
        return pred();
    }

    /**
     * Wait until time point (returns immediately - timeout).
     */
    template <typename Lock, typename Clock, typename Duration>
    std::cv_status wait_until(Lock& /*lock*/, const std::chrono::time_point<Clock, Duration>& /*abs_time*/)
    {
        return std::cv_status::timeout;
    }

    /**
     * Wait until time point with predicate.
     */
    template <typename Lock, typename Clock, typename Duration, typename Predicate>
    bool wait_until(Lock& lock, const std::chrono::time_point<Clock, Duration>& abs_time, Predicate pred)
    {
        (void)lock;
        (void)abs_time;
        return pred();
    }

    using native_handle_type = void*;
    [[nodiscard]] native_handle_type native_handle() noexcept { return nullptr; }
};


/**
 * No-op condition_variable_any for single-threaded WASM.
 * Same as condition_variable but works with any lock type.
 */
class condition_variable_any
{
public:
    constexpr condition_variable_any() noexcept = default;
    ~condition_variable_any() = default;

    condition_variable_any(const condition_variable_any&) = delete;
    condition_variable_any& operator=(const condition_variable_any&) = delete;

    void notify_one() noexcept {}
    void notify_all() noexcept {}

    template <typename Lock>
    void wait(Lock& lock) { (void)lock; }

    template <typename Lock, typename Predicate>
    void wait(Lock& lock, Predicate pred)
    {
        while (!pred())
        {
            wait(lock);
            break;
        }
    }

    template <typename Lock, typename Rep, typename Period>
    std::cv_status wait_for(Lock& /*lock*/, const std::chrono::duration<Rep, Period>& /*rel_time*/)
    {
        return std::cv_status::timeout;
    }

    template <typename Lock, typename Rep, typename Period, typename Predicate>
    bool wait_for(Lock& lock, const std::chrono::duration<Rep, Period>& rel_time, Predicate pred)
    {
        (void)lock;
        (void)rel_time;
        return pred();
    }

    template <typename Lock, typename Clock, typename Duration>
    std::cv_status wait_until(Lock& /*lock*/, const std::chrono::time_point<Clock, Duration>& /*abs_time*/)
    {
        return std::cv_status::timeout;
    }

    template <typename Lock, typename Clock, typename Duration, typename Predicate>
    bool wait_until(Lock& lock, const std::chrono::time_point<Clock, Duration>& abs_time, Predicate pred)
    {
        (void)lock;
        (void)abs_time;
        return pred();
    }
};


/**
 * No-op once_flag for single-threaded WASM.
 */
struct once_flag
{
    constexpr once_flag() noexcept = default;

    once_flag(const once_flag&) = delete;
    once_flag& operator=(const once_flag&) = delete;

    bool called = false;
};

/**
 * Call once implementation for single-threaded WASM.
 */
template <typename Callable, typename... Args>
void call_once(once_flag& flag, Callable&& func, Args&&... args)
{
    if (!flag.called)
    {
        flag.called = true;
        std::invoke(std::forward<Callable>(func), std::forward<Args>(args)...);
    }
}


/**
 * Lock guard compatible with wasm::mutex.
 */
template <typename Mutex>
class lock_guard
{
public:
    using mutex_type = Mutex;

    explicit lock_guard(mutex_type& m) : mutex_(m)
    {
        mutex_.lock();
    }

    lock_guard(mutex_type& m, std::adopt_lock_t) noexcept : mutex_(m)
    {
        // Already locked
    }

    ~lock_guard()
    {
        mutex_.unlock();
    }

    lock_guard(const lock_guard&) = delete;
    lock_guard& operator=(const lock_guard&) = delete;

private:
    mutex_type& mutex_;
};


/**
 * Unique lock compatible with wasm mutexes.
 */
template <typename Mutex>
class unique_lock
{
public:
    using mutex_type = Mutex;

    unique_lock() noexcept : mutex_(nullptr), owns_(false) {}

    explicit unique_lock(mutex_type& m) : mutex_(&m), owns_(false)
    {
        mutex_->lock();
        owns_ = true;
    }

    unique_lock(mutex_type& m, std::defer_lock_t) noexcept
        : mutex_(&m), owns_(false) {}

    unique_lock(mutex_type& m, std::try_to_lock_t)
        : mutex_(&m), owns_(m.try_lock()) {}

    unique_lock(mutex_type& m, std::adopt_lock_t) noexcept
        : mutex_(&m), owns_(true) {}

    ~unique_lock()
    {
        if (owns_)
            mutex_->unlock();
    }

    unique_lock(unique_lock&& other) noexcept
        : mutex_(other.mutex_), owns_(other.owns_)
    {
        other.mutex_ = nullptr;
        other.owns_ = false;
    }

    unique_lock& operator=(unique_lock&& other) noexcept
    {
        if (owns_)
            mutex_->unlock();
        mutex_ = other.mutex_;
        owns_ = other.owns_;
        other.mutex_ = nullptr;
        other.owns_ = false;
        return *this;
    }

    unique_lock(const unique_lock&) = delete;
    unique_lock& operator=(const unique_lock&) = delete;

    void lock()
    {
        mutex_->lock();
        owns_ = true;
    }

    bool try_lock()
    {
        owns_ = mutex_->try_lock();
        return owns_;
    }

    void unlock()
    {
        mutex_->unlock();
        owns_ = false;
    }

    void swap(unique_lock& other) noexcept
    {
        std::swap(mutex_, other.mutex_);
        std::swap(owns_, other.owns_);
    }

    mutex_type* release() noexcept
    {
        mutex_type* ret = mutex_;
        mutex_ = nullptr;
        owns_ = false;
        return ret;
    }

    [[nodiscard]] bool owns_lock() const noexcept { return owns_; }
    explicit operator bool() const noexcept { return owns_; }
    [[nodiscard]] mutex_type* mutex() const noexcept { return mutex_; }

private:
    mutex_type* mutex_;
    bool owns_;
};


/**
 * Shared lock compatible with wasm shared_mutex.
 */
template <typename Mutex>
class shared_lock
{
public:
    using mutex_type = Mutex;

    shared_lock() noexcept : mutex_(nullptr), owns_(false) {}

    explicit shared_lock(mutex_type& m) : mutex_(&m), owns_(false)
    {
        mutex_->lock_shared();
        owns_ = true;
    }

    shared_lock(mutex_type& m, std::defer_lock_t) noexcept
        : mutex_(&m), owns_(false) {}

    shared_lock(mutex_type& m, std::try_to_lock_t)
        : mutex_(&m), owns_(m.try_lock_shared()) {}

    shared_lock(mutex_type& m, std::adopt_lock_t) noexcept
        : mutex_(&m), owns_(true) {}

    ~shared_lock()
    {
        if (owns_)
            mutex_->unlock_shared();
    }

    shared_lock(shared_lock&& other) noexcept
        : mutex_(other.mutex_), owns_(other.owns_)
    {
        other.mutex_ = nullptr;
        other.owns_ = false;
    }

    shared_lock& operator=(shared_lock&& other) noexcept
    {
        if (owns_)
            mutex_->unlock_shared();
        mutex_ = other.mutex_;
        owns_ = other.owns_;
        other.mutex_ = nullptr;
        other.owns_ = false;
        return *this;
    }

    shared_lock(const shared_lock&) = delete;
    shared_lock& operator=(const shared_lock&) = delete;

    void lock()
    {
        mutex_->lock_shared();
        owns_ = true;
    }

    bool try_lock()
    {
        owns_ = mutex_->try_lock_shared();
        return owns_;
    }

    void unlock()
    {
        mutex_->unlock_shared();
        owns_ = false;
    }

    void swap(shared_lock& other) noexcept
    {
        std::swap(mutex_, other.mutex_);
        std::swap(owns_, other.owns_);
    }

    mutex_type* release() noexcept
    {
        mutex_type* ret = mutex_;
        mutex_ = nullptr;
        owns_ = false;
        return ret;
    }

    [[nodiscard]] bool owns_lock() const noexcept { return owns_; }
    explicit operator bool() const noexcept { return owns_; }
    [[nodiscard]] mutex_type* mutex() const noexcept { return mutex_; }

private:
    mutex_type* mutex_;
    bool owns_;
};

} // namespace wasm

#endif // __EMSCRIPTEN__
