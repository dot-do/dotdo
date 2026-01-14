/**
 * Pyodide Package Compatibility
 *
 * Lists known Pyodide-compatible packages and provides utilities
 * for checking package compatibility with Pyodide/WebAssembly.
 */

import type { PyodidePackageInfo } from './types'

/**
 * Known Pyodide-compatible packages
 *
 * This list includes:
 * 1. Packages bundled with Pyodide
 * 2. Pure Python packages that work in Pyodide
 * 3. Packages with WASM builds available
 */
export const PYODIDE_PACKAGES: Record<string, PyodidePackageInfo> = {
  // Core scientific packages bundled with Pyodide
  numpy: { minVersion: '1.24.0', purePython: false },
  scipy: { minVersion: '1.10.0', purePython: false },
  pandas: { minVersion: '2.0.0', purePython: false },
  matplotlib: { minVersion: '3.7.0', purePython: false },
  scikit_learn: { minVersion: '1.3.0', purePython: false },
  'scikit-learn': { minVersion: '1.3.0', purePython: false },
  sympy: { minVersion: '1.12', purePython: true },
  networkx: { minVersion: '3.1', purePython: true },
  pillow: { minVersion: '10.0.0', purePython: false },
  pil: { minVersion: '10.0.0', purePython: false },
  lxml: { minVersion: '4.9.0', purePython: false },
  sqlalchemy: { minVersion: '2.0.0', purePython: true },

  // Pure Python web/http packages
  requests: { purePython: true },
  httpx: { purePython: true },
  urllib3: { purePython: true },
  certifi: { purePython: true },
  idna: { purePython: true },
  'charset-normalizer': { purePython: true },
  chardet: { purePython: true },

  // Pure Python utilities
  six: { purePython: true },
  attrs: { purePython: true },
  click: { purePython: true },
  rich: { purePython: true },
  tqdm: { purePython: true },
  pyyaml: { minVersion: '6.0', purePython: false },
  yaml: { minVersion: '6.0', purePython: false },
  toml: { purePython: true },
  tomli: { purePython: true },
  tomllib: { purePython: true },
  json5: { purePython: true },
  jsonschema: { purePython: true },
  pytz: { purePython: true },
  dateutil: { purePython: true },
  'python-dateutil': { purePython: true },
  arrow: { purePython: true },
  pendulum: { purePython: true },
  packaging: { purePython: true },

  // Web frameworks (pure Python)
  flask: { purePython: true },
  werkzeug: { purePython: true },
  jinja2: { purePython: true },
  markupsafe: { purePython: false },
  itsdangerous: { purePython: true },
  fastapi: { purePython: true },
  starlette: { purePython: true },
  pydantic: { purePython: true },
  'pydantic-core': { purePython: false },

  // Testing
  pytest: { purePython: true },
  'pytest-asyncio': { purePython: true },
  hypothesis: { purePython: true },
  mock: { purePython: true },
  'unittest-mock': { purePython: true },

  // Typing/development
  typing_extensions: { purePython: true },
  'typing-extensions': { purePython: true },
  mypy_extensions: { purePython: true },
  annotated_types: { purePython: true },

  // Data processing
  beautifulsoup4: { purePython: true },
  bs4: { purePython: true },
  html5lib: { purePython: true },
  soupsieve: { purePython: true },
  cssselect: { purePython: true },
  regex: { minVersion: '2023.0.0', purePython: false },
  pyparsing: { purePython: true },
  parso: { purePython: true },

  // Async
  aiohttp: { purePython: true },
  anyio: { purePython: true },
  sniffio: { purePython: true },
  h11: { purePython: true },
  httpcore: { purePython: true },

  // Crypto (limited support)
  cryptography: { minVersion: '41.0.0', purePython: false },
  bcrypt: { purePython: false },
  pyjwt: { purePython: true },
  jwt: { purePython: true },

  // Compression
  zlib: { purePython: false },
  gzip: { purePython: false },
  bz2: { purePython: false },
  lzma: { purePython: false },

  // Other bundled
  astropy: { minVersion: '5.3', purePython: false },
  biopython: { minVersion: '1.81', purePython: false },
  opencv_python: { minVersion: '4.8.0', purePython: false },
  'opencv-python': { minVersion: '4.8.0', purePython: false },
  pyarrow: { minVersion: '14.0.0', purePython: false },
  polars: { minVersion: '0.19.0', purePython: false },
}

/**
 * Packages known to NOT work with Pyodide
 * (require native code not ported to WASM)
 */
export const INCOMPATIBLE_PACKAGES: Set<string> = new Set([
  // Database drivers (require native libs)
  'psycopg2',
  'psycopg2-binary',
  'mysqlclient',
  'mysql-connector-python',
  'pymssql',
  'cx_oracle',
  'oracledb',
  'snowflake-connector-python',

  // System-level packages
  'gevent',
  'greenlet',
  'eventlet',
  'uwsgi',
  'gunicorn',
  'supervisor',

  // Native networking
  'twisted',
  'tornado',
  'pyzmq',
  'zmq',

  // Native GUI
  'pyqt5',
  'pyqt6',
  'pyside2',
  'pyside6',
  'wxpython',
  'tkinter',
  'pyglet',
  'pygame',

  // Heavy native dependencies
  'tensorflow',
  'torch',
  'pytorch',
  'jax',
  'jaxlib',
  'cupy',

  // System bindings
  'ctypes',
  'cffi',
  'pycparser',
  'cython',
  'mypyc',

  // Hardware access
  'pyserial',
  'pyusb',
  'pybluez',
  'gpiozero',
  'rpi.gpio',

  // Audio/video native
  'pyaudio',
  'sounddevice',
  'ffmpeg-python',
  'moviepy',

  // Multiprocessing (not supported in browser)
  'multiprocessing',
  'ray',
  'dask',
  'joblib',
])

/**
 * Mock dependency graph for common packages
 * Used when resolveDependencies is true
 */
export const PACKAGE_DEPENDENCIES: Record<string, Record<string, string[]>> = {
  requests: {
    '2.28.0': ['urllib3', 'charset-normalizer', 'idna', 'certifi'],
    '2.29.0': ['urllib3', 'charset-normalizer', 'idna', 'certifi'],
    '2.31.0': ['urllib3', 'charset-normalizer', 'idna', 'certifi'],
  },
  httpx: {
    '0.24.0': ['certifi', 'httpcore', 'idna', 'sniffio'],
    '0.25.0': ['anyio', 'certifi', 'httpcore', 'idna', 'sniffio'],
  },
  flask: {
    '2.0.0': ['werkzeug', 'jinja2', 'itsdangerous', 'click'],
    '3.0.0': ['werkzeug', 'jinja2', 'itsdangerous', 'click', 'blinker'],
  },
  pandas: {
    '2.0.0': ['numpy', 'python-dateutil', 'pytz', 'tzdata'],
    '2.1.0': ['numpy', 'python-dateutil', 'pytz', 'tzdata'],
  },
  'circular-dep-package': {
    '1.0.0': [], // Mock package for testing circular dep handling
  },
}

/**
 * Available versions for packages (mock data for version resolution)
 */
export const AVAILABLE_VERSIONS: Record<string, string[]> = {
  requests: ['2.25.0', '2.26.0', '2.27.0', '2.28.0', '2.28.1', '2.28.2', '2.29.0', '2.30.0', '2.31.0'],
  flask: ['1.1.0', '2.0.0', '2.1.0', '2.2.0', '2.3.0', '3.0.0'],
  numpy: ['1.20.0', '1.21.0', '1.22.0', '1.23.0', '1.24.0', '1.24.1', '1.24.2', '1.25.0', '1.26.0'],
  pandas: ['1.5.0', '2.0.0', '2.0.1', '2.1.0', '2.1.1'],
  httpx: ['0.23.0', '0.24.0', '0.24.1', '0.25.0', '0.25.1'],
  urllib3: ['1.26.0', '1.26.18', '2.0.0', '2.1.0'],
  certifi: ['2023.7.22', '2023.11.17', '2024.2.2'],
  idna: ['3.4', '3.5', '3.6'],
  'charset-normalizer': ['3.2.0', '3.3.0', '3.3.2'],
  httpcore: ['0.17.0', '0.18.0', '1.0.0'],
  sniffio: ['1.3.0', '1.3.1'],
  anyio: ['3.7.0', '4.0.0', '4.2.0'],
  werkzeug: ['2.3.0', '3.0.0', '3.0.1'],
  jinja2: ['3.1.0', '3.1.2', '3.1.3'],
  itsdangerous: ['2.1.0', '2.1.2'],
  click: ['8.1.0', '8.1.7'],
  blinker: ['1.7.0'],
  'python-dateutil': ['2.8.0', '2.8.2'],
  pytz: ['2023.3', '2024.1'],
  tzdata: ['2024.1'],
  'circular-dep-package': ['1.0.0'],
  psycopg2: ['2.9.0', '2.9.9'],
  'my-package': ['1.0.0', '2.0.0'],
}

/**
 * Normalize package name (PEP 503)
 * Converts to lowercase and replaces underscores/dots with hyphens
 */
export function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[._]/g, '-')
}

/**
 * Check if a package is known to be compatible with Pyodide
 */
export function isPyodideCompatible(name: string, version?: string): boolean {
  const normalized = normalizePackageName(name)

  // Check if explicitly incompatible
  if (INCOMPATIBLE_PACKAGES.has(normalized)) {
    return false
  }

  // Check if in known compatible list
  const info = PYODIDE_PACKAGES[normalized]
  if (!info) {
    // Unknown package - assume compatible if pure Python could work
    // In real implementation, would check package metadata
    return true
  }

  // Check version compatibility
  if (version && info.minVersion) {
    const compareResult = compareVersions(version, info.minVersion)
    if (compareResult < 0) {
      return false
    }
  }

  if (version && info.maxVersion) {
    const compareResult = compareVersions(version, info.maxVersion)
    if (compareResult > 0) {
      return false
    }
  }

  return true
}

/**
 * Compare two version strings
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((p) => parseInt(p, 10) || 0)
  const partsB = b.split('.').map((p) => parseInt(p, 10) || 0)

  const maxLen = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] || 0
    const partB = partsB[i] || 0

    if (partA < partB) return -1
    if (partA > partB) return 1
  }

  return 0
}

/**
 * Get dependencies for a package at a specific version
 */
export function getPackageDependencies(name: string, version: string): string[] {
  const normalized = normalizePackageName(name)
  const pkgDeps = PACKAGE_DEPENDENCIES[normalized]

  if (!pkgDeps) {
    return []
  }

  // Try exact version first
  if (pkgDeps[version]) {
    return pkgDeps[version]
  }

  // Fall back to any available version's deps
  const versions = Object.keys(pkgDeps)
  if (versions.length > 0) {
    return pkgDeps[versions[versions.length - 1]]
  }

  return []
}

/**
 * Get available versions for a package
 */
export function getAvailableVersions(name: string): string[] {
  const normalized = normalizePackageName(name)
  return AVAILABLE_VERSIONS[normalized] || []
}

/**
 * Find the latest version satisfying a constraint
 */
export function resolveVersion(name: string, constraint?: string): string | null {
  const versions = getAvailableVersions(name)

  if (versions.length === 0) {
    return null
  }

  if (!constraint) {
    // Return latest version
    return versions[versions.length - 1]
  }

  // Parse constraint
  const parsed = parseVersionConstraint(constraint)

  // Filter and sort versions
  const matching = versions.filter((v) => satisfiesConstraint(v, parsed))

  if (matching.length === 0) {
    return null
  }

  // Return the highest matching version
  return matching[matching.length - 1]
}

interface ParsedConstraint {
  constraints: Array<{
    op: string
    version: string
  }>
}

/**
 * Parse a version constraint string like ">=2.28.0,<3.0.0"
 */
export function parseVersionConstraint(constraint: string): ParsedConstraint {
  const constraints: Array<{ op: string; version: string }> = []

  // Handle multiple constraints separated by comma
  const parts = constraint.split(',').map((p) => p.trim())

  for (const part of parts) {
    // Match operator and version
    const match = part.match(/^(~=|===|==|!=|<=|>=|<|>)?(.+)$/)
    if (match) {
      const op = match[1] || '=='
      const version = match[2].trim()
      constraints.push({ op, version })
    }
  }

  return { constraints }
}

/**
 * Check if a version satisfies a parsed constraint
 */
export function satisfiesConstraint(version: string, parsed: ParsedConstraint): boolean {
  for (const { op, version: constraintVersion } of parsed.constraints) {
    const cmp = compareVersions(version, constraintVersion)

    switch (op) {
      case '==':
      case '===':
        if (cmp !== 0) return false
        break
      case '!=':
        if (cmp === 0) return false
        break
      case '<':
        if (cmp >= 0) return false
        break
      case '<=':
        if (cmp > 0) return false
        break
      case '>':
        if (cmp <= 0) return false
        break
      case '>=':
        if (cmp < 0) return false
        break
      case '~=':
        // Compatible release: ~=2.28.0 means >=2.28.0,<2.29.0 (or >=2.28,<3.0 for ~=2.28)
        const parts = constraintVersion.split('.')
        if (cmp < 0) return false
        // Check that major.minor matches
        const versionParts = version.split('.')
        for (let i = 0; i < parts.length - 1; i++) {
          if (versionParts[i] !== parts[i]) return false
        }
        break
    }
  }

  return true
}
