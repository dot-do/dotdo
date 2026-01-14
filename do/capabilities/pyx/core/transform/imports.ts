/**
 * Import rewriting utilities for Pyodide compatibility
 */

// Python standard library modules that don't need micropip installation
const STDLIB_MODULES = new Set([
  'abc',
  'aifc',
  'argparse',
  'array',
  'ast',
  'asynchat',
  'asyncio',
  'asyncore',
  'atexit',
  'audioop',
  'base64',
  'bdb',
  'binascii',
  'binhex',
  'bisect',
  'builtins',
  'bz2',
  'calendar',
  'cgi',
  'cgitb',
  'chunk',
  'cmath',
  'cmd',
  'code',
  'codecs',
  'codeop',
  'collections',
  'colorsys',
  'compileall',
  'concurrent',
  'configparser',
  'contextlib',
  'contextvars',
  'copy',
  'copyreg',
  'cProfile',
  'crypt',
  'csv',
  'ctypes',
  'curses',
  'dataclasses',
  'datetime',
  'dbm',
  'decimal',
  'difflib',
  'dis',
  'distutils',
  'doctest',
  'email',
  'encodings',
  'enum',
  'errno',
  'faulthandler',
  'fcntl',
  'filecmp',
  'fileinput',
  'fnmatch',
  'fractions',
  'ftplib',
  'functools',
  'gc',
  'getopt',
  'getpass',
  'gettext',
  'glob',
  'graphlib',
  'grp',
  'gzip',
  'hashlib',
  'heapq',
  'hmac',
  'html',
  'http',
  'idlelib',
  'imaplib',
  'imghdr',
  'imp',
  'importlib',
  'inspect',
  'io',
  'ipaddress',
  'itertools',
  'json',
  'keyword',
  'lib2to3',
  'linecache',
  'locale',
  'logging',
  'lzma',
  'mailbox',
  'mailcap',
  'marshal',
  'math',
  'mimetypes',
  'mmap',
  'modulefinder',
  'multiprocessing',
  'netrc',
  'nis',
  'nntplib',
  'numbers',
  'operator',
  'optparse',
  'os',
  'ossaudiodev',
  'pathlib',
  'pdb',
  'pickle',
  'pickletools',
  'pipes',
  'pkgutil',
  'platform',
  'plistlib',
  'poplib',
  'posix',
  'posixpath',
  'pprint',
  'profile',
  'pstats',
  'pty',
  'pwd',
  'py_compile',
  'pyclbr',
  'pydoc',
  'queue',
  'quopri',
  'random',
  're',
  'readline',
  'reprlib',
  'resource',
  'rlcompleter',
  'runpy',
  'sched',
  'secrets',
  'select',
  'selectors',
  'shelve',
  'shlex',
  'shutil',
  'signal',
  'site',
  'smtpd',
  'smtplib',
  'sndhdr',
  'socket',
  'socketserver',
  'spwd',
  'sqlite3',
  'ssl',
  'stat',
  'statistics',
  'string',
  'stringprep',
  'struct',
  'subprocess',
  'sunau',
  'symtable',
  'sys',
  'sysconfig',
  'syslog',
  'tabnanny',
  'tarfile',
  'telnetlib',
  'tempfile',
  'termios',
  'test',
  'textwrap',
  'threading',
  'time',
  'timeit',
  'tkinter',
  'token',
  'tokenize',
  'tomllib',
  'trace',
  'traceback',
  'tracemalloc',
  'tty',
  'turtle',
  'turtledemo',
  'types',
  'typing',
  'unicodedata',
  'unittest',
  'urllib',
  'uu',
  'uuid',
  'venv',
  'warnings',
  'wave',
  'weakref',
  'webbrowser',
  'winreg',
  'winsound',
  'wsgiref',
  'xdrlib',
  'xml',
  'xmlrpc',
  'zipapp',
  'zipfile',
  'zipimport',
  'zlib',
  'zoneinfo',
])

/**
 * Check if a module is part of the Python standard library
 */
function isStdlibModule(moduleName: string): boolean {
  // Get the top-level module name (e.g., "os.path" -> "os")
  const topLevel = moduleName.split('.')[0]
  return STDLIB_MODULES.has(topLevel)
}

/**
 * Extract module name from an import statement
 */
function extractModuleName(importLine: string): string | null {
  // Match "import X" or "import X as Y"
  const importMatch = importLine.match(/^\s*import\s+(\S+)/)
  if (importMatch) {
    return importMatch[1].split('.')[0]
  }

  // Match "from X import Y"
  const fromMatch = importLine.match(/^\s*from\s+(\S+)\s+import/)
  if (fromMatch) {
    return fromMatch[1].split('.')[0]
  }

  return null
}

/**
 * Rewrite imports for Pyodide compatibility.
 * Adds micropip.install() calls for non-stdlib packages.
 */
export function rewriteImports(code: string): string {
  const lines = code.split('\n')
  const result: string[] = []
  const installedPackages = new Set<string>()

  for (const line of lines) {
    const moduleName = extractModuleName(line)

    if (moduleName && !isStdlibModule(moduleName) && !installedPackages.has(moduleName)) {
      // Add micropip install before the import
      result.push(`await micropip.install("${moduleName}")`)
      installedPackages.add(moduleName)
    }

    result.push(line)
  }

  return result.join('\n')
}
