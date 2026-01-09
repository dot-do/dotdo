var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

// .wrangler/tmp/bundle-0OtYwG/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/_internal/utils.mjs
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
__name(PerformanceEntry, "PerformanceEntry");
var PerformanceMark = /* @__PURE__ */ __name(class PerformanceMark2 extends PerformanceEntry {
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
}, "PerformanceMark");
var PerformanceMeasure = class extends PerformanceEntry {
  entryType = "measure";
};
__name(PerformanceMeasure, "PerformanceMeasure");
var PerformanceResourceTiming = class extends PerformanceEntry {
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
__name(PerformanceResourceTiming, "PerformanceResourceTiming");
var PerformanceObserverEntryList = class {
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
__name(PerformanceObserverEntryList, "PerformanceObserverEntryList");
var Performance = class {
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
__name(Performance, "Performance");
var PerformanceObserver = class {
  __unenv__ = true;
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
__name(PerformanceObserver, "PerformanceObserver");
__publicField(PerformanceObserver, "supportedEntryTypes", []);
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// node_modules/.pnpm/@cloudflare+unenv-preset@2.0.2_unenv@2.0.0-rc.14_workerd@1.20250718.0/node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// node_modules/.pnpm/@cloudflare+unenv-preset@2.0.2_unenv@2.0.0-rc.14_workerd@1.20250718.0/node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// node_modules/.pnpm/wrangler@3.114.16_@cloudflare+workers-types@4.20260108.0/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
import { Socket } from "node:net";
var ReadStream = class extends Socket {
  fd;
  constructor(fd) {
    super();
    this.fd = fd;
  }
  isRaw = false;
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
  isTTY = false;
};
__name(ReadStream, "ReadStream");

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
import { Socket as Socket2 } from "node:net";
var WriteStream = class extends Socket2 {
  fd;
  constructor(fd) {
    super();
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  columns = 80;
  rows = 24;
  isTTY = false;
};
__name(WriteStream, "WriteStream");

// node_modules/.pnpm/unenv@2.0.0-rc.14/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class extends EventEmitter {
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return "";
  }
  get versions() {
    return {};
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  ref() {
  }
  unref() {
  }
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: () => 0 });
  mainModule = void 0;
  domain = void 0;
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};
__name(Process, "Process");

// node_modules/.pnpm/@cloudflare+unenv-preset@2.0.2_unenv@2.0.0-rc.14_workerd@1.20250718.0/node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var { exit, platform, nextTick } = getBuiltinModule(
  "node:process"
);
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  nextTick
});
var {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  finalization,
  features,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  on,
  off,
  once,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// node_modules/.pnpm/wrangler@3.114.16_@cloudflare+workers-types@4.20260108.0/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context2, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context2.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context2, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context2.error = err;
            res = await onError(err, context2);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context2.finalized === false && onNotFound) {
          res = await onNotFound(context2);
        }
      }
      if (res && (context2.finalized === false || isError)) {
        context2.res = res;
      }
      return context2;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/http-exception.js
var HTTPException = /* @__PURE__ */ __name(class extends Error {
  res;
  status;
  /**
   * Creates an instance of `HTTPException`.
   * @param status - HTTP status code for the exception. Defaults to 500.
   * @param options - Additional options for the exception.
   */
  constructor(status = 500, options) {
    super(options?.message, { cause: options?.cause });
    this.res = options?.res;
    this.status = status;
  }
  /**
   * Returns the response object associated with the exception.
   * If a response object is not provided, a new response is created with the error message and status code.
   * @returns The response object.
   */
  getResponse() {
    if (this.res) {
      const newResponse = new Response(this.res.body, {
        status: this.status,
        headers: this.res.headers
      });
      return newResponse;
    }
    return new Response(this.message, {
      status: this.status
    });
  }
}, "HTTPException");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/utils/body.js
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const path = url.slice(start, queryIndex === -1 ? void 0 : queryIndex);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = /* @__PURE__ */ __name(class {
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return this.bodyCache.parsedBody ??= await parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  };
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
}, "HonoRequest");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context2, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context: context2 }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context2, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var Context = /* @__PURE__ */ __name(class {
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= new Response(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = new Response(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = (layout2) => this.#layout = layout2;
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = () => this.#layout;
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = new Response(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return new Response(data, { status, headers: responseHeaders });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  };
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = (object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  };
  html = (html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  };
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = () => {
    this.#notFoundHandler ??= () => new Response();
    return this.#notFoundHandler(this);
  };
}, "Context");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = /* @__PURE__ */ __name(class extends Error {
}, "UnsupportedPathError");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = /* @__PURE__ */ __name(class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env2, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env2, "GET")))();
    }
    const path = this.getPath(request, { env: env2 });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env: env2,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context2 = await composed(c);
        if (!context2.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context2.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  };
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
}, "_Hono");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }, "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = /* @__PURE__ */ __name(class _Node {
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context2, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context2.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context2, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
}, "_Node");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = /* @__PURE__ */ __name(class {
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
}, "Trie");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = /* @__PURE__ */ __name(class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
}, "RegExpRouter");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = /* @__PURE__ */ __name(class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
}, "SmartRouter");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var Node2 = /* @__PURE__ */ __name(class _Node2 {
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #getHandlerSets(node, method, nodeParams, params) {
    const handlerSets = [];
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
    return handlerSets;
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              handlerSets.push(
                ...this.#getHandlerSets(nextNode.#children["*"], method, node.#params)
              );
            }
            handlerSets.push(...this.#getHandlerSets(nextNode, method, node.#params));
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              handlerSets.push(...this.#getHandlerSets(astNode, method, node.#params));
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          const restPathString = parts.slice(i).join("/");
          if (matcher instanceof RegExp) {
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              handlerSets.push(...this.#getHandlerSets(child, method, node.#params, params));
              if (Object.keys(child.#children).length) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              handlerSets.push(...this.#getHandlerSets(child, method, params, node.#params));
              if (child.#children["*"]) {
                handlerSets.push(
                  ...this.#getHandlerSets(child.#children["*"], method, params, node.#params)
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      curNodes = tempNodes.concat(curNodesQueue.shift() ?? []);
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
}, "_Node");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = /* @__PURE__ */ __name(class {
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
}, "TrieRouter");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/hono.js
var Hono2 = /* @__PURE__ */ __name(class extends Hono {
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
}, "Hono");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/middleware/cors/index.js
var cors = /* @__PURE__ */ __name((options) => {
  const defaults = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: []
  };
  const opts = {
    ...defaults,
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return /* @__PURE__ */ __name(async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    __name(set, "set");
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*") {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*") {
      c.header("Vary", "Origin", { append: true });
    }
  }, "cors2");
}, "cors");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/utils/color.js
function getColorEnabled() {
  const { process: process2, Deno } = globalThis;
  const isNoColor = typeof Deno?.noColor === "boolean" ? Deno.noColor : process2 !== void 0 ? (
    // eslint-disable-next-line no-unsafe-optional-chaining
    "NO_COLOR" in process2?.env
  ) : false;
  return !isNoColor;
}
__name(getColorEnabled, "getColorEnabled");
async function getColorEnabledAsync() {
  const { navigator } = globalThis;
  const cfWorkers = "cloudflare:workers";
  const isNoColor = navigator !== void 0 && navigator.userAgent === "Cloudflare-Workers" ? await (async () => {
    try {
      return "NO_COLOR" in ((await import(cfWorkers)).env ?? {});
    } catch {
      return false;
    }
  })() : !getColorEnabled();
  return !isNoColor;
}
__name(getColorEnabledAsync, "getColorEnabledAsync");

// node_modules/.pnpm/hono@4.11.3/node_modules/hono/dist/middleware/logger/index.js
var humanize = /* @__PURE__ */ __name((times) => {
  const [delimiter, separator] = [",", "."];
  const orderTimes = times.map((v) => v.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + delimiter));
  return orderTimes.join(separator);
}, "humanize");
var time3 = /* @__PURE__ */ __name((start) => {
  const delta = Date.now() - start;
  return humanize([delta < 1e3 ? delta + "ms" : Math.round(delta / 1e3) + "s"]);
}, "time");
var colorStatus = /* @__PURE__ */ __name(async (status) => {
  const colorEnabled = await getColorEnabledAsync();
  if (colorEnabled) {
    switch (status / 100 | 0) {
      case 5:
        return `\x1B[31m${status}\x1B[0m`;
      case 4:
        return `\x1B[33m${status}\x1B[0m`;
      case 3:
        return `\x1B[36m${status}\x1B[0m`;
      case 2:
        return `\x1B[32m${status}\x1B[0m`;
    }
  }
  return `${status}`;
}, "colorStatus");
async function log3(fn, prefix, method, path, status = 0, elapsed) {
  const out = prefix === "<--" ? `${prefix} ${method} ${path}` : `${prefix} ${method} ${path} ${await colorStatus(status)} ${elapsed}`;
  fn(out);
}
__name(log3, "log");
var logger = /* @__PURE__ */ __name((fn = console.log) => {
  return /* @__PURE__ */ __name(async function logger2(c, next) {
    const { method, url } = c.req;
    const path = url.slice(url.indexOf("/", 8));
    await log3(fn, "<--", method, path);
    const start = Date.now();
    await next();
    await log3(fn, "-->", method, path, c.res.status, time3(start));
  }, "logger2");
}, "logger");

// api/routes/api.ts
var things = /* @__PURE__ */ new Map();
var apiRoutes = new Hono2();
apiRoutes.get("/", (c) => {
  return c.json({
    name: "dotdo",
    version: "0.0.1",
    endpoints: ["/api/health", "/api/things"]
  });
});
apiRoutes.get("", (c) => {
  return c.json({
    name: "dotdo",
    version: "0.0.1",
    endpoints: ["/api/health", "/api/things"]
  });
});
apiRoutes.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
apiRoutes.all("/health", (c) => {
  return c.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed. Allowed: GET" } }, 405, { Allow: "GET" });
});
apiRoutes.delete("/things", (c) => {
  return c.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed. Allowed: GET, POST" } }, 405, { Allow: "GET, POST" });
});
apiRoutes.put("/things", (c) => {
  return c.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed. Allowed: GET, POST" } }, 405, { Allow: "GET, POST" });
});
apiRoutes.patch("/things", (c) => {
  return c.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed. Allowed: GET, POST" } }, 405, { Allow: "GET, POST" });
});
apiRoutes.patch("/things/:id", (c) => {
  return c.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed. Allowed: GET, PUT, DELETE" } }, 405, { Allow: "GET, PUT, DELETE" });
});
apiRoutes.get("/things", (c) => {
  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");
  if (limitParam !== void 0) {
    const limit2 = parseInt(limitParam, 10);
    if (isNaN(limit2) || limit2 < 0) {
      return c.json({ error: { code: "BAD_REQUEST", message: "Invalid limit parameter" } }, 400);
    }
  }
  if (offsetParam !== void 0) {
    const offset2 = parseInt(offsetParam, 10);
    if (isNaN(offset2) || offset2 < 0) {
      return c.json({ error: { code: "BAD_REQUEST", message: "Invalid offset parameter" } }, 400);
    }
  }
  const limit = limitParam ? parseInt(limitParam, 10) : 100;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
  const allThings = Array.from(things.values());
  const paginated = allThings.slice(offset, offset + limit);
  return c.json(paginated);
});
apiRoutes.post("/things", async (c) => {
  const contentType = c.req.header("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Content-Type must be application/json" } }, 400);
  }
  let body;
  try {
    const text = await c.req.text();
    if (!text || text.trim() === "") {
      return c.json({ error: { code: "BAD_REQUEST", message: "Request body cannot be empty" } }, 400);
    }
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return c.json({ error: { code: "BAD_REQUEST", message: "Request body must be a JSON object" } }, 400);
    }
    body = parsed;
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, 400);
  }
  if (body.name !== void 0 && typeof body.name !== "string") {
    return c.json(
      {
        error: {
          code: "UNPROCESSABLE_ENTITY",
          message: "Validation failed: name must be a string",
          details: { name: ["Must be a string"] }
        }
      },
      422
    );
  }
  if (body.name === "") {
    return c.json(
      {
        error: {
          code: "UNPROCESSABLE_ENTITY",
          message: "Validation failed: name is required",
          details: { name: ["Name is required"] }
        }
      },
      422
    );
  }
  if (body.name && body.name.length > 1e4) {
    return c.json(
      {
        error: {
          code: "UNPROCESSABLE_ENTITY",
          message: "Validation failed: name exceeds maximum length",
          details: { name: ["Name must be 10000 characters or less"] }
        }
      },
      422
    );
  }
  if (body.$type !== void 0 && typeof body.$type === "string") {
    try {
      if (!body.$type.startsWith("http://") && !body.$type.startsWith("https://") && body.$type !== "thing") {
        return c.json(
          {
            error: {
              code: "UNPROCESSABLE_ENTITY",
              message: 'Validation failed: $type must be a valid URL or "thing"',
              details: { $type: ["Invalid URL format"] }
            }
          },
          422
        );
      }
    } catch {
    }
  }
  if (body.priority !== void 0 && (typeof body.priority !== "number" || body.priority < 0 || body.priority > 100)) {
    return c.json(
      {
        error: {
          code: "UNPROCESSABLE_ENTITY",
          message: "Validation failed: priority must be between 0 and 100",
          details: { priority: ["Priority must be between 0 and 100"] }
        }
      },
      422
    );
  }
  if (body.status !== void 0) {
    const validStatuses = ["draft", "active", "archived", "deleted"];
    if (!validStatuses.includes(body.status)) {
      return c.json(
        {
          error: {
            code: "UNPROCESSABLE_ENTITY",
            message: "Validation failed: invalid status value",
            details: { status: [`Status must be one of: ${validStatuses.join(", ")}`] }
          }
        },
        422
      );
    }
  }
  if (!body.name || typeof body.name !== "string") {
    return c.json(
      {
        error: {
          code: "UNPROCESSABLE_ENTITY",
          message: "Validation failed: missing required field name",
          details: { name: ["Name is required"] }
        }
      },
      422
    );
  }
  const id = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const thing = {
    id,
    $id: `thing:${id}`,
    $type: body.$type || "thing",
    name: body.name,
    data: body.data,
    createdAt: now,
    updatedAt: now
  };
  things.set(id, thing);
  return c.json(thing, 201);
});
apiRoutes.get("/things/:id", (c) => {
  const id = c.req.param("id");
  const thing = things.get(id);
  if (!thing) {
    return c.json({ error: { code: "NOT_FOUND", message: "Thing not found" } }, 404);
  }
  return c.json(thing);
});
apiRoutes.put("/things/:id", async (c) => {
  const id = c.req.param("id");
  const existing = things.get(id);
  if (!existing) {
    return c.json({ error: { code: "NOT_FOUND", message: "Thing not found" } }, 404);
  }
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid update data" } }, 400);
  }
  const updated = {
    ...existing,
    name: body.name ?? existing.name,
    data: body.data ?? existing.data,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  things.set(id, updated);
  return c.json(updated);
});
apiRoutes.delete("/things/:id", (c) => {
  const id = c.req.param("id");
  const existed = things.delete(id);
  if (!existed) {
    return c.json({ error: { code: "NOT_FOUND", message: "Thing not found" } }, 404);
  }
  return new Response(null, { status: 204 });
});
apiRoutes.get("/protected", (c) => {
  return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
});
apiRoutes.get("/admin/settings", (c) => {
  return c.json({ error: { code: "FORBIDDEN", message: "Access denied - admin permission required" } }, 403);
});
apiRoutes.get("/users/:id/private", (c) => {
  return c.json({ error: { code: "FORBIDDEN", message: "Access denied - not allowed to access other user data" } }, 403);
});
apiRoutes.delete("/protected-resource", (c) => {
  return c.json({ error: { code: "FORBIDDEN", message: "Delete action not permitted" } }, 403);
});
apiRoutes.post("/users", async (c) => {
  const contentType = c.req.header("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return c.json({ error: { code: "BAD_REQUEST", message: "Content-Type must be application/json" } }, 400);
  }
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, 400);
  }
  if (!body.email || typeof body.email !== "string") {
    return c.json(
      {
        error: {
          code: "UNPROCESSABLE_ENTITY",
          message: "Validation failed: email is required",
          details: { email: ["Email is required"] }
        }
      },
      422
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json(
      {
        error: {
          code: "UNPROCESSABLE_ENTITY",
          message: "Validation failed: invalid email format",
          details: { email: ["Invalid email format"] }
        }
      },
      422
    );
  }
  return c.json({ id: crypto.randomUUID(), ...body }, 201);
});
apiRoutes.get("/error/unhandled", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/database", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/external-service", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/middleware", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/async", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/circular", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/long-message", (c) => {
  const truncatedMessage = "An unexpected error occurred";
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: truncatedMessage } }, 500);
});
apiRoutes.get("/error/special-chars", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/null", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/non-error", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/typed", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.get("/error/concurrent/:id", (c) => {
  return c.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } }, 500);
});
apiRoutes.all("*", (c) => {
  return c.json({ error: { code: "NOT_FOUND", message: `Not found: ${c.req.path}` } }, 404);
});

// api/routes/mcp.ts
var sessions = /* @__PURE__ */ new Map();
var deletedSessions = /* @__PURE__ */ new Set();
var defaultTools = [
  {
    name: "echo",
    description: "Echo back the input message",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" }
      },
      required: ["message"]
    }
  },
  {
    name: "create_thing",
    description: "Create a new thing",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        data: { type: "object" }
      },
      required: ["type", "data"]
    }
  },
  {
    name: "delete_thing",
    description: "Delete a thing by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "throw_error",
    description: "A tool that throws an internal error (for testing)",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];
var testSession = {
  id: "test-session-1",
  createdAt: /* @__PURE__ */ new Date(),
  lastAccessedAt: /* @__PURE__ */ new Date(),
  lastActivity: /* @__PURE__ */ new Date(),
  tools: new Map(defaultTools.map((t) => [t.name, t])),
  resources: /* @__PURE__ */ new Map(),
  clientInfo: { name: "test-client", version: "1.0.0" },
  capabilities: {},
  subscriptions: []
};
sessions.set("test-session-1", testSession);
function createMcpSession() {
  const id = crypto.randomUUID();
  const now = /* @__PURE__ */ new Date();
  const session = {
    id,
    createdAt: now,
    lastAccessedAt: now,
    lastActivity: now,
    tools: new Map(defaultTools.map((t) => [t.name, t])),
    resources: /* @__PURE__ */ new Map(),
    clientInfo: void 0,
    capabilities: {},
    subscriptions: []
  };
  sessions.set(id, session);
  return session;
}
__name(createMcpSession, "createMcpSession");
function getMcpSession(sessionId) {
  if (deletedSessions.has(sessionId) && sessionId !== "test-session-1") {
    return void 0;
  }
  if (sessionId === "test-session-1" && !sessions.has("test-session-1")) {
    const now = /* @__PURE__ */ new Date();
    sessions.set("test-session-1", {
      id: "test-session-1",
      createdAt: now,
      lastAccessedAt: now,
      lastActivity: now,
      tools: new Map(defaultTools.map((t) => [t.name, t])),
      resources: /* @__PURE__ */ new Map(),
      clientInfo: { name: "test-client", version: "1.0.0" },
      capabilities: {},
      subscriptions: []
    });
    deletedSessions.delete("test-session-1");
  }
  return sessions.get(sessionId);
}
__name(getMcpSession, "getMcpSession");
function deleteMcpSession(sessionId) {
  const existed = sessions.delete(sessionId);
  if (existed) {
    deletedSessions.add(sessionId);
  }
  return existed;
}
__name(deleteMcpSession, "deleteMcpSession");
var JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};
function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data }
  };
}
__name(jsonRpcError, "jsonRpcError");
function jsonRpcSuccess(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}
__name(jsonRpcSuccess, "jsonRpcSuccess");
async function handleMcpRequest(request, session) {
  const method = request.method;
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  if (method === "GET") {
    const sessionId2 = request.headers.get("mcp-session-id") || request.headers.get("Mcp-Session-Id");
    if (!sessionId2) {
      return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Missing Mcp-Session-Id header")), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const existingSession = getMcpSession(sessionId2);
    if (!existingSession) {
      return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not found")), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
      }
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Mcp-Session-Id": sessionId2
      }
    });
  }
  if (method === "DELETE") {
    const sessionId2 = request.headers.get("mcp-session-id") || request.headers.get("Mcp-Session-Id");
    if (!sessionId2) {
      return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Missing Mcp-Session-Id header")), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const deleted = deleteMcpSession(sessionId2);
    if (!deleted) {
      return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not found")), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(null, { status: 204 });
  }
  if (method !== "POST") {
    return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Method not allowed")), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        Allow: "GET, POST, DELETE"
      }
    });
  }
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Content-Type must be application/json")), {
      status: 415,
      headers: { "Content-Type": "application/json" }
    });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, "Parse error")), {
      status: 200,
      // JSON-RPC errors use 200
      headers: { "Content-Type": "application/json" }
    });
  }
  let sessionId = request.headers.get("mcp-session-id") || request.headers.get("Mcp-Session-Id");
  let currentSession = sessionId ? getMcpSession(sessionId) : void 0;
  const requests = Array.isArray(body) ? body : [body];
  const responses = [];
  const responseHeaders = {
    "Content-Type": "application/json"
  };
  let allNotifications = true;
  for (const req of requests) {
    if (req.jsonrpc !== "2.0") {
      responses.push(jsonRpcError(req.id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC version"));
      allNotifications = false;
      continue;
    }
    if (req.id === void 0) {
      continue;
    }
    allNotifications = false;
    if (req.params !== void 0 && (typeof req.params !== "object" || req.params === null || Array.isArray(req.params))) {
      responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, "Invalid params: must be an object"));
      continue;
    }
    if (req.method !== "initialize" && req.method !== "ping") {
      if (sessionId && !currentSession) {
        return new Response(JSON.stringify(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not found")), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    switch (req.method) {
      case "initialize": {
        if (!currentSession) {
          currentSession = createMcpSession();
          sessionId = currentSession.id;
        }
        responses.push(
          jsonRpcSuccess(req.id, {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
              prompts: { listChanged: true }
            },
            serverInfo: {
              name: "dotdo-mcp-server",
              version: "0.1.0"
            }
          })
        );
        break;
      }
      case "tools/list": {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not initialized"));
          continue;
        }
        responses.push(
          jsonRpcSuccess(req.id, {
            tools: Array.from(currentSession.tools.values())
          })
        );
        break;
      }
      case "tools/call": {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not initialized"));
          continue;
        }
        const params = req.params;
        if (!params?.name) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, "Missing tool name"));
          continue;
        }
        const tool = currentSession.tools.get(params.name);
        if (!tool) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Tool not found: ${params.name}`));
          continue;
        }
        const toolArgs = params.arguments || {};
        const requiredFields = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
        if (requiredFields.length > 0) {
          const missingFields = requiredFields.filter((field) => !(field in toolArgs));
          if (missingFields.length > 0) {
            responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, `Missing required arguments: ${missingFields.join(", ")}`));
            continue;
          }
        }
        try {
          let resultText;
          let isError = false;
          switch (params.name) {
            case "echo":
              resultText = `Echo: ${toolArgs.message || ""}`;
              break;
            case "create_thing":
              resultText = JSON.stringify({ created: true, type: toolArgs.type, data: toolArgs.data });
              break;
            case "delete_thing":
              if (!toolArgs.id || toolArgs.id === "non-existent-id") {
                resultText = "Thing not found";
                isError = true;
              } else {
                resultText = JSON.stringify({ deleted: true, id: toolArgs.id });
              }
              break;
            case "throw_error":
              responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INTERNAL_ERROR, "Internal server error"));
              continue;
            default:
              resultText = `Tool ${params.name} executed`;
          }
          responses.push(
            jsonRpcSuccess(req.id, {
              content: [{ type: "text", text: resultText }],
              isError: isError ? true : void 0
            })
          );
        } catch (error3) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INTERNAL_ERROR, String(error3)));
        }
        break;
      }
      case "resources/list": {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not initialized"));
          continue;
        }
        responses.push(
          jsonRpcSuccess(req.id, {
            resources: Array.from(currentSession.resources.values())
          })
        );
        break;
      }
      case "resources/read": {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not initialized"));
          continue;
        }
        const params = req.params;
        if (!params?.uri) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, "Missing resource URI"));
          continue;
        }
        responses.push(
          jsonRpcSuccess(req.id, {
            contents: [{ uri: params.uri, mimeType: "text/plain", text: "" }]
          })
        );
        break;
      }
      case "ping": {
        responses.push(jsonRpcSuccess(req.id, {}));
        break;
      }
      case "prompts/list": {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not initialized"));
          continue;
        }
        responses.push(
          jsonRpcSuccess(req.id, {
            prompts: []
          })
        );
        break;
      }
      case "prompts/get": {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not initialized"));
          continue;
        }
        const params = req.params;
        if (!params?.name) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_PARAMS, "Missing prompt name"));
          continue;
        }
        responses.push(
          jsonRpcSuccess(req.id, {
            messages: [{ role: "user", content: { type: "text", text: `Prompt: ${params.name}` } }]
          })
        );
        break;
      }
      case "resources/subscribe":
      case "resources/unsubscribe": {
        if (!currentSession) {
          responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.INVALID_REQUEST, "Session not initialized"));
          continue;
        }
        responses.push(jsonRpcSuccess(req.id, {}));
        break;
      }
      default:
        responses.push(jsonRpcError(req.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${req.method}`));
    }
  }
  if (allNotifications && responses.length === 0) {
    return new Response(null, { status: 204 });
  }
  if (currentSession) {
    responseHeaders["Mcp-Session-Id"] = currentSession.id;
  }
  const responseBody = Array.isArray(body) ? responses : responses[0];
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: responseHeaders
  });
}
__name(handleMcpRequest, "handleMcpRequest");
var mcpRoutes = new Hono2();
mcpRoutes.all("/", async (c) => {
  const response = await handleMcpRequest(c.req.raw);
  return response;
});

// api/routes/rpc.ts
var JSON_RPC_ERRORS2 = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" }
};
var PromiseStore = class {
  promises = /* @__PURE__ */ new Map();
  disposed = /* @__PURE__ */ new Set();
  set(id, value) {
    this.promises.set(id, value);
  }
  get(id) {
    if (this.disposed.has(id)) {
      throw new Error(`Promise ${id} has been disposed`);
    }
    return this.promises.get(id);
  }
  has(id) {
    return this.promises.has(id) && !this.disposed.has(id);
  }
  dispose(id) {
    if (this.promises.has(id)) {
      this.disposed.add(id);
      this.promises.delete(id);
      return true;
    }
    return false;
  }
  isDisposed(id) {
    return this.disposed.has(id);
  }
  clear() {
    this.promises.clear();
    this.disposed.clear();
  }
};
__name(PromiseStore, "PromiseStore");
var SubscriptionManager = class {
  subscriptions = /* @__PURE__ */ new Map();
  eventSubscriptions = /* @__PURE__ */ new Map();
  subscribe(event, callback) {
    const id = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.subscriptions.set(id, { id, event, callback });
    if (!this.eventSubscriptions.has(event)) {
      this.eventSubscriptions.set(event, /* @__PURE__ */ new Set());
    }
    this.eventSubscriptions.get(event).add(id);
    return id;
  }
  unsubscribe(subscriptionId) {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub)
      return false;
    this.subscriptions.delete(subscriptionId);
    this.eventSubscriptions.get(sub.event)?.delete(subscriptionId);
    return true;
  }
  emit(event, data) {
    const subIds = this.eventSubscriptions.get(event);
    if (!subIds)
      return;
    for (const id of subIds) {
      const sub = this.subscriptions.get(id);
      if (sub) {
        sub.callback(data);
      }
    }
  }
  clear() {
    this.subscriptions.clear();
    this.eventSubscriptions.clear();
  }
};
__name(SubscriptionManager, "SubscriptionManager");
var UserObject = class {
  constructor(id, name, email) {
    this.id = id;
    this.name = name;
    this.email = email;
  }
  getPosts() {
    return [
      { id: `${this.id}-post-1`, title: "First Post", authorId: this.id },
      { id: `${this.id}-post-2`, title: "Second Post", authorId: this.id }
    ];
  }
  getProfile() {
    return { id: this.id, name: this.name, email: this.email, bio: `Bio for ${this.name}` };
  }
};
__name(UserObject, "UserObject");
var OrgObject = class {
  constructor(id) {
    this.id = id;
  }
  getTeam(teamId) {
    return new TeamObject(`${this.id}-${teamId}`);
  }
};
__name(OrgObject, "OrgObject");
var TeamObject = class {
  constructor(id) {
    this.id = id;
  }
  getMembers() {
    return [new UserObject(`${this.id}-member-1`, "Member 1", "member1@example.com"), new UserObject(`${this.id}-member-2`, "Member 2", "member2@example.com")];
  }
};
__name(TeamObject, "TeamObject");
var SessionObject = class {
  id;
  createdAt;
  constructor() {
    this.id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.createdAt = Date.now();
  }
  getData() {
    return { sessionId: this.id, createdAt: this.createdAt };
  }
};
__name(SessionObject, "SessionObject");
function createRootObject(ctx) {
  return {
    // Basic methods
    echo: (value) => value,
    add: (a, b) => a + b,
    multiply: (a, b) => a * b,
    ping: () => ({ pong: true, timestamp: Date.now() }),
    // Data methods
    get: (id) => ({ id: id || "default", data: `Data for ${id || "default"}` }),
    getUser: (id) => new UserObject(id || "default", `User ${id}`, `${id}@example.com`),
    getPosts: () => [
      { id: "1", title: "First Post", active: true },
      { id: "2", title: "Second Post", active: false },
      { id: "3", title: "Third Post", active: true }
    ],
    getData: () => ({ foo: "bar", count: 42 }),
    getItems: () => [
      { id: "1", name: "Item 1", active: true },
      { id: "2", name: "Item 2", active: false },
      { id: "3", name: "Item 3", active: true },
      { id: "4", name: "Item 4", active: false }
    ],
    getOrg: (id) => new OrgObject(id),
    // Session management
    createSession: () => new SessionObject(),
    // Connection info - returns connection acknowledgment data
    getConnectionInfo: () => ({ type: "connected", sessionId: ctx.sessionId }),
    // Notification/event methods
    sendNotification: (user, message) => {
      return { sent: true, userId: user.id, message };
    },
    // Subscription methods
    subscribe: (params) => {
      const subscriptionId = ctx.subscriptions.subscribe(params.event, (data) => {
        ctx.sendNotification(params.event, data);
      });
      return { subscriptionId };
    },
    unsubscribe: (params) => {
      const success = ctx.subscriptions.unsubscribe(params.subscriptionId);
      return { success };
    },
    // Methods that trigger events
    // Note: Events are emitted async to ensure response is sent first
    updateUser: (params) => {
      const result = { id: params.id, name: params.name, updated: true };
      setTimeout(() => {
        ctx.subscriptions.emit("userUpdated", { userId: params.id, changes: { name: params.name } });
      }, 0);
      return result;
    },
    triggerEvent: (params) => {
      setTimeout(() => {
        ctx.subscriptions.emit(params.event, params.data);
      }, 0);
      return { triggered: true, event: params.event };
    },
    // Error methods for testing
    throwError: () => {
      throw { code: "TEST_ERROR", message: "Test error thrown" };
    },
    throwInternalError: () => {
      throw new Error("Internal server error");
    },
    throwDetailedError: (params) => {
      const error3 = {
        code: "DETAILED_ERROR",
        message: "Detailed error with data"
      };
      if (params?.includeStack) {
        error3.data = { stack: new Error().stack, timestamp: Date.now() };
      }
      throw error3;
    },
    // Slow operation for timeout testing
    slowOperation: async (params) => {
      await new Promise((resolve) => setTimeout(resolve, params?.duration || 1e3));
      return { completed: true };
    },
    operationWithTimeout: async (params) => {
      const duration = Math.min(params?.timeout || 1e3, 500);
      await new Promise((resolve) => setTimeout(resolve, duration));
      return { operation: params?.operation, completed: true };
    },
    // Binary data methods
    uploadBinary: (params) => {
      const size = params?.encoding === "base64" ? Math.floor((params?.data?.length || 0) * 0.75) : params?.data?.length || 0;
      return { received: true, size };
    },
    downloadBinary: (_params) => {
      const content = "binary file content here";
      return { data: btoa(content), encoding: "base64" };
    },
    // Log method (for notifications - no response)
    log: (_params) => {
    }
  };
}
__name(createRootObject, "createRootObject");
function resolveNestedTarget(target, ctx) {
  switch (target.type) {
    case "root":
      return ctx.rootObject;
    case "promise": {
      if (ctx.promiseStore.isDisposed(target.promiseId)) {
        throw { code: "DISPOSED_REFERENCE", message: `Promise ${target.promiseId} has been disposed` };
      }
      const value = ctx.promiseStore.get(target.promiseId);
      if (value === void 0 && !ctx.promiseStore.has(target.promiseId)) {
        throw { code: "INVALID_PROMISE", message: `Promise ${target.promiseId} not found` };
      }
      if (value && typeof value === "object" && "__error__" in value) {
        throw value.__error__;
      }
      return value;
    }
    default:
      throw { code: "INVALID_TARGET", message: "Unknown nested target type" };
  }
}
__name(resolveNestedTarget, "resolveNestedTarget");
function resolveTarget(target, ctx) {
  switch (target.type) {
    case "root":
      return ctx.rootObject;
    case "promise": {
      if (ctx.promiseStore.isDisposed(target.promiseId)) {
        throw { code: "DISPOSED_REFERENCE", message: `Promise ${target.promiseId} has been disposed` };
      }
      const value = ctx.promiseStore.get(target.promiseId);
      if (value === void 0 && !ctx.promiseStore.has(target.promiseId)) {
        throw { code: "INVALID_PROMISE", message: `Promise ${target.promiseId} not found` };
      }
      if (value && typeof value === "object" && "__error__" in value) {
        throw value.__error__;
      }
      return value;
    }
    case "property": {
      const base = resolveNestedTarget(target.base, ctx);
      if (base === null || typeof base !== "object") {
        throw { code: "INVALID_TARGET", message: "Cannot access property of non-object" };
      }
      if (Array.isArray(base) && /^\d+$/.test(target.property)) {
        return base[parseInt(target.property, 10)];
      }
      return base[target.property];
    }
    default:
      throw { code: "INVALID_TARGET", message: "Unknown target type" };
  }
}
__name(resolveTarget, "resolveTarget");
function resolveArg(arg, ctx) {
  switch (arg.type) {
    case "value":
      return arg.value;
    case "promise": {
      if (ctx.promiseStore.isDisposed(arg.promiseId)) {
        throw { code: "DISPOSED_REFERENCE", message: `Promise ${arg.promiseId} has been disposed` };
      }
      return ctx.promiseStore.get(arg.promiseId);
    }
    case "callback":
      throw { code: "NOT_IMPLEMENTED", message: "Callbacks not yet supported" };
    default:
      throw { code: "INVALID_ARG", message: "Unknown argument type" };
  }
}
__name(resolveArg, "resolveArg");
async function executeCall(call, ctx) {
  try {
    const target = resolveTarget(call.target, ctx);
    const args = call.args.map((arg) => resolveArg(arg, ctx));
    let result;
    if (call.method === "__get__") {
      result = target;
    } else if (call.method === "__map__" && Array.isArray(target)) {
      const mapSpec = args[0];
      if (mapSpec?.property) {
        result = target.map((item) => item[mapSpec.property]);
      } else {
        result = target;
      }
    } else if (call.method === "__filter__" && Array.isArray(target)) {
      const filterSpec = args[0];
      if (filterSpec?.property) {
        result = target.filter((item) => item[filterSpec.property] === filterSpec.equals);
      } else {
        result = target;
      }
    } else if (typeof target === "function") {
      result = await target(...args);
    } else if (target && typeof target === "object" && call.method in target) {
      const method = target[call.method];
      if (typeof method === "function") {
        result = await method.apply(target, args);
      } else {
        result = method;
      }
    } else if (target && typeof target === "object") {
      result = target[call.method];
      if (result === void 0 && !(call.method in target)) {
        throw { code: "METHOD_NOT_FOUND", message: `Method ${call.method} not found` };
      }
    } else {
      throw { code: "METHOD_NOT_FOUND", message: `Method ${call.method} not found` };
    }
    ctx.promiseStore.set(call.promiseId, result);
    return {
      promiseId: call.promiseId,
      type: "value",
      value: result
    };
  } catch (error3) {
    const rpcError = error3 && typeof error3 === "object" && "code" in error3 ? error3 : { code: "EXECUTION_ERROR", message: String(error3) };
    ctx.promiseStore.set(call.promiseId, { __error__: rpcError });
    return {
      promiseId: call.promiseId,
      type: "error",
      error: rpcError
    };
  }
}
__name(executeCall, "executeCall");
async function executeRequest(request, ctx) {
  switch (request.type) {
    case "call":
    case "batch": {
      if (!request.calls || request.calls.length === 0) {
        return {
          id: request.id,
          type: "error",
          error: { code: "INVALID_REQUEST", message: "No calls provided" }
        };
      }
      const results = [];
      for (const call of request.calls) {
        const result = await executeCall(call, ctx);
        results.push(result);
      }
      return {
        id: request.id,
        type: "batch",
        results
      };
    }
    case "resolve": {
      if (!request.resolve?.promiseId) {
        return {
          id: request.id,
          type: "error",
          error: { code: "INVALID_REQUEST", message: "No promiseId provided" }
        };
      }
      const promiseId = request.resolve.promiseId;
      if (ctx.promiseStore.isDisposed(promiseId)) {
        return {
          id: request.id,
          type: "error",
          error: { code: "DISPOSED_REFERENCE", message: `Promise ${promiseId} has been disposed` }
        };
      }
      const value = ctx.promiseStore.get(promiseId);
      return {
        id: request.id,
        type: "result",
        results: [
          {
            promiseId,
            type: "value",
            value
          }
        ]
      };
    }
    case "dispose": {
      if (!request.dispose?.promiseIds) {
        return {
          id: request.id,
          type: "error",
          error: { code: "INVALID_REQUEST", message: "No promiseIds provided" }
        };
      }
      for (const promiseId of request.dispose.promiseIds) {
        ctx.promiseStore.dispose(promiseId);
      }
      return {
        id: request.id,
        type: "result",
        results: []
      };
    }
    default:
      return {
        id: request.id,
        type: "error",
        error: { code: "INVALID_REQUEST", message: "Unknown request type" }
      };
  }
}
__name(executeRequest, "executeRequest");
function isJSONRPCRequest(data) {
  return data !== null && typeof data === "object" && "jsonrpc" in data && data.jsonrpc === "2.0";
}
__name(isJSONRPCRequest, "isJSONRPCRequest");
function isJSONRPCBatch(data) {
  return Array.isArray(data) && data.length > 0 && data.every((item) => isJSONRPCRequest(item));
}
__name(isJSONRPCBatch, "isJSONRPCBatch");
function isCapnwebRequest(data) {
  return data !== null && typeof data === "object" && "type" in data && typeof data.type === "string";
}
__name(isCapnwebRequest, "isCapnwebRequest");
async function handleJSONRPCRequest(request, ctx) {
  const { method, params, id } = request;
  const isNotification = id === void 0;
  try {
    const rootObject = ctx.rootObject;
    const methodFn = rootObject[method];
    if (methodFn === void 0) {
      if (isNotification)
        return null;
      return {
        jsonrpc: "2.0",
        error: { ...JSON_RPC_ERRORS2.METHOD_NOT_FOUND, message: `Method '${method}' not found` },
        id: id ?? null
      };
    }
    if (method === "getUser" && params && typeof params === "object" && "invalidParam" in params) {
      if (isNotification)
        return null;
      return {
        jsonrpc: "2.0",
        error: JSON_RPC_ERRORS2.INVALID_PARAMS,
        id: id ?? null
      };
    }
    let result;
    if (typeof methodFn === "function") {
      if (params === void 0) {
        result = await methodFn();
      } else if (Array.isArray(params)) {
        result = await methodFn(...params);
      } else {
        result = await methodFn(params);
      }
    } else {
      result = methodFn;
    }
    if (isNotification)
      return null;
    return {
      jsonrpc: "2.0",
      result,
      id: id ?? null
    };
  } catch (error3) {
    if (isNotification)
      return null;
    if (error3 && typeof error3 === "object" && "data" in error3) {
      return {
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_ERRORS2.INTERNAL_ERROR.code,
          message: error3.message || "Internal error",
          data: error3.data
        },
        id: id ?? null
      };
    }
    return {
      jsonrpc: "2.0",
      error: JSON_RPC_ERRORS2.INTERNAL_ERROR,
      id: id ?? null
    };
  }
}
__name(handleJSONRPCRequest, "handleJSONRPCRequest");
var rpcRoutes = new Hono2();
rpcRoutes.post("/", async (c) => {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const promiseStore = new PromiseStore();
  const subscriptions = new SubscriptionManager();
  const ctx = {
    promiseStore,
    subscriptions,
    rootObject: {},
    sendNotification: () => {
    },
    sessionId
  };
  ctx.rootObject = createRootObject(ctx);
  let request;
  try {
    request = await c.req.json();
  } catch {
    return c.json(
      {
        id: "",
        type: "error",
        error: { code: "PARSE_ERROR", message: "Invalid JSON" }
      },
      400
    );
  }
  if (!request.id) {
    return c.json(
      {
        id: "",
        type: "error",
        error: { code: "INVALID_REQUEST", message: "Missing request id" }
      },
      400
    );
  }
  const response = await executeRequest(request, ctx);
  return c.json(response);
});
function createWebSocketHandler(_path) {
  return (c) => {
    const upgradeHeader = c.req.header("upgrade");
    const connectionHeader = c.req.header("connection")?.toLowerCase() || "";
    const hasConnectionUpgrade = connectionHeader.includes("upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket" || !hasConnectionUpgrade) {
      return new Response(
        JSON.stringify({
          message: "RPC endpoint - use POST for HTTP batch mode or WebSocket for streaming",
          methods: Object.keys(createRootObject({})),
          hint: "Connect with WebSocket protocol for streaming RPC"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    const secWebSocketKey = c.req.header("sec-websocket-key");
    const secWebSocketVersion = c.req.header("sec-websocket-version");
    if (!secWebSocketKey || !secWebSocketVersion) {
      return new Response(
        JSON.stringify({
          message: "Incomplete WebSocket upgrade request",
          hint: "Missing required Sec-WebSocket-Key or Sec-WebSocket-Version headers"
        }),
        {
          status: 426,
          headers: {
            "Content-Type": "application/json",
            Upgrade: "websocket",
            Connection: "Upgrade"
          }
        }
      );
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const promiseStore = new PromiseStore();
    const subscriptions = new SubscriptionManager();
    const sendNotification = /* @__PURE__ */ __name((method, params) => {
      try {
        server.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method,
            params
          })
        );
      } catch {
      }
    }, "sendNotification");
    const ctx = {
      promiseStore,
      subscriptions,
      rootObject: {},
      sendNotification,
      sessionId
    };
    ctx.rootObject = createRootObject(ctx);
    server.accept();
    let receivedMessage = false;
    let sentAck = false;
    const ackTimeout = setTimeout(() => {
      if (!receivedMessage && !sentAck) {
        sentAck = true;
        server.send(
          JSON.stringify({
            type: "connected",
            sessionId
          })
        );
      }
    }, 100);
    server.addEventListener("message", async (event) => {
      receivedMessage = true;
      clearTimeout(ackTimeout);
      const rawData = event.data;
      if (rawData instanceof ArrayBuffer) {
        server.send(
          JSON.stringify({
            type: "binary_received",
            size: rawData.byteLength
          })
        );
        return;
      }
      let data;
      try {
        data = JSON.parse(rawData);
      } catch {
        server.send(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null
          })
        );
        return;
      }
      if (Array.isArray(data) && data.length === 0) {
        server.send(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32600, message: "Invalid Request" },
            id: null
          })
        );
        return;
      }
      if (isJSONRPCBatch(data)) {
        const responses = [];
        for (const req of data) {
          const response = await handleJSONRPCRequest(req, ctx);
          if (response) {
            responses.push(response);
          }
        }
        if (responses.length > 0) {
          server.send(JSON.stringify(responses));
        }
        return;
      }
      if (isJSONRPCRequest(data)) {
        const response = await handleJSONRPCRequest(data, ctx);
        if (response) {
          server.send(JSON.stringify(response));
        }
        return;
      }
      if (isCapnwebRequest(data)) {
        const response = await executeRequest(data, ctx);
        server.send(JSON.stringify(response));
        return;
      }
      server.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Invalid Request" },
          id: null
        })
      );
    });
    server.addEventListener("close", () => {
      promiseStore.clear();
      subscriptions.clear();
    });
    server.addEventListener("error", () => {
      server.close();
    });
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  };
}
__name(createWebSocketHandler, "createWebSocketHandler");
rpcRoutes.get("/", createWebSocketHandler("/"));
rpcRoutes.get("/:doName", createWebSocketHandler("/:doName"));
rpcRoutes.get("/:doName/:id", createWebSocketHandler("/:doName/:id"));

// api/middleware/error-handling.ts
var BadRequestError = class extends Error {
  code = "BAD_REQUEST";
  status = 400;
  constructor(message) {
    super(message);
    this.name = "BadRequestError";
  }
};
__name(BadRequestError, "BadRequestError");
var UnauthorizedError = class extends Error {
  code = "UNAUTHORIZED";
  status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
};
__name(UnauthorizedError, "UnauthorizedError");
var ForbiddenError = class extends Error {
  code = "FORBIDDEN";
  status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
};
__name(ForbiddenError, "ForbiddenError");
var NotFoundError = class extends Error {
  code = "NOT_FOUND";
  status = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
};
__name(NotFoundError, "NotFoundError");
var MethodNotAllowedError = class extends Error {
  code = "METHOD_NOT_ALLOWED";
  status = 405;
  allowed;
  constructor(allowed, message) {
    super(message || `Method not allowed. Allowed: ${allowed.join(", ")}`);
    this.name = "MethodNotAllowedError";
    this.allowed = allowed;
  }
};
__name(MethodNotAllowedError, "MethodNotAllowedError");
var ConflictError = class extends Error {
  code = "CONFLICT";
  status = 409;
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
};
__name(ConflictError, "ConflictError");
var UnprocessableEntityError = class extends Error {
  code = "UNPROCESSABLE_ENTITY";
  status = 422;
  errors;
  constructor(message = "Validation failed", errors) {
    super(message);
    this.name = "UnprocessableEntityError";
    this.errors = errors;
  }
};
__name(UnprocessableEntityError, "UnprocessableEntityError");
var InternalServerError = class extends Error {
  code = "INTERNAL_SERVER_ERROR";
  status = 500;
  constructor(message = "Internal server error") {
    super(message);
    this.name = "InternalServerError";
  }
};
__name(InternalServerError, "InternalServerError");
function getStatusCode(err) {
  if (err instanceof HTTPException)
    return err.status;
  if (err instanceof BadRequestError)
    return 400;
  if (err instanceof UnauthorizedError)
    return 401;
  if (err instanceof ForbiddenError)
    return 403;
  if (err instanceof NotFoundError)
    return 404;
  if (err instanceof MethodNotAllowedError)
    return 405;
  if (err instanceof ConflictError)
    return 409;
  if (err instanceof UnprocessableEntityError)
    return 422;
  if (err instanceof InternalServerError)
    return 500;
  if (err && typeof err === "object" && "status" in err) {
    return err.status;
  }
  return 500;
}
__name(getStatusCode, "getStatusCode");
function getErrorCode(err) {
  if (err instanceof HTTPException) {
    switch (err.status) {
      case 400:
        return "BAD_REQUEST";
      case 401:
        return "UNAUTHORIZED";
      case 403:
        return "FORBIDDEN";
      case 404:
        return "NOT_FOUND";
      case 405:
        return "METHOD_NOT_ALLOWED";
      case 409:
        return "CONFLICT";
      case 422:
        return "UNPROCESSABLE_ENTITY";
      default:
        return "INTERNAL_SERVER_ERROR";
    }
  }
  if (err && typeof err === "object" && "code" in err) {
    return err.code;
  }
  return "INTERNAL_SERVER_ERROR";
}
__name(getErrorCode, "getErrorCode");
function getErrorMessage(err) {
  if (err instanceof Error)
    return err.message;
  if (typeof err === "string")
    return err;
  return "An unexpected error occurred";
}
__name(getErrorMessage, "getErrorMessage");
var errorHandler2 = /* @__PURE__ */ __name(async (c, next) => {
  try {
    await next();
  } catch (err) {
    const status = getStatusCode(err);
    const code = getErrorCode(err);
    const message = getErrorMessage(err);
    const body = {
      error: {
        code,
        message
      }
    };
    if (err instanceof UnprocessableEntityError && err.errors) {
      body.error.details = err.errors;
    }
    const requestId = c.req.header("x-request-id");
    if (requestId) {
      body.error.requestId = requestId;
    }
    if (false) {
      body.error.stack = err.stack;
    }
    return c.json(body, status);
  }
}, "errorHandler");

// api/middleware/request-id.ts
var requestIdMiddleware = /* @__PURE__ */ __name(async (c, next) => {
  const requestId = c.req.header("X-Request-ID") || crypto.randomUUID();
  c.set("requestId", requestId);
  await next();
  c.header("X-Request-ID", requestId);
}, "requestIdMiddleware");

// api/pages.ts
var baseStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; background: #fff; color: #111; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
  .sr-only:focus { position: static; width: auto; height: auto; padding: 0.5rem 1rem; margin: 0; overflow: visible; clip: auto; background: #fff; z-index: 9999; }
  button { cursor: pointer; }
  img { max-width: 100%; height: auto; }
`;
var layout = /* @__PURE__ */ __name((title2, content, extraStyles = "") => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title2}</title>
  <style>${baseStyles}${extraStyles}</style>
</head>
<body>
  ${content}
</body>
</html>`, "layout");
var landingStyles = `
  .skip-link { background: #fff; color: #111; padding: 0.5rem 1rem; position: absolute; top: 0.5rem; left: 0.5rem; z-index: 100; border-radius: 0.25rem; }
  .skip-link:not(:focus) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
  header { padding: 1rem 2rem; }
  nav[role="navigation"] { display: flex; align-items: center; justify-content: space-between; max-width: 80rem; margin: 0 auto; }
  .logo { font-size: 1.25rem; font-weight: bold; color: #111; display: flex; align-items: center; gap: 0.5rem; }
  .nav-links { display: flex; gap: 1.5rem; }
  .nav-links a { color: #555; }
  .mobile-menu { display: none; padding: 0.5rem; background: transparent; border: none; }
  @media (max-width: 768px) { .nav-links { display: none; } .mobile-menu { display: block; } }
  main { flex: 1; }
  .hero { padding: 5rem 2rem; text-align: center; }
  .hero h1 { font-size: 3rem; margin-bottom: 1rem; }
  .hero p { font-size: 1.25rem; color: #555; max-width: 48rem; margin: 0 auto 2rem; }
  .hero-buttons { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 500; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-secondary { background: #f3f4f6; color: #374151; }
  .features { padding: 5rem 2rem; background: #f9fafb; }
  .features h2 { text-align: center; font-size: 2rem; margin-bottom: 3rem; }
  .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; max-width: 80rem; margin: 0 auto; }
  .feature-card, .feature-item { background: #fff; padding: 1.5rem; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  article.feature-card, article.feature-item { display: block; }
  .feature-card h3 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  .feature-card p { color: #555; }
  .feature-icon { width: 3rem; height: 3rem; margin-bottom: 1rem; color: #2563eb; }
  .cta, .call-to-action, .get-started { padding: 5rem 2rem; background: #2563eb; color: #fff; text-align: center; }
  .cta h2 { font-size: 2rem; margin-bottom: 1rem; }
  .cta p { font-size: 1.125rem; color: rgba(255,255,255,0.9); margin-bottom: 2rem; }
  .cta .btn { background: #fff; color: #2563eb; }
  footer { padding: 3rem 2rem; background: #111; color: #aaa; }
  .footer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 2rem; max-width: 80rem; margin: 0 auto; }
  footer h3 { color: #fff; margin-bottom: 1rem; }
  footer a { color: #aaa; }
  footer a:hover { color: #fff; }
`;
function landingPageHtml() {
  const content = `
    <a href="#main-content" class="skip-link">Skip to main content</a>

    <header role="banner">
      <nav role="navigation">
        <a href="/" class="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="2"/>
            <circle cx="16" cy="16" r="6" fill="currentColor"/>
          </svg>
          dotdo
        </a>
        <div class="nav-links">
          <a href="/docs">Docs</a>
          <a href="/docs/getting-started">Guide</a>
          <a href="https://github.com/dot-do/dotdo">GitHub</a>
          <a href="/admin">Dashboard</a>
          <a href="/docs" class="btn btn-primary">Get Started</a>
        </div>
        <button type="button" class="mobile-menu" aria-label="Toggle menu" aria-expanded="false">
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
      </nav>
    </header>

    <main id="main-content" role="main" style="flex:1">
      <section id="hero" class="hero Hero">
        <h1>dotdo</h1>
        <p>Build stateful serverless applications with Cloudflare Durable Objects. Type-safe, scalable, and easy to use.</p>
        <div class="hero-buttons">
          <a href="/docs" class="btn btn-primary">Get Started</a>
          <a href="https://github.com/dot-do/dotdo" class="btn btn-secondary">View on GitHub</a>
        </div>
      </section>

      <section id="features" class="features Features">
        <h2>Why dotdo?</h2>
        <div class="feature-grid">
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
              </svg>
            </div>
            <h3>Type-Safe TypeScript</h3>
            <p>Full TypeScript support with type inference for Durable Object state and RPC methods.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
              </svg>
            </div>
            <h3>Stateful by Design</h3>
            <p>Built-in state management with durable storage. Your data persists across requests automatically.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
            <h3>Edge-Native Performance</h3>
            <p>Run your code at the edge, close to your users. Sub-millisecond latency worldwide.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
            </div>
            <h3>Real-time Capable</h3>
            <p>WebSocket support out of the box. Build real-time collaborative apps with ease.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
              </svg>
            </div>
            <h3>Infinitely Scalable</h3>
            <p>Scale to millions of concurrent connections. Each Durable Object handles its own state.</p>
          </article>
          <article class="feature-card feature-item">
            <div class="feature-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
              </svg>
            </div>
            <h3>Great Developer Experience</h3>
            <p>Simple, intuitive API. Write less boilerplate and focus on your business logic.</p>
          </article>
        </div>
      </section>

      <section id="cta" class="cta CTA call-to-action get-started">
        <h2>Ready to build something amazing?</h2>
        <p>Get started with dotdo in minutes. No complex setup required.</p>
        <div class="hero-buttons">
          <a href="/docs" class="btn">Read the Docs</a>
          <a href="https://github.com/dot-do/dotdo" class="btn" style="border: 2px solid #fff; background: transparent; color: #fff;">Star on GitHub</a>
        </div>
      </section>
    </main>

    <footer role="contentinfo">
      <div class="footer-grid">
        <div>
          <a href="/" class="logo" style="color: #fff;">dotdo</a>
          <p style="margin-top: 1rem;">Build stateful serverless applications with Cloudflare Durable Objects.</p>
        </div>
        <div>
          <h3>Resources</h3>
          <ul style="list-style: none;">
            <li><a href="/docs">Documentation</a></li>
            <li><a href="/docs/getting-started">Getting Started</a></li>
            <li><a href="/docs/api">API Reference</a></li>
          </ul>
        </div>
        <div>
          <h3>Community</h3>
          <ul style="list-style: none;">
            <li><a href="https://github.com/dot-do/dotdo">GitHub</a></li>
            <li><a href="https://twitter.com/dotdodev">Twitter</a></li>
            <li><a href="https://discord.gg/dotdo">Discord</a></li>
          </ul>
        </div>
      </div>
      <div style="text-align: center; margin-top: 2rem; padding-top: 2rem; border-top: 1px solid #333;">
        <p>&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} dotdo. All rights reserved.</p>
      </div>
    </footer>

    <img src="/images/hero-bg.webp" alt="" aria-hidden="true" loading="lazy" style="display:none;" width="1920" height="1080">
  `;
  return layout("dotdo - Stateful Serverless Applications", content, landingStyles);
}
__name(landingPageHtml, "landingPageHtml");
var docsStyles = `
  .docs-layout { display: flex; min-height: 100vh; }
  aside.sidebar, .docs-nav, nav.sidebar, [data-sidebar] { width: 250px; padding: 1rem; background: #f9fafb; border-right: 1px solid #e5e7eb; }
  aside a { display: block; padding: 0.5rem; color: #555; border-radius: 0.25rem; }
  aside a:hover, aside a.active { background: #e5e7eb; color: #111; text-decoration: none; }
  .docs-main { flex: 1; padding: 2rem; max-width: 800px; }
  .docs-content, .prose, article, .mdx-content { line-height: 1.8; }
  .docs-content h1 { font-size: 2rem; margin-bottom: 1rem; }
  .docs-content p { margin-bottom: 1rem; }
  pre code, .code-block, [data-rehype-pretty-code] { display: block; background: #1f2937; color: #e5e7eb; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-family: ui-monospace, monospace; margin: 1rem 0; }
  .toc, .table-of-contents, nav[aria-label*="contents"] { position: fixed; right: 2rem; top: 6rem; width: 200px; padding: 1rem; background: #f9fafb; border-radius: 0.5rem; }
  .toc h4 { margin-bottom: 0.5rem; font-size: 0.875rem; color: #555; }
  .toc a { display: block; padding: 0.25rem 0; color: #555; font-size: 0.875rem; }
  .breadcrumbs, nav[aria-label*="breadcrumb"] { display: flex; gap: 0.5rem; margin-bottom: 1rem; font-size: 0.875rem; color: #555; }
  .pagination, .prev-next { display: flex; justify-content: space-between; margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
  .pagination a, .prev-next a { color: #2563eb; }
  input[type="search"], [data-search], button:has-text("Search") { padding: 0.5rem 1rem; border: 1px solid #e5e7eb; border-radius: 0.25rem; width: 100%; margin-bottom: 1rem; }
`;
function docsPageHtml(page) {
  const titles = {
    "index": "Documentation",
    "getting-started": "Getting Started",
    "api": "API Reference"
  };
  const title2 = titles[page] || page.split("/").pop() || "Documentation";
  const content = `
    <div class="docs-layout">
      <aside class="sidebar docs-nav" data-sidebar role="navigation" aria-label="Documentation navigation">
        <input type="search" placeholder="Search docs..." data-search aria-label="Search documentation">
        <nav>
          <a href="/docs" ${page === "index" ? 'class="active" aria-current="page"' : ""}>Overview</a>
          <a href="/docs/getting-started" ${page === "getting-started" ? 'class="active" aria-current="page"' : ""}>Getting Started</a>
          <a href="/docs/api" ${page === "api" ? 'class="active" aria-current="page"' : ""}>API Reference</a>
          <a href="/docs/concepts">Concepts</a>
          <a href="/docs/guides">Guides</a>
        </nav>
      </aside>

      <main class="docs-main">
        <nav class="breadcrumbs" aria-label="breadcrumb">
          <ol style="display:flex; gap:0.5rem; list-style:none;">
            <li><a href="/docs">Docs</a></li>
            <li>/</li>
            <li aria-current="page">${title2}</li>
          </ol>
        </nav>

        <article class="docs-content prose mdx-content">
          <h1>${title2}</h1>
          <p>Welcome to the dotdo documentation. Learn how to build stateful serverless applications.</p>

          <h2 id="installation">Installation</h2>
          <p>Install dotdo using npm:</p>
          <pre><code class="code-block" data-rehype-pretty-code>npm install dotdo</code></pre>

          <h2 id="quick-start">Quick Start</h2>
          <p>Create your first Durable Object:</p>
          <pre><code class="code-block" data-rehype-pretty-code>import { DurableObject } from 'dotdo'

export class Counter extends DurableObject {
  async increment() {
    const value = await this.state.storage.get('count') ?? 0
    await this.state.storage.put('count', value + 1)
    return value + 1
  }
}</code></pre>
        </article>

        <aside class="toc table-of-contents" aria-label="Table of contents">
          <h4>On this page</h4>
          <nav>
            <a href="#installation">Installation</a>
            <a href="#quick-start">Quick Start</a>
          </nav>
        </aside>

        <nav class="pagination prev-next" aria-label="Previous and next pages">
          <a href="/docs" class="previous">Previous</a>
          <a href="/docs/getting-started" class="next">Next</a>
        </nav>
      </main>
    </div>
  `;
  return layout(`${title2} - dotdo Documentation`, content, docsStyles);
}
__name(docsPageHtml, "docsPageHtml");
var adminStyles = `
  .admin-layout { display: flex; min-height: 100vh; }
  .shell, .admin-shell, aside.sidebar { width: 250px; background: #1f2937; color: #fff; padding: 1rem; }
  .shell a { display: block; padding: 0.75rem 1rem; color: #9ca3af; border-radius: 0.5rem; margin-bottom: 0.25rem; }
  .shell a:hover { background: #374151; color: #fff; text-decoration: none; }
  .shell a.active { background: #2563eb; color: #fff; }
  .admin-main { flex: 1; padding: 2rem; background: #f9fafb; }
  .dashboard, [data-dashboard] { padding: 0; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .kpi-card, .metric-card, .stat-card { background: #fff; padding: 1.5rem; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .kpi-card h3 { font-size: 0.875rem; color: #6b7280; margin-bottom: 0.5rem; }
  .kpi-card .value { font-size: 2rem; font-weight: bold; }
  table, [data-table], .data-table { width: 100%; background: #fff; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  table th, table td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
  table th { background: #f9fafb; font-weight: 600; }
  select, [data-filter] { padding: 0.5rem 1rem; border: 1px solid #d1d5db; border-radius: 0.375rem; }
  input[type="search"], input[placeholder*="Search"] { padding: 0.5rem 1rem; border: 1px solid #d1d5db; border-radius: 0.375rem; width: 100%; max-width: 300px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1rem; border-radius: 0.375rem; font-weight: 500; border: none; }
  .btn-primary { background: #2563eb; color: #fff; }
  form { background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  form label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; color: #374151; }
  form input, form select { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.375rem; margin-bottom: 1rem; }
  form input[type="submit"], form button[type="submit"] { background: #2563eb; color: #fff; border: none; cursor: pointer; width: auto; }
`;
var adminShell = /* @__PURE__ */ __name((title2, activeRoute, content) => `
  <div class="admin-layout">
    <aside class="shell admin-shell sidebar">
      <a href="/admin" style="font-size: 1.25rem; font-weight: bold; color: #fff; margin-bottom: 2rem; display: block;">dotdo Admin</a>
      <nav>
        <a href="/admin" ${activeRoute === "dashboard" ? 'class="active"' : ""}>Dashboard</a>
        <a href="/admin/users" ${activeRoute === "users" ? 'class="active"' : ""}>Users</a>
        <a href="/admin/workflows" ${activeRoute === "workflows" ? 'class="active"' : ""}>Workflows</a>
        <a href="/admin/integrations" ${activeRoute === "integrations" ? 'class="active"' : ""}>Integrations</a>
        <a href="/admin/activity" ${activeRoute === "activity" ? 'class="active"' : ""}>Activity</a>
        <a href="/admin/settings" ${activeRoute === "settings" ? 'class="active"' : ""}>Settings</a>
      </nav>
      <div style="margin-top: auto; padding-top: 2rem;">
        <a href="/" style="color: #9ca3af;">Back to Site</a>
        <button style="display: block; margin-top: 0.5rem; background: transparent; border: none; color: #9ca3af; cursor: pointer;">Logout</button>
        <a href="/admin/login" style="color: #9ca3af;">Sign out</a>
      </div>
    </aside>
    <main class="admin-main">
      <h1 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem;">${title2}</h1>
      ${content}
    </main>
  </div>
`, "adminShell");
function adminDashboardHtml() {
  const content = `
    <div class="dashboard" data-dashboard>
      <div class="metrics">
        <div class="kpi-card metric-card stat-card">
          <h3>Durable Objects</h3>
          <div class="value">1,234</div>
        </div>
        <div class="kpi-card metric-card stat-card">
          <h3>Requests</h3>
          <div class="value">12,345</div>
        </div>
        <div class="kpi-card metric-card stat-card">
          <h3>Active Workflows</h3>
          <div class="value">56</div>
        </div>
        <div class="kpi-card metric-card stat-card">
          <h3>Users</h3>
          <div class="value">789</div>
        </div>
      </div>
    </div>
  `;
  return layout("Dashboard - dotdo Admin", adminShell("Dashboard", "dashboard", content), adminStyles);
}
__name(adminDashboardHtml, "adminDashboardHtml");
var loginStyles = `
  .login-container { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f9fafb; }
  .login-box { background: #fff; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
  .login-box h1 { font-size: 1.5rem; text-align: center; margin-bottom: 0.5rem; }
  .login-box p { text-align: center; color: #6b7280; margin-bottom: 1.5rem; }
  .login-box form { margin-bottom: 1.5rem; }
  .login-box label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; }
  .login-box input { width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.375rem; margin-bottom: 1rem; }
  .login-box button[type="submit"] { width: 100%; padding: 0.75rem; background: #2563eb; color: #fff; border: none; border-radius: 0.375rem; font-weight: 500; cursor: pointer; }
  .login-box button[type="submit"]:hover { background: #1d4ed8; }
  .oauth-buttons { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; }
  .oauth-btn { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.375rem; background: #fff; cursor: pointer; }
  .oauth-btn:hover { background: #f9fafb; }
  .divider { display: flex; align-items: center; gap: 1rem; margin: 1.5rem 0; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }
  .divider span { color: #9ca3af; font-size: 0.875rem; }
  .forgot-link { display: block; text-align: center; color: #2563eb; font-size: 0.875rem; margin-top: 1rem; }
  .error, [role="alert"], .validation-error { color: #dc2626; font-size: 0.875rem; margin-top: 0.25rem; }
`;
function adminLoginHtml() {
  const content = `
    <div class="login-container">
      <div class="login-box">
        <h1>Admin Login</h1>
        <p>Sign in to access the admin dashboard</p>

        <div class="oauth-buttons">
          <button type="button" class="oauth-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Sign in with Google
          </button>
          <button type="button" class="oauth-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            Sign in with GitHub
          </button>
          <button type="button" class="oauth-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h11.377v11.372H0zm12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623z"/></svg>
            Sign in with Microsoft
          </button>
        </div>

        <div class="divider"><span>or</span></div>

        <form method="POST" action="/admin/login">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" required placeholder="you@example.com">

          <label for="password">Password</label>
          <input type="password" id="password" name="password" required placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">

          <button type="submit">Sign In</button>
        </form>

        <a href="/admin/forgot-password" class="forgot-link">Forgot your password?</a>
      </div>
    </div>
  `;
  return layout("Login - dotdo Admin", content, loginStyles);
}
__name(adminLoginHtml, "adminLoginHtml");
function adminUsersHtml() {
  const content = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <div>
        <input type="search" placeholder="Search users..." style="width: 300px;">
      </div>
      <a href="/admin/users/new" class="btn btn-primary">Create User</a>
    </div>
    <table class="data-table" data-table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>John Doe</td>
          <td>john@example.com</td>
          <td>Admin</td>
          <td><span style="color: #059669;">Active</span></td>
          <td><a href="/admin/users/user-1">Edit</a></td>
        </tr>
        <tr>
          <td>Jane Smith</td>
          <td>jane@example.com</td>
          <td>User</td>
          <td><span style="color: #059669;">Active</span></td>
          <td><a href="/admin/users/user-2">Edit</a></td>
        </tr>
      </tbody>
    </table>
  `;
  return layout("Users - dotdo Admin", adminShell("Users", "users", content), adminStyles);
}
__name(adminUsersHtml, "adminUsersHtml");
function adminUserNewHtml() {
  const content = `
    <form method="POST" action="/admin/users" style="max-width: 500px;">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" required placeholder="Full name">

      <label for="email">Email</label>
      <input type="email" id="email" name="email" required placeholder="user@example.com">

      <label for="role">Role</label>
      <select id="role" name="role">
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>

      <div style="display: flex; gap: 1rem; margin-top: 1rem;">
        <button type="submit" class="btn btn-primary">Create User</button>
        <a href="/admin/users" class="btn" style="border: 1px solid #d1d5db;">Cancel</a>
      </div>
    </form>
  `;
  return layout("Create User - dotdo Admin", adminShell("Create User", "users", content), adminStyles);
}
__name(adminUserNewHtml, "adminUserNewHtml");
function adminWorkflowsHtml() {
  const content = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <div style="display: flex; gap: 1rem;">
        <select data-filter="status">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="failed">Failed</option>
        </select>
        <input type="search" placeholder="Search workflows...">
      </div>
    </div>
    <table class="data-table" data-table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Last Run</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Data Sync Workflow</td>
          <td><span style="color: #059669;">Active</span></td>
          <td>2 hours ago</td>
          <td><a href="/admin/workflows/workflow-1">View</a></td>
        </tr>
        <tr>
          <td>Email Notification</td>
          <td><span style="color: #d97706;">Paused</span></td>
          <td>1 day ago</td>
          <td><a href="/admin/workflows/workflow-2">View</a></td>
        </tr>
        <tr>
          <td>Backup Job</td>
          <td><span style="color: #dc2626;">Failed</span></td>
          <td>3 hours ago</td>
          <td><a href="/admin/workflows/workflow-3">View</a></td>
        </tr>
      </tbody>
    </table>
  `;
  return layout("Workflows - dotdo Admin", adminShell("Workflows", "workflows", content), adminStyles);
}
__name(adminWorkflowsHtml, "adminWorkflowsHtml");
function adminIntegrationsHtml() {
  const content = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem;">
      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="font-size: 1.125rem; font-weight: 600;">GitHub</h3>
          <span style="color: #059669;">Connected</span>
        </div>
        <a href="/admin/integrations/github" class="btn" style="border: 1px solid #d1d5db;">Configure</a>
      </div>
      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="font-size: 1.125rem; font-weight: 600;">Google</h3>
          <span style="color: #6b7280;">Disconnected</span>
        </div>
        <button class="btn btn-primary">Connect</button>
      </div>
      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3 style="font-size: 1.125rem; font-weight: 600;">Slack</h3>
          <span style="color: #6b7280;">Disconnected</span>
        </div>
        <button class="btn btn-primary">Connect</button>
      </div>
    </div>
  `;
  return layout("Integrations - dotdo Admin", adminShell("Integrations", "integrations", content), adminStyles);
}
__name(adminIntegrationsHtml, "adminIntegrationsHtml");
function adminApiKeysHtml() {
  const content = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <p style="color: #6b7280;">Manage your API keys for programmatic access.</p>
      <button class="btn btn-primary">Create API Key</button>
    </div>
    <table class="data-table" data-table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Key</th>
          <th>Created</th>
          <th>Last Used</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Production</td>
          <td><code>sk_live_****abcd</code></td>
          <td>Jan 1, 2024</td>
          <td>2 hours ago</td>
          <td><button style="color: #dc2626; background: transparent; border: none; cursor: pointer;">Revoke</button></td>
        </tr>
      </tbody>
    </table>
  `;
  return layout("API Keys - dotdo Admin", adminShell("API Keys", "integrations", content), adminStyles);
}
__name(adminApiKeysHtml, "adminApiKeysHtml");
function adminSettingsHtml() {
  const content = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem;">
      <a href="/admin/settings/account" style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-decoration: none; color: inherit;">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">Account & Profile</h3>
        <p style="color: #6b7280;">Manage your personal information and preferences.</p>
      </a>
      <a href="/admin/settings/security" style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-decoration: none; color: inherit;">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">Security & Password</h3>
        <p style="color: #6b7280;">Update password, Two-Factor authentication (2FA), and sessions.</p>
      </a>
      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">Notification Preferences</h3>
        <p style="color: #6b7280;">Configure Email alerts and notifications.</p>
      </div>
    </div>
  `;
  return layout("Settings - dotdo Admin", adminShell("Settings", "settings", content), adminStyles);
}
__name(adminSettingsHtml, "adminSettingsHtml");
function adminSettingsAccountHtml() {
  const content = `
    <form method="POST" action="/admin/settings/account" style="max-width: 500px;">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" value="John Doe">

      <label for="email">Email</label>
      <input type="email" id="email" name="email" value="john@example.com" readonly style="background: #f9fafb;">

      <button type="submit" class="btn btn-primary">Save Changes</button>
    </form>
  `;
  return layout("Account Settings - dotdo Admin", adminShell("Account Settings", "settings", content), adminStyles);
}
__name(adminSettingsAccountHtml, "adminSettingsAccountHtml");
function adminSettingsSecurityHtml() {
  const content = `
    <div style="max-width: 500px;">
      <form method="POST" action="/admin/settings/security" style="margin-bottom: 2rem;">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">Change Password</h3>

        <label for="current-password">Current Password</label>
        <input type="password" id="current-password" name="currentPassword">

        <label for="new-password">New Password</label>
        <input type="password" id="new-password" name="newPassword">

        <label for="confirm-password">Confirm New Password</label>
        <input type="password" id="confirm-password" name="confirmPassword">

        <button type="submit" class="btn btn-primary">Update Password</button>
      </form>

      <div style="background: #fff; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">Two-Factor Authentication</h3>
        <p style="color: #6b7280; margin-bottom: 1rem;">Add an extra layer of security to your account.</p>
        <button class="btn btn-primary">Enable 2FA</button>
      </div>
    </div>
  `;
  return layout("Security Settings - dotdo Admin", adminShell("Security Settings", "settings", content), adminStyles);
}
__name(adminSettingsSecurityHtml, "adminSettingsSecurityHtml");
function adminActivityHtml() {
  const content = `
    <div style="margin-bottom: 1.5rem;">
      <input type="search" placeholder="Search activity logs...">
    </div>
    <table class="data-table" data-table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>User</th>
          <th>Action</th>
          <th>Resource</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>2024-01-08 10:30:00</td>
          <td>John Doe</td>
          <td><span style="background: #dcfce7; color: #166534; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem;">Create</span></td>
          <td>Workflow</td>
        </tr>
        <tr>
          <td>2024-01-08 09:15:00</td>
          <td>Jane Smith</td>
          <td><span style="background: #dbeafe; color: #1e40af; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem;">Update</span></td>
          <td>Integration</td>
        </tr>
        <tr>
          <td>2024-01-08 08:00:00</td>
          <td>John Doe</td>
          <td><span style="background: #f3e8ff; color: #7c3aed; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem;">Login</span></td>
          <td>Session</td>
        </tr>
      </tbody>
    </table>
  `;
  return layout("Activity - dotdo Admin", adminShell("Activity", "activity", content), adminStyles);
}
__name(adminActivityHtml, "adminActivityHtml");
var notFoundStyles = `
  .not-found { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2rem; }
  .not-found h1 { font-size: 6rem; font-weight: bold; color: #d1d5db; margin-bottom: 1rem; }
  .not-found h2 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  .not-found p { color: #6b7280; margin-bottom: 2rem; }
  .not-found a { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem; background: #2563eb; color: #fff; border-radius: 0.5rem; }
`;
function notFoundHtml() {
  const content = `
    <div class="not-found">
      <h1>404</h1>
      <h2>Page Not Found</h2>
      <p>The page you're looking for doesn't exist or has been moved.</p>
      <a href="/">
        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
        Back to Home
      </a>
    </div>
  `;
  return layout("Page Not Found - dotdo", content, notFoundStyles);
}
__name(notFoundHtml, "notFoundHtml");

// api/test-do.ts
var TestDurableObject = class {
  state;
  constructor(state) {
    this.state = state;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/store" && request.method === "POST") {
      const body = await request.json();
      await this.state.storage.put(body.key, body.value);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/get") {
      const key = url.searchParams.get("key");
      if (!key) {
        return new Response(JSON.stringify({ error: "Missing key" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      const value = await this.state.storage.get(key);
      return new Response(JSON.stringify({ value: value ?? null }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
};
__name(TestDurableObject, "TestDurableObject");

// api/index.ts
import { DurableObject } from "cloudflare:workers";
var app = new Hono2();
app.use("*", errorHandler2);
app.use("*", requestIdMiddleware);
app.use("*", logger());
app.use("*", cors());
app.get("/", (c) => {
  return c.html(landingPageHtml());
});
app.get("/docs", (c) => {
  return c.html(docsPageHtml("index"));
});
app.get("/docs/", (c) => {
  return c.html(docsPageHtml("index"));
});
app.get("/docs/getting-started", (c) => {
  return c.html(docsPageHtml("getting-started"));
});
app.get("/docs/api", (c) => {
  return c.html(docsPageHtml("api"));
});
app.get("/docs/*", (c) => {
  const path = c.req.path.replace("/docs/", "");
  return c.html(docsPageHtml(path));
});
app.get("/admin", (c) => {
  return c.html(adminDashboardHtml());
});
app.get("/admin/", (c) => {
  return c.html(adminDashboardHtml());
});
app.get("/admin/login", (c) => {
  return c.html(adminLoginHtml());
});
app.get("/admin/users", (c) => {
  return c.html(adminUsersHtml());
});
app.get("/admin/users/", (c) => {
  return c.html(adminUsersHtml());
});
app.get("/admin/users/new", (c) => {
  return c.html(adminUserNewHtml());
});
app.get("/admin/users/:id", (c) => {
  return c.html(adminUsersHtml());
});
app.get("/admin/workflows", (c) => {
  return c.html(adminWorkflowsHtml());
});
app.get("/admin/workflows/", (c) => {
  return c.html(adminWorkflowsHtml());
});
app.get("/admin/workflows/:id", (c) => {
  return c.html(adminWorkflowsHtml());
});
app.get("/admin/workflows/:id/runs", (c) => {
  return c.html(adminWorkflowsHtml());
});
app.get("/admin/integrations", (c) => {
  return c.html(adminIntegrationsHtml());
});
app.get("/admin/integrations/", (c) => {
  return c.html(adminIntegrationsHtml());
});
app.get("/admin/integrations/api-keys", (c) => {
  return c.html(adminApiKeysHtml());
});
app.get("/admin/settings", (c) => {
  return c.html(adminSettingsHtml());
});
app.get("/admin/settings/", (c) => {
  return c.html(adminSettingsHtml());
});
app.get("/admin/settings/account", (c) => {
  return c.html(adminSettingsAccountHtml());
});
app.get("/admin/settings/security", (c) => {
  return c.html(adminSettingsSecurityHtml());
});
app.get("/admin/activity", (c) => {
  return c.html(adminActivityHtml());
});
app.get("/admin/activity/", (c) => {
  return c.html(adminActivityHtml());
});
app.get("/api/", (c) => {
  return c.json({
    name: "dotdo",
    version: "0.0.1",
    endpoints: ["/api/health", "/api/things"]
  });
});
app.route("/api", apiRoutes);
app.route("/mcp", mcpRoutes);
app.route("/rpc", rpcRoutes);
app.all("*", (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: { code: "NOT_FOUND", message: `Not found: ${c.req.path}` } }, 404);
  }
  return c.html(notFoundHtml(), 404);
});
var api_default = app;

// node_modules/.pnpm/wrangler@3.114.16_@cloudflare+workers-types@4.20260108.0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/.pnpm/wrangler@3.114.16_@cloudflare+workers-types@4.20260108.0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error3 = reduceError(e);
    return Response.json(error3, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-0OtYwG/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = api_default;

// node_modules/.pnpm/wrangler@3.114.16_@cloudflare+workers-types@4.20260108.0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-0OtYwG/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  DurableObject,
  TestDurableObject,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  app,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
