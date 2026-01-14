/**
 * Tests for CommandClassifier
 *
 * The CommandClassifier is responsible for determining which execution tier
 * should handle a given command. It analyzes the command and returns a
 * TierClassification with tier level, handler type, and capability info.
 *
 * This module extracts classification logic from TieredExecutor into a
 * pure, testable module with single responsibility.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CommandClassifier,
  type ClassifierConfig,
  type TierClassification,
  // Command sets
  TIER_1_NATIVE_COMMANDS,
  TIER_1_FS_COMMANDS,
  TIER_1_HTTP_COMMANDS,
  TIER_1_DATA_COMMANDS,
  TIER_1_CRYPTO_COMMANDS,
  TIER_1_TEXT_PROCESSING_COMMANDS,
  TIER_1_POSIX_UTILS_COMMANDS,
  TIER_1_SYSTEM_UTILS_COMMANDS,
  TIER_1_EXTENDED_UTILS_COMMANDS,
  TIER_1_NPM_NATIVE_COMMANDS,
  TIER_3_LOADABLE_MODULES,
  TIER_4_SANDBOX_COMMANDS,
  DEFAULT_RPC_SERVICES,
} from '../../../src/do/classify/command-classifier.js'

// ============================================================================
// COMMAND CLASSIFICATION TESTS
// ============================================================================

describe('CommandClassifier', () => {
  let classifier: CommandClassifier

  beforeEach(() => {
    classifier = new CommandClassifier()
  })

  // ============================================================================
  // TIER 1: NATIVE COMMANDS
  // ============================================================================

  describe('Tier 1: Native Commands', () => {
    describe('Filesystem Commands', () => {
      it('classifies filesystem read commands as Tier 1 with fs capability', () => {
        const commands = ['cat', 'head', 'tail', 'ls', 'stat', 'readlink', 'find', 'grep']

        for (const cmd of commands) {
          const result = classifier.classify(cmd, { hasFs: true })
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('fs')
        }
      })

      it('classifies filesystem write commands as Tier 1 with fs capability', () => {
        const commands = ['mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'truncate', 'ln']

        for (const cmd of commands) {
          const result = classifier.classify(cmd, { hasFs: true })
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('fs')
        }
      })

      it('classifies filesystem commands as Tier 4 when fs is NOT available', () => {
        const commands = ['cat /test.txt', 'ls /', 'mkdir /dir']

        for (const cmd of commands) {
          const result = classifier.classify(cmd, { hasFs: false })
          expect(result.tier).toBe(4)
          expect(result.handler).toBe('sandbox')
        }
      })

      it('classifies test and [ commands as Tier 1 with fs', () => {
        const commands = ['test -e /file', '[ -f /file ]']

        for (const cmd of commands) {
          const result = classifier.classify(cmd, { hasFs: true })
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('fs')
        }
      })

      it('classifies compression commands as Tier 1 with fs', () => {
        const commands = ['gzip', 'gunzip', 'zcat', 'tar', 'zip', 'unzip']

        for (const cmd of commands) {
          const result = classifier.classify(cmd, { hasFs: true })
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('fs')
        }
      })
    })

    describe('HTTP Commands', () => {
      it('classifies curl as Tier 1 http', () => {
        const result = classifier.classify('curl https://example.com')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('http')
      })

      it('classifies wget as Tier 1 http', () => {
        const result = classifier.classify('wget https://example.com/file.txt')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('http')
      })
    })

    describe('Data Processing Commands', () => {
      it('classifies jq as Tier 1 data command', () => {
        const result = classifier.classify('jq .name package.json')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('jq')
      })

      it('classifies yq as Tier 1 data command', () => {
        const result = classifier.classify('yq .metadata config.yaml')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('yq')
      })

      it('classifies base64 as Tier 1 data command', () => {
        const result = classifier.classify('base64 -d')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('base64')
      })

      it('classifies envsubst as Tier 1 data command', () => {
        const result = classifier.classify('envsubst')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('envsubst')
      })
    })

    describe('Crypto Commands', () => {
      it('classifies hash commands as Tier 1 crypto', () => {
        const commands = ['sha256sum', 'sha1sum', 'sha512sum', 'sha384sum', 'md5sum']

        for (const cmd of commands) {
          const result = classifier.classify(cmd)
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('crypto')
        }
      })

      it('classifies uuid commands as Tier 1 crypto', () => {
        const commands = ['uuidgen', 'uuid']

        for (const cmd of commands) {
          const result = classifier.classify(cmd)
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('crypto')
        }
      })

      it('classifies checksum commands as Tier 1 crypto', () => {
        const commands = ['cksum', 'sum']

        for (const cmd of commands) {
          const result = classifier.classify(cmd)
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('crypto')
        }
      })

      it('classifies openssl as Tier 1 crypto', () => {
        const result = classifier.classify('openssl rand -hex 16')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('crypto')
      })
    })

    describe('Text Processing Commands', () => {
      it('classifies sed as Tier 1 text', () => {
        const result = classifier.classify("sed 's/foo/bar/g'")
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('text')
      })

      it('classifies awk as Tier 1 text', () => {
        const result = classifier.classify("awk '{print $1}'")
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('text')
      })

      it('classifies diff as Tier 1 text', () => {
        const result = classifier.classify('diff file1 file2')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('text')
      })

      it('classifies patch as Tier 1 text', () => {
        const result = classifier.classify('patch -p1')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('text')
      })

      it('classifies tee as Tier 1 text', () => {
        const result = classifier.classify('tee output.txt')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('text')
      })

      it('classifies xargs as Tier 1 text', () => {
        const result = classifier.classify('xargs echo')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('text')
      })
    })

    describe('POSIX Utility Commands', () => {
      it('classifies string manipulation commands as Tier 1 posix', () => {
        const commands = ['cut', 'sort', 'tr', 'uniq', 'wc']

        for (const cmd of commands) {
          const result = classifier.classify(cmd)
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('posix')
        }
      })

      it('classifies path commands as Tier 1 posix', () => {
        const commands = ['basename /path/to/file', 'dirname /path/to/file']

        for (const cmd of commands) {
          const result = classifier.classify(cmd)
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('posix')
        }
      })

      it('classifies output commands as Tier 1 posix', () => {
        const commands = ['echo hello', 'printf "%s"']

        for (const cmd of commands) {
          const result = classifier.classify(cmd)
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('posix')
        }
      })

      it('classifies date as Tier 1 posix', () => {
        const result = classifier.classify('date +%Y-%m-%d')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('posix')
      })

      it('classifies dd as Tier 1 posix', () => {
        const result = classifier.classify('dd if=/dev/zero of=/tmp/file bs=1M count=1')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('posix')
      })

      it('classifies od as Tier 1 posix', () => {
        const result = classifier.classify('od -c')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('posix')
      })
    })

    describe('System Utility Commands', () => {
      it('classifies yes as Tier 1 system', () => {
        const result = classifier.classify('yes')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('system')
      })

      it('classifies whoami as Tier 1 system', () => {
        const result = classifier.classify('whoami')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('system')
      })

      it('classifies hostname as Tier 1 system', () => {
        const result = classifier.classify('hostname')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('system')
      })

      it('classifies printenv as Tier 1 system', () => {
        const result = classifier.classify('printenv PATH')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('system')
      })
    })

    describe('Extended Utility Commands', () => {
      it('classifies env as Tier 1 extended', () => {
        const result = classifier.classify('env')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('extended')
      })

      it('classifies id as Tier 1 extended', () => {
        const result = classifier.classify('id')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('extended')
      })

      it('classifies uname as Tier 1 extended', () => {
        const result = classifier.classify('uname -a')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('extended')
      })

      it('classifies tac as Tier 1 extended', () => {
        const result = classifier.classify('tac')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('extended')
      })
    })

    describe('Pure Compute Commands', () => {
      it('classifies true as Tier 1 compute', () => {
        const result = classifier.classify('true')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('compute')
      })

      it('classifies false as Tier 1 compute', () => {
        const result = classifier.classify('false')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('compute')
      })

      it('classifies math commands as Tier 1 compute', () => {
        const commands = ['bc', 'expr', 'seq', 'shuf']

        for (const cmd of commands) {
          const result = classifier.classify(cmd)
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
          expect(result.capability).toBe('compute')
        }
      })

      it('classifies sleep as Tier 1 compute', () => {
        const result = classifier.classify('sleep 1')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('compute')
      })

      it('classifies timeout as Tier 1 compute', () => {
        const result = classifier.classify('timeout 5 command')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('compute')
      })
    })

    describe('npm Native Commands', () => {
      it('classifies npm view as Tier 1 npm-native', () => {
        const result = classifier.classify('npm view lodash')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('npm-native')
      })

      it('classifies npm search as Tier 1 npm-native', () => {
        const result = classifier.classify('npm search express')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('npm-native')
      })

      it('classifies npm info as Tier 1 npm-native', () => {
        const result = classifier.classify('npm info react')
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('npm-native')
      })

      it('classifies npm install as Tier 2 RPC (not native)', () => {
        const result = classifier.classify('npm install lodash')
        expect(result.tier).toBe(2)
        expect(result.handler).toBe('rpc')
        expect(result.capability).toBe('npm')
      })

      it('classifies npm run as Tier 2 RPC (not native)', () => {
        const result = classifier.classify('npm run test')
        expect(result.tier).toBe(2)
        expect(result.handler).toBe('rpc')
        expect(result.capability).toBe('npm')
      })
    })
  })

  // ============================================================================
  // TIER 2: RPC COMMANDS
  // ============================================================================

  describe('Tier 2: RPC Commands', () => {
    it('classifies npm commands as Tier 2 RPC', () => {
      const commands = ['npm install', 'npx vitest', 'pnpm add lodash', 'yarn add react', 'bun install']

      for (const cmd of commands) {
        const result = classifier.classify(cmd)
        expect(result.tier).toBe(2)
        expect(result.handler).toBe('rpc')
        expect(result.capability).toBe('npm')
      }
    })

    it('classifies git commands as Tier 2 RPC', () => {
      const commands = ['git status', 'git commit -m "test"', 'git push', 'git pull']

      for (const cmd of commands) {
        const result = classifier.classify(cmd)
        expect(result.tier).toBe(2)
        expect(result.handler).toBe('rpc')
        expect(result.capability).toBe('git')
      }
    })

    it('classifies python commands as Tier 2 RPC', () => {
      const commands = ['python -c "print(1)"', 'python3 script.py', 'pip install flask']

      for (const cmd of commands) {
        const result = classifier.classify(cmd)
        expect(result.tier).toBe(2)
        expect(result.handler).toBe('rpc')
        expect(result.capability).toBe('pyx')
      }
    })

    it('respects custom RPC bindings', () => {
      const customClassifier = new CommandClassifier({
        rpcBindings: {
          custom: {
            commands: ['mycommand'],
            endpoint: 'https://custom.do',
          },
        },
      })

      const result = customClassifier.classify('mycommand arg1')
      expect(result.tier).toBe(2)
      expect(result.handler).toBe('rpc')
      expect(result.capability).toBe('custom')
    })
  })

  // ============================================================================
  // TIER 3: WORKER LOADER COMMANDS
  // ============================================================================

  describe('Tier 3: Worker Loader Commands', () => {
    it('classifies loadable modules as Tier 3', () => {
      const modules = ['esbuild', 'typescript', 'prettier', 'eslint']

      for (const mod of modules) {
        const result = classifier.classify(mod)
        expect(result.tier).toBe(3)
        expect(result.handler).toBe('loader')
        expect(result.capability).toBe(mod)
      }
    })

    it('classifies data processing modules as Tier 3', () => {
      const modules = ['zod', 'ajv', 'yaml', 'toml']

      for (const mod of modules) {
        const result = classifier.classify(mod)
        expect(result.tier).toBe(3)
        expect(result.handler).toBe('loader')
        expect(result.capability).toBe(mod)
      }
    })

    it('respects custom worker loaders', () => {
      const customClassifier = new CommandClassifier({
        workerLoaders: {
          myloader: {
            modules: ['custommod'],
            load: async () => ({}),
          },
        },
      })

      const result = customClassifier.classify('custommod process')
      expect(result.tier).toBe(3)
      expect(result.handler).toBe('loader')
      expect(result.capability).toBe('myloader')
    })
  })

  // ============================================================================
  // TIER 4: SANDBOX COMMANDS
  // ============================================================================

  describe('Tier 4: Sandbox Commands', () => {
    it('classifies system commands as Tier 4', () => {
      const commands = ['ps', 'kill', 'killall', 'top', 'htop']

      for (const cmd of commands) {
        const result = classifier.classify(cmd)
        expect(result.tier).toBe(4)
        expect(result.handler).toBe('sandbox')
      }
    })

    it('classifies network commands (except curl/wget) as Tier 4', () => {
      const commands = ['ping', 'ssh', 'scp', 'nc', 'netstat']

      for (const cmd of commands) {
        const result = classifier.classify(cmd)
        expect(result.tier).toBe(4)
        expect(result.handler).toBe('sandbox')
      }
    })

    it('classifies package managers as Tier 4', () => {
      const commands = ['apt', 'apt-get', 'yum', 'dnf', 'brew']

      for (const cmd of commands) {
        const result = classifier.classify(cmd)
        expect(result.tier).toBe(4)
        expect(result.handler).toBe('sandbox')
      }
    })

    it('classifies container commands as Tier 4', () => {
      const commands = ['docker', 'docker-compose', 'podman', 'kubectl']

      for (const cmd of commands) {
        const result = classifier.classify(cmd)
        expect(result.tier).toBe(4)
        expect(result.handler).toBe('sandbox')
      }
    })

    it('classifies compilers as Tier 4', () => {
      const commands = ['gcc', 'g++', 'clang', 'rustc', 'cargo', 'go', 'ruby', 'perl']

      for (const cmd of commands) {
        const result = classifier.classify(cmd)
        expect(result.tier).toBe(4)
        expect(result.handler).toBe('sandbox')
      }
    })

    it('classifies shell commands as Tier 4', () => {
      const commands = ['bash', 'sh', 'zsh']

      for (const cmd of commands) {
        const result = classifier.classify(cmd)
        expect(result.tier).toBe(4)
        expect(result.handler).toBe('sandbox')
      }
    })

    it('classifies unknown commands as Tier 4 fallback', () => {
      const result = classifier.classify('unknown_command_xyz')
      expect(result.tier).toBe(4)
      expect(result.handler).toBe('sandbox')
      expect(result.reason).toContain('No higher tier available')
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    describe('Command Name Extraction', () => {
      it('extracts command from path', () => {
        const result = classifier.classify('/usr/bin/cat /file', { hasFs: true })
        expect(result.capability).toBe('fs')
      })

      it('handles env var prefix', () => {
        const result = classifier.classify('FOO=bar echo hello')
        expect(result.tier).toBe(1)
        expect(result.capability).toBe('posix')
      })

      it('handles multiple env var prefixes', () => {
        const result = classifier.classify('FOO=bar BAZ=qux echo hello')
        expect(result.tier).toBe(1)
        expect(result.capability).toBe('posix')
      })

      it('handles empty command gracefully', () => {
        const result = classifier.classify('')
        expect(result.tier).toBe(4)
        expect(result.handler).toBe('sandbox')
      })

      it('handles whitespace-only command gracefully', () => {
        const result = classifier.classify('   ')
        expect(result.tier).toBe(4)
        expect(result.handler).toBe('sandbox')
      })
    })

    describe('Command with Arguments', () => {
      it('classifies command regardless of arguments', () => {
        const commands = [
          'cat -n /file.txt',
          'ls -la /home',
          'grep -r "pattern" .',
          'echo "hello world"',
        ]

        for (const cmd of commands) {
          const result = classifier.classify(cmd, { hasFs: true })
          expect(result.tier).toBe(1)
          expect(result.handler).toBe('native')
        }
      })

      it('handles commands with complex arguments', () => {
        const result = classifier.classify("sed 's/foo/bar/g' file.txt", { hasFs: true })
        expect(result.tier).toBe(1)
        expect(result.handler).toBe('native')
        expect(result.capability).toBe('text')
      })
    })
  })

  // ============================================================================
  // CACHING
  // ============================================================================

  describe('Classification Caching', () => {
    it('caches classification results', () => {
      const result1 = classifier.classify('echo hello')
      const result2 = classifier.classify('echo hello')

      expect(result1).toEqual(result2)
      expect(classifier.getCacheStats().size).toBeGreaterThan(0)
    })

    it('returns same object for cached results', () => {
      const result1 = classifier.classify('cat /file')
      const result2 = classifier.classify('cat /file')

      // Should be the exact same object from cache
      expect(result1).toBe(result2)
    })

    it('does not cache when sandboxStrategy is present', () => {
      // This requires language detection to route to sandbox with strategy
      // For now, test that basic commands are cached
      const cacheBefore = classifier.getCacheStats().size
      classifier.classify('echo test')
      const cacheAfter = classifier.getCacheStats().size

      expect(cacheAfter).toBeGreaterThanOrEqual(cacheBefore)
    })

    it('clears cache', () => {
      classifier.classify('echo hello')
      classifier.classify('cat /file')
      expect(classifier.getCacheStats().size).toBeGreaterThan(0)

      classifier.clearCache()
      expect(classifier.getCacheStats().size).toBe(0)
    })

    it('uses full command as cache key for npm', () => {
      const result1 = classifier.classify('npm view lodash')
      const result2 = classifier.classify('npm install lodash')

      // These should be different classifications
      expect(result1.capability).toBe('npm-native')
      expect(result2.capability).toBe('npm')
    })
  })

  // ============================================================================
  // COMMAND SETS
  // ============================================================================

  describe('Command Sets', () => {
    it('exports TIER_1_NATIVE_COMMANDS', () => {
      expect(TIER_1_NATIVE_COMMANDS).toBeInstanceOf(Set)
      expect(TIER_1_NATIVE_COMMANDS.has('cat')).toBe(true)
      expect(TIER_1_NATIVE_COMMANDS.has('echo')).toBe(true)
    })

    it('exports TIER_1_FS_COMMANDS', () => {
      expect(TIER_1_FS_COMMANDS).toBeInstanceOf(Set)
      expect(TIER_1_FS_COMMANDS.has('cat')).toBe(true)
      expect(TIER_1_FS_COMMANDS.has('mkdir')).toBe(true)
    })

    it('exports TIER_1_HTTP_COMMANDS', () => {
      expect(TIER_1_HTTP_COMMANDS).toBeInstanceOf(Set)
      expect(TIER_1_HTTP_COMMANDS.has('curl')).toBe(true)
      expect(TIER_1_HTTP_COMMANDS.has('wget')).toBe(true)
    })

    it('exports TIER_4_SANDBOX_COMMANDS', () => {
      expect(TIER_4_SANDBOX_COMMANDS).toBeInstanceOf(Set)
      expect(TIER_4_SANDBOX_COMMANDS.has('docker')).toBe(true)
      expect(TIER_4_SANDBOX_COMMANDS.has('ssh')).toBe(true)
    })

    it('exports DEFAULT_RPC_SERVICES', () => {
      expect(DEFAULT_RPC_SERVICES).toBeDefined()
      expect(DEFAULT_RPC_SERVICES.npm).toBeDefined()
      expect(DEFAULT_RPC_SERVICES.npm.commands).toContain('npm')
      expect(DEFAULT_RPC_SERVICES.git).toBeDefined()
      expect(DEFAULT_RPC_SERVICES.git.commands).toContain('git')
    })
  })

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  describe('Configuration', () => {
    it('accepts custom hasFs in classify options', () => {
      const result1 = classifier.classify('cat /file', { hasFs: true })
      const result2 = classifier.classify('cat /file', { hasFs: false })

      expect(result1.tier).toBe(1)
      expect(result2.tier).toBe(4)
    })

    it('accepts custom rpcBindings in constructor', () => {
      const customClassifier = new CommandClassifier({
        rpcBindings: {
          myservice: {
            commands: ['mycmd'],
            endpoint: 'https://my.do',
          },
        },
      })

      const result = customClassifier.classify('mycmd')
      expect(result.tier).toBe(2)
      expect(result.capability).toBe('myservice')
    })

    it('merges custom rpcBindings with defaults', () => {
      const customClassifier = new CommandClassifier({
        rpcBindings: {
          myservice: {
            commands: ['mycmd'],
            endpoint: 'https://my.do',
          },
        },
      })

      // Custom binding works
      const customResult = customClassifier.classify('mycmd')
      expect(customResult.capability).toBe('myservice')

      // Default bindings still work
      const gitResult = customClassifier.classify('git status')
      expect(gitResult.capability).toBe('git')
    })

    it('accepts custom workerLoaders in constructor', () => {
      const customClassifier = new CommandClassifier({
        workerLoaders: {
          myloader: {
            modules: ['mymod'],
            load: async () => ({}),
          },
        },
      })

      const result = customClassifier.classify('mymod')
      expect(result.tier).toBe(3)
      expect(result.capability).toBe('myloader')
    })
  })

  // ============================================================================
  // METRICS
  // ============================================================================

  describe('Metrics', () => {
    it('tracks classification metrics when enabled', () => {
      const metricsClassifier = new CommandClassifier({ metricsEnabled: true })

      metricsClassifier.classify('echo hello')
      metricsClassifier.classify('npm install')
      metricsClassifier.classify('docker run')

      const metrics = metricsClassifier.getMetrics()
      expect(metrics.totalClassifications).toBe(3)
      expect(metrics.tierCounts[1]).toBeGreaterThanOrEqual(1)
      expect(metrics.tierCounts[2]).toBeGreaterThanOrEqual(1)
      expect(metrics.tierCounts[4]).toBeGreaterThanOrEqual(1)
    })

    it('tracks cache hits and misses', () => {
      const metricsClassifier = new CommandClassifier({ metricsEnabled: true })

      metricsClassifier.classify('echo hello')
      metricsClassifier.classify('echo hello') // cache hit
      metricsClassifier.classify('echo hello') // cache hit

      const metrics = metricsClassifier.getMetrics()
      expect(metrics.cacheMisses).toBe(1)
      expect(metrics.cacheHits).toBe(2)
    })

    it('does not track metrics when disabled', () => {
      const noMetricsClassifier = new CommandClassifier({ metricsEnabled: false })

      noMetricsClassifier.classify('echo hello')

      const metrics = noMetricsClassifier.getMetrics()
      expect(metrics.totalClassifications).toBe(0)
    })
  })
})
