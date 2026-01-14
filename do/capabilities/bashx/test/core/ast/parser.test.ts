/**
 * Comprehensive AST Parser Tests
 *
 * Tests for bash AST parsing covering all major syntactic constructs.
 * These tests verify the parser correctly converts bash commands into AST nodes.
 */

import { describe, it, expect } from 'vitest'
import { parse, isValidSyntax } from '../../../src/ast/parser.js'
import type {
  Program,
  Command,
  Pipeline,
  List,
  CompoundCommand,
  Subshell,
  FunctionDef,
  Word,
  Redirect,
  Assignment,
} from '../../../src/types.js'

// ============================================================================
// Simple Commands
// ============================================================================

describe('Simple Commands', () => {
  it('should parse: echo hello', () => {
    const ast = parse('echo hello')
    expect(ast.type).toBe('Program')
    expect(ast.body).toHaveLength(1)

    const cmd = ast.body[0] as Command
    expect(cmd.type).toBe('Command')
    expect(cmd.name?.value).toBe('echo')
    expect(cmd.args).toHaveLength(1)
    expect(cmd.args[0].value).toBe('hello')
  })

  it('should parse: ls -la', () => {
    const ast = parse('ls -la')
    expect(ast.body).toHaveLength(1)

    const cmd = ast.body[0] as Command
    expect(cmd.name?.value).toBe('ls')
    expect(cmd.args).toHaveLength(1)
    expect(cmd.args[0].value).toBe('-la')
  })

  it('should parse: cat file.txt', () => {
    const ast = parse('cat file.txt')
    const cmd = ast.body[0] as Command
    expect(cmd.name?.value).toBe('cat')
    expect(cmd.args[0].value).toBe('file.txt')
  })

  it('should parse: git status --short', () => {
    const ast = parse('git status --short')
    const cmd = ast.body[0] as Command
    expect(cmd.name?.value).toBe('git')
    expect(cmd.args).toHaveLength(2)
    expect(cmd.args[0].value).toBe('status')
    expect(cmd.args[1].value).toBe('--short')
  })

  it('should parse: find . -name "*.ts" -type f', () => {
    const ast = parse('find . -name "*.ts" -type f')
    const cmd = ast.body[0] as Command
    expect(cmd.name?.value).toBe('find')
    expect(cmd.args.length).toBeGreaterThanOrEqual(4)
  })

  it('should parse command with no arguments: pwd', () => {
    const ast = parse('pwd')
    const cmd = ast.body[0] as Command
    expect(cmd.name?.value).toBe('pwd')
    expect(cmd.args).toHaveLength(0)
  })

  it('should parse command with many arguments: cp -r src dest --verbose', () => {
    const ast = parse('cp -r src dest --verbose')
    const cmd = ast.body[0] as Command
    expect(cmd.name?.value).toBe('cp')
    expect(cmd.args).toHaveLength(4)
  })
})

// ============================================================================
// Pipelines
// ============================================================================

describe('Pipelines', () => {
  it('should parse two-command pipeline: cmd1 | cmd2', () => {
    const ast = parse('ls | grep foo')
    expect(ast.body).toHaveLength(1)

    const pipeline = ast.body[0] as Pipeline
    expect(pipeline.type).toBe('Pipeline')
    expect(pipeline.commands).toHaveLength(2)
    expect(pipeline.commands[0].name?.value).toBe('ls')
    expect(pipeline.commands[1].name?.value).toBe('grep')
  })

  it('should parse three-command pipeline: cmd1 | cmd2 | cmd3', () => {
    const ast = parse('cat file.txt | grep pattern | wc -l')
    const pipeline = ast.body[0] as Pipeline
    expect(pipeline.type).toBe('Pipeline')
    expect(pipeline.commands).toHaveLength(3)
    expect(pipeline.commands[0].name?.value).toBe('cat')
    expect(pipeline.commands[1].name?.value).toBe('grep')
    expect(pipeline.commands[2].name?.value).toBe('wc')
  })

  it('should parse long pipeline: ps aux | grep node | awk | sort | head', () => {
    const ast = parse("ps aux | grep node | awk '{print $2}' | sort | head -5")
    const pipeline = ast.body[0] as Pipeline
    expect(pipeline.type).toBe('Pipeline')
    expect(pipeline.commands).toHaveLength(5)
  })

  it('should preserve arguments in pipeline commands', () => {
    const ast = parse('find . -name "*.js" | xargs grep -l "import"')
    const pipeline = ast.body[0] as Pipeline
    expect(pipeline.commands[0].args.length).toBeGreaterThan(0)
    expect(pipeline.commands[1].args.length).toBeGreaterThan(0)
  })

  it('should handle negated pipeline: ! cmd | cmd2', () => {
    // Note: The parser may not support this yet - test should fail
    const ast = parse('! grep error file.txt | head')
    const pipeline = ast.body[0] as Pipeline
    expect(pipeline.negated).toBe(true)
  })
})

// ============================================================================
// Redirections
// ============================================================================

describe('Redirections', () => {
  describe('Output redirects', () => {
    it('should parse output redirect: echo hello > file.txt', () => {
      const ast = parse('echo hello > file.txt')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].op).toBe('>')
      expect(cmd.redirects[0].target.value).toBe('file.txt')
    })

    it('should parse append redirect: echo more >> log.txt', () => {
      const ast = parse('echo more >> log.txt')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].op).toBe('>>')
      expect(cmd.redirects[0].target.value).toBe('log.txt')
    })
  })

  describe('Input redirects', () => {
    it('should parse input redirect: wc -l < input.txt', () => {
      const ast = parse('wc -l < input.txt')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].op).toBe('<')
      expect(cmd.redirects[0].target.value).toBe('input.txt')
    })
  })

  describe('File descriptor redirects', () => {
    it('should parse stderr redirect: cmd 2>&1', () => {
      const ast = parse('cmd 2>&1')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].op).toBe('>&')
      expect(cmd.redirects[0].fd).toBe(2)
      expect(cmd.redirects[0].target.value).toBe('1')
    })

    it('should parse stderr to file: cmd 2> error.log', () => {
      const ast = parse('cmd 2> error.log')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].fd).toBe(2)
      expect(cmd.redirects[0].target.value).toBe('error.log')
    })

    it('should parse combined redirect: cmd &> output.txt', () => {
      const ast = parse('cmd &> output.txt')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(1)
      // &> should redirect both stdout and stderr
    })

    it('should parse redirect both: cmd > out.txt 2>&1', () => {
      const ast = parse('cmd > out.txt 2>&1')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(2)
    })
  })

  describe('Multiple redirects', () => {
    it('should parse input and output: cmd < in.txt > out.txt', () => {
      const ast = parse('cmd < in.txt > out.txt')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(2)
    })

    it('should parse complex redirect: cmd < in 1> out 2> err', () => {
      const ast = parse('cmd < in 1> out 2> err')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(3)
    })
  })

  describe('Here documents', () => {
    it('should parse heredoc: cat << EOF', () => {
      const ast = parse('cat << EOF\nhello\nEOF')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].op).toBe('<<')
    })

    it('should parse herestring: cmd <<< "string"', () => {
      const ast = parse('cmd <<< "hello"')
      const cmd = ast.body[0] as Command
      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].op).toBe('<<<')
    })
  })
})

// ============================================================================
// Command Substitution
// ============================================================================

describe('Command Substitution', () => {
  it('should parse $() command substitution: echo $(pwd)', () => {
    const ast = parse('echo $(pwd)')
    const cmd = ast.body[0] as Command
    expect(cmd.args).toHaveLength(1)
    expect(cmd.args[0].value).toContain('$(pwd)')
  })

  it('should parse nested $() substitution: echo $(cat $(find . -name x))', () => {
    const ast = parse('echo $(cat $(find . -name x))')
    const cmd = ast.body[0] as Command
    expect(cmd.args[0].value).toContain('$(')
    expect(isValidSyntax('echo $(cat $(find . -name x))')).toBe(true)
  })

  it('should parse backtick substitution: echo `pwd`', () => {
    const ast = parse('echo `pwd`')
    const cmd = ast.body[0] as Command
    expect(cmd.args[0].value).toContain('`pwd`')
  })

  it('should parse backtick with nested: echo `cat \\`find .\\``', () => {
    const input = 'echo `cat \\`find .\\``'
    const ast = parse(input)
    expect(ast.errors).toBeUndefined()
  })

  it('should detect unclosed command substitution: echo $(pwd', () => {
    const ast = parse('echo $(pwd')
    expect(ast.errors).toBeDefined()
    expect(ast.errors!.length).toBeGreaterThan(0)
  })

  it('should detect unclosed backtick: echo `pwd', () => {
    const ast = parse('echo `pwd')
    expect(ast.errors).toBeDefined()
    expect(ast.errors!.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Variable Expansion
// ============================================================================

describe('Variable Expansion', () => {
  describe('Simple variables', () => {
    it('should parse $VAR', () => {
      const ast = parse('echo $HOME')
      const cmd = ast.body[0] as Command
      expect(cmd.args[0].value).toBe('$HOME')
    })

    it('should parse multiple variables: echo $FOO $BAR', () => {
      const ast = parse('echo $FOO $BAR')
      const cmd = ast.body[0] as Command
      expect(cmd.args).toHaveLength(2)
    })
  })

  describe('Braced variables', () => {
    it('should parse ${VAR}', () => {
      const ast = parse('echo ${HOME}')
      const cmd = ast.body[0] as Command
      expect(cmd.args[0].value).toContain('${HOME}')
    })

    it('should parse ${VAR:-default}', () => {
      const ast = parse('echo ${FOO:-default}')
      const cmd = ast.body[0] as Command
      expect(cmd.args[0].value).toContain('${FOO:-default}')
    })

    it('should parse ${VAR:=assign}', () => {
      const ast = parse('echo ${FOO:=value}')
      expect(isValidSyntax('echo ${FOO:=value}')).toBe(true)
    })

    it('should parse ${VAR:+alternate}', () => {
      const ast = parse('echo ${FOO:+set}')
      expect(isValidSyntax('echo ${FOO:+set}')).toBe(true)
    })

    it('should parse ${VAR:?error}', () => {
      const ast = parse('echo ${FOO:?not set}')
      expect(isValidSyntax('echo ${FOO:?not set}')).toBe(true)
    })

    it('should parse ${#VAR} (length)', () => {
      const ast = parse('echo ${#HOME}')
      expect(isValidSyntax('echo ${#HOME}')).toBe(true)
    })

    it('should parse ${VAR%pattern} (suffix removal)', () => {
      const ast = parse('echo ${FILE%.txt}')
      expect(isValidSyntax('echo ${FILE%.txt}')).toBe(true)
    })

    it('should parse ${VAR#pattern} (prefix removal)', () => {
      const ast = parse('echo ${PATH#*:}')
      expect(isValidSyntax('echo ${PATH#*:}')).toBe(true)
    })

    it('should parse ${VAR//old/new} (substitution)', () => {
      const ast = parse('echo ${STR//foo/bar}')
      expect(isValidSyntax('echo ${STR//foo/bar}')).toBe(true)
    })
  })

  describe('Special variables', () => {
    it('should parse $?', () => {
      const ast = parse('echo $?')
      const cmd = ast.body[0] as Command
      expect(cmd.args[0].value).toBe('$?')
    })

    it('should parse $$ (pid)', () => {
      const ast = parse('echo $$')
      expect(isValidSyntax('echo $$')).toBe(true)
    })

    it('should parse $@ and $*', () => {
      expect(isValidSyntax('echo $@')).toBe(true)
      expect(isValidSyntax('echo $*')).toBe(true)
    })

    it('should parse $1 $2 (positional)', () => {
      expect(isValidSyntax('echo $1 $2')).toBe(true)
    })
  })

  describe('Arithmetic expansion', () => {
    it('should parse $((expr))', () => {
      const ast = parse('echo $((1 + 2))')
      expect(isValidSyntax('echo $((1 + 2))')).toBe(true)
    })

    it('should parse complex arithmetic: $((a * b + c))', () => {
      const ast = parse('echo $((x * y + z))')
      expect(isValidSyntax('echo $((x * y + z))')).toBe(true)
    })

    it('should detect unclosed arithmetic: echo $((1 + 2)', () => {
      const ast = parse('echo $((1 + 2)')
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.length).toBeGreaterThan(0)
    })
  })

  describe('Variable errors', () => {
    it('should detect unclosed brace: echo ${FOO', () => {
      const ast = parse('echo ${FOO')
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Conditionals
// ============================================================================

describe('Conditionals', () => {
  describe('If statements', () => {
    it('should parse: if cmd; then cmd; fi', () => {
      const ast = parse('if true; then echo yes; fi')
      const compound = ast.body[0] as CompoundCommand
      expect(compound.type).toBe('CompoundCommand')
      expect(compound.kind).toBe('if')
    })

    it('should parse: if cmd; then cmd; else cmd; fi', () => {
      const ast = parse('if test -f file; then cat file; else echo missing; fi')
      const compound = ast.body[0] as CompoundCommand
      expect(compound.kind).toBe('if')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse: if cmd; then cmd; elif cmd; then cmd; else cmd; fi', () => {
      const input = 'if test -f a; then echo a; elif test -f b; then echo b; else echo none; fi'
      const ast = parse(input)
      expect(ast.errors).toBeUndefined()
      const compound = ast.body[0] as CompoundCommand
      expect(compound.kind).toBe('if')
    })

    it('should parse multiline if statement', () => {
      const input = `if test -f file
then
  echo exists
else
  echo missing
fi`
      const ast = parse(input)
      expect(ast.errors).toBeUndefined()
    })
  })

  describe('Test brackets [[ ]]', () => {
    it('should parse: [[ -f file ]]', () => {
      const ast = parse('[[ -f file.txt ]]')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse: [[ $a == $b ]]', () => {
      const ast = parse('[[ $a == $b ]]')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse: [[ -z "$str" ]]', () => {
      const ast = parse('[[ -z "$str" ]]')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse: [[ $a =~ regex ]]', () => {
      const ast = parse('[[ $str =~ ^[0-9]+$ ]]')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse: [[ condition && condition ]]', () => {
      const ast = parse('[[ -f file && -r file ]]')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse: [[ condition || condition ]]', () => {
      const ast = parse('[[ -f file || -d file ]]')
      expect(ast.errors).toBeUndefined()
    })

    it('should detect unclosed [[: [[ -f file', () => {
      const ast = parse('[[ -f file')
      expect(ast.errors).toBeDefined()
    })
  })

  describe('Test brackets [ ]', () => {
    it('should parse: [ -f file ]', () => {
      const ast = parse('[ -f file.txt ]')
      expect(ast.errors).toBeUndefined()
      const cmd = ast.body[0] as Command
      expect(cmd.name?.value).toBe('[')
    })

    it('should parse: [ "$a" = "$b" ]', () => {
      const ast = parse('[ "$a" = "$b" ]')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse: [ -n "$str" ]', () => {
      const ast = parse('[ -n "$str" ]')
      expect(ast.errors).toBeUndefined()
    })

    it('should detect unclosed [: [ -f file', () => {
      const ast = parse('[ -f file')
      expect(ast.errors).toBeDefined()
    })
  })

  describe('Conditional operators', () => {
    it('should parse if with && condition', () => {
      const ast = parse('if test -f a && test -f b; then echo both; fi')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse if with || condition', () => {
      const ast = parse('if test -f a || test -f b; then echo one; fi')
      expect(ast.errors).toBeUndefined()
    })
  })
})

// ============================================================================
// Loops
// ============================================================================

describe('Loops', () => {
  describe('For loops', () => {
    it('should parse: for x in items; do cmd; done', () => {
      const ast = parse('for x in a b c; do echo $x; done')
      const compound = ast.body[0] as CompoundCommand
      expect(compound.type).toBe('CompoundCommand')
      expect(compound.kind).toBe('for')
    })

    it('should parse for loop with glob: for f in *.txt; do cat $f; done', () => {
      const ast = parse('for f in *.txt; do cat $f; done')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse for loop with command substitution', () => {
      const ast = parse('for f in $(ls); do echo $f; done')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse C-style for loop: for ((i=0; i<10; i++)); do echo $i; done', () => {
      const ast = parse('for ((i=0; i<10; i++)); do echo $i; done')
      // This might fail - C-style for is complex
      expect(ast.errors).toBeUndefined()
    })

    it('should parse multiline for loop', () => {
      const input = `for item in list
do
  echo $item
done`
      const ast = parse(input)
      expect(ast.errors).toBeUndefined()
    })
  })

  describe('While loops', () => {
    it('should parse: while cmd; do cmd; done', () => {
      const ast = parse('while true; do echo running; sleep 1; done')
      const compound = ast.body[0] as CompoundCommand
      expect(compound.type).toBe('CompoundCommand')
      expect(compound.kind).toBe('while')
    })

    it('should parse: while read line; do echo $line; done', () => {
      const ast = parse('while read line; do echo $line; done')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse while with test condition', () => {
      const ast = parse('while [ $i -lt 10 ]; do echo $i; i=$((i+1)); done')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse multiline while loop', () => {
      const input = `while true
do
  echo loop
  sleep 1
done`
      const ast = parse(input)
      expect(ast.errors).toBeUndefined()
    })
  })

  describe('Until loops', () => {
    it('should parse: until cmd; do cmd; done', () => {
      const ast = parse('until false; do echo waiting; sleep 1; done')
      const compound = ast.body[0] as CompoundCommand
      expect(compound.type).toBe('CompoundCommand')
      expect(compound.kind).toBe('until')
    })

    it('should parse until with test', () => {
      const ast = parse('until [ $x -eq 10 ]; do x=$((x+1)); done')
      expect(ast.errors).toBeUndefined()
    })
  })

  describe('Loop errors', () => {
    it('should detect missing done: for x in a; do echo $x', () => {
      const ast = parse('for x in a; do echo $x')
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.some(e => e.message.includes('done'))).toBe(true)
    })

    it('should detect missing do: for x in a; echo $x; done', () => {
      const ast = parse('for x in a; echo $x; done')
      expect(ast.errors).toBeDefined()
    })

    it('should detect missing done in while', () => {
      const ast = parse('while true; do echo loop')
      expect(ast.errors).toBeDefined()
    })
  })
})

// ============================================================================
// Functions
// ============================================================================

describe('Functions', () => {
  it('should parse: function name() { body }', () => {
    const ast = parse('function greet() { echo hello; }')
    // May be parsed as FunctionDef or CompoundCommand depending on implementation
    expect(ast.errors).toBeUndefined()
  })

  it('should parse: name() { body }', () => {
    const ast = parse('greet() { echo hello; }')
    expect(ast.errors).toBeUndefined()
  })

  it('should parse function with parameters used', () => {
    const ast = parse('greet() { echo "Hello, $1"; }')
    expect(ast.errors).toBeUndefined()
  })

  it('should parse function with local variables', () => {
    const ast = parse('calc() { local x=1; echo $x; }')
    expect(ast.errors).toBeUndefined()
  })

  it('should parse multiline function', () => {
    const input = `deploy() {
  npm install
  npm run build
  npm run deploy
}`
    const ast = parse(input)
    expect(ast.errors).toBeUndefined()
  })

  it('should parse function with return', () => {
    const ast = parse('check() { test -f file && return 0; return 1; }')
    expect(ast.errors).toBeUndefined()
  })

  it('should detect unclosed function body', () => {
    const ast = parse('greet() { echo hello')
    expect(ast.errors).toBeDefined()
  })
})

// ============================================================================
// Compound Commands
// ============================================================================

describe('Compound Commands', () => {
  describe('Brace groups { }', () => {
    it('should parse: { cmd; }', () => {
      const ast = parse('{ echo hello; }')
      const compound = ast.body[0] as CompoundCommand
      expect(compound.type).toBe('CompoundCommand')
      expect(compound.kind).toBe('brace')
    })

    it('should parse: { cmd1; cmd2; }', () => {
      const ast = parse('{ echo a; echo b; }')
      expect(ast.errors).toBeUndefined()
    })

    it('should detect unclosed brace', () => {
      const ast = parse('{ echo hello')
      expect(ast.errors).toBeDefined()
    })
  })

  describe('Subshells ( )', () => {
    it('should parse: ( cmd )', () => {
      const ast = parse('( echo hello )')
      const subshell = ast.body[0] as Subshell
      expect(subshell.type).toBe('Subshell')
    })

    it('should parse: ( cmd1; cmd2 )', () => {
      const ast = parse('( cd /tmp; ls )')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse nested subshells', () => {
      const ast = parse('( ( echo nested ) )')
      expect(ast.errors).toBeUndefined()
    })

    it('should detect unclosed subshell', () => {
      const ast = parse('( echo hello')
      expect(ast.errors).toBeDefined()
    })
  })

  describe('Case statements', () => {
    it('should parse: case $x in pattern) cmd;; esac', () => {
      const ast = parse('case $x in a) echo a;; esac')
      const compound = ast.body[0] as CompoundCommand
      expect(compound.kind).toBe('case')
    })

    it('should parse case with multiple patterns', () => {
      const input = 'case $x in a|b) echo ab;; c) echo c;; esac'
      const ast = parse(input)
      expect(ast.errors).toBeUndefined()
    })

    it('should parse case with wildcard', () => {
      const ast = parse('case $x in *) echo default;; esac')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse multiline case', () => {
      const input = `case $option in
  -h|--help)
    echo "Help message"
    ;;
  -v|--version)
    echo "1.0.0"
    ;;
  *)
    echo "Unknown option"
    ;;
esac`
      const ast = parse(input)
      expect(ast.errors).toBeUndefined()
    })

    it('should detect missing esac', () => {
      const ast = parse('case $x in a) echo a;;')
      expect(ast.errors).toBeDefined()
    })
  })
})

// ============================================================================
// Lists (AND/OR/Sequential)
// ============================================================================

describe('Lists', () => {
  describe('AND lists (&&)', () => {
    it('should parse: cmd1 && cmd2', () => {
      const ast = parse('mkdir foo && cd foo')
      const list = ast.body[0] as List
      expect(list.type).toBe('List')
      expect(list.operator).toBe('&&')
    })

    it('should parse chained &&: cmd1 && cmd2 && cmd3', () => {
      const ast = parse('test -f file && cat file && echo done')
      expect(ast.errors).toBeUndefined()
    })
  })

  describe('OR lists (||)', () => {
    it('should parse: cmd1 || cmd2', () => {
      const ast = parse('test -f file || touch file')
      const list = ast.body[0] as List
      expect(list.type).toBe('List')
      expect(list.operator).toBe('||')
    })

    it('should parse chained ||: cmd1 || cmd2 || cmd3', () => {
      const ast = parse('cmd1 || cmd2 || cmd3')
      expect(ast.errors).toBeUndefined()
    })
  })

  describe('Sequential lists (;)', () => {
    it('should parse: cmd1; cmd2', () => {
      const ast = parse('echo start; echo end')
      expect(ast.body.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse multiple: cmd1; cmd2; cmd3', () => {
      const ast = parse('echo a; echo b; echo c')
      expect(ast.errors).toBeUndefined()
    })
  })

  describe('Background (&)', () => {
    it('should parse: cmd &', () => {
      const ast = parse('sleep 10 &')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse: cmd1 & cmd2', () => {
      const ast = parse('sleep 10 & echo started')
      expect(ast.errors).toBeUndefined()
    })
  })

  describe('Mixed operators', () => {
    it('should parse: cmd1 && cmd2 || cmd3', () => {
      const ast = parse('test -f file && cat file || echo missing')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse: cmd1; cmd2 && cmd3', () => {
      const ast = parse('cd /tmp; test -d proj && cd proj')
      expect(ast.errors).toBeUndefined()
    })
  })
})

// ============================================================================
// Assignments
// ============================================================================

describe('Assignments', () => {
  it('should parse standalone assignment: VAR=value', () => {
    const ast = parse('FOO=bar')
    const cmd = ast.body[0] as Command
    expect(cmd.prefix).toHaveLength(1)
    expect(cmd.prefix[0].name).toBe('FOO')
    expect(cmd.prefix[0].value?.value).toBe('bar')
  })

  it('should parse assignment with command: VAR=value cmd', () => {
    const ast = parse('PATH=/usr/bin echo $PATH')
    const cmd = ast.body[0] as Command
    expect(cmd.prefix).toHaveLength(1)
    expect(cmd.name?.value).toBe('echo')
  })

  it('should parse multiple assignments: A=1 B=2 cmd', () => {
    const ast = parse('A=1 B=2 env')
    const cmd = ast.body[0] as Command
    expect(cmd.prefix).toHaveLength(2)
  })

  it('should parse append assignment: VAR+=value', () => {
    const ast = parse('PATH+=/usr/local/bin')
    const cmd = ast.body[0] as Command
    expect(cmd.prefix[0].operator).toBe('+=')
  })

  it('should parse assignment with quotes: VAR="value with spaces"', () => {
    const ast = parse('MSG="hello world"')
    expect(ast.errors).toBeUndefined()
  })

  it('should parse assignment with command substitution', () => {
    const ast = parse('DIR=$(pwd)')
    expect(ast.errors).toBeUndefined()
  })

  it('should parse empty assignment: VAR=', () => {
    const ast = parse('EMPTY=')
    const cmd = ast.body[0] as Command
    expect(cmd.prefix[0].value).toBe(null)
  })
})

// ============================================================================
// Quoting
// ============================================================================

describe('Quoting', () => {
  describe('Single quotes', () => {
    it('should parse single-quoted string', () => {
      const ast = parse("echo 'hello world'")
      expect(ast.errors).toBeUndefined()
    })

    it('should preserve literal $ in single quotes', () => {
      const ast = parse("echo '$HOME'")
      const cmd = ast.body[0] as Command
      // In single quotes, $ is literal
      expect(cmd.args[0].value).toContain('$HOME')
    })

    it('should detect unclosed single quote', () => {
      const ast = parse("echo 'unclosed")
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.some(e => e.message.toLowerCase().includes('quote'))).toBe(true)
    })
  })

  describe('Double quotes', () => {
    it('should parse double-quoted string', () => {
      const ast = parse('echo "hello world"')
      expect(ast.errors).toBeUndefined()
    })

    it('should allow variable expansion in double quotes', () => {
      const ast = parse('echo "Hello, $USER"')
      expect(ast.errors).toBeUndefined()
    })

    it('should detect unclosed double quote', () => {
      const ast = parse('echo "unclosed')
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.some(e => e.message.toLowerCase().includes('quote'))).toBe(true)
    })
  })

  describe('Mixed quoting', () => {
    it('should parse mixed quotes: echo "It\'s fine"', () => {
      const ast = parse(`echo "It's fine"`)
      expect(ast.errors).toBeUndefined()
    })

    it('should parse concatenated quotes', () => {
      const ast = parse(`echo 'hello '"world"`)
      expect(ast.errors).toBeUndefined()
    })
  })

  describe('Escape sequences', () => {
    it('should parse escaped characters', () => {
      const ast = parse('echo hello\\ world')
      expect(ast.errors).toBeUndefined()
    })

    it('should parse escaped newline (line continuation)', () => {
      const ast = parse('echo hello \\\nworld')
      expect(ast.errors).toBeUndefined()
    })
  })
})

// ============================================================================
// Error Recovery
// ============================================================================

describe('Error Recovery', () => {
  describe('Incomplete quotes', () => {
    it('should recover from unclosed double quote and provide suggestion', () => {
      const ast = parse('echo "hello')
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.length).toBeGreaterThan(0)
      expect(ast.errors![0].suggestion).toBeDefined()
    })

    it('should recover from unclosed single quote', () => {
      const ast = parse("echo 'hello")
      expect(ast.errors).toBeDefined()
    })
  })

  describe('Missing terminators', () => {
    it('should detect missing fi', () => {
      const ast = parse('if true; then echo yes')
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.some(e => e.message.includes('fi'))).toBe(true)
    })

    it('should detect missing done', () => {
      const ast = parse('for x in a; do echo $x')
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.some(e => e.message.includes('done'))).toBe(true)
    })

    it('should detect missing esac', () => {
      const ast = parse('case $x in a) echo a;;')
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.some(e => e.message.includes('esac'))).toBe(true)
    })

    it('should detect missing then', () => {
      const ast = parse('if true; echo yes; fi')
      expect(ast.errors).toBeDefined()
      expect(ast.errors!.some(e => e.message.includes('then'))).toBe(true)
    })

    it('should detect missing do in for loop', () => {
      const ast = parse('for x in a b c; echo $x; done')
      expect(ast.errors).toBeDefined()
    })
  })

  describe('Unbalanced brackets/braces', () => {
    it('should detect missing )', () => {
      const ast = parse('( echo hello')
      expect(ast.errors).toBeDefined()
    })

    it('should detect missing }', () => {
      const ast = parse('{ echo hello')
      expect(ast.errors).toBeDefined()
    })

    it('should detect missing ]]', () => {
      const ast = parse('[[ -f file')
      expect(ast.errors).toBeDefined()
    })

    it('should detect missing ]', () => {
      const ast = parse('[ -f file')
      expect(ast.errors).toBeDefined()
    })
  })

  describe('Invalid pipe/redirect syntax', () => {
    it('should detect pipe at start: | cmd', () => {
      const ast = parse('| grep foo')
      expect(ast.errors).toBeDefined()
    })

    it('should detect pipe at end: cmd |', () => {
      const ast = parse('ls |')
      expect(ast.errors).toBeDefined()
    })

    it('should detect double pipe: cmd || | cmd2', () => {
      const ast = parse('ls || | grep')
      expect(ast.errors).toBeDefined()
    })

    it('should detect redirect without target: cmd >', () => {
      const ast = parse('echo hello >')
      expect(ast.errors).toBeDefined()
    })

    it('should detect double redirect: cmd > >', () => {
      const ast = parse('echo hello > >')
      expect(ast.errors).toBeDefined()
    })
  })

  describe('Error location', () => {
    it('should provide line and column for errors', () => {
      const ast = parse('echo "unclosed')
      expect(ast.errors).toBeDefined()
      expect(ast.errors![0].line).toBeGreaterThanOrEqual(1)
      expect(ast.errors![0].column).toBeGreaterThanOrEqual(1)
    })

    it('should track multiline error locations', () => {
      const input = `echo hello
echo "unclosed`
      const ast = parse(input)
      expect(ast.errors).toBeDefined()
      expect(ast.errors![0].line).toBe(2)
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should parse empty input', () => {
    const ast = parse('')
    expect(ast.type).toBe('Program')
    expect(ast.body).toHaveLength(0)
    expect(ast.errors).toBeUndefined()
  })

  it('should parse whitespace-only input', () => {
    const ast = parse('   \n\t  ')
    expect(ast.body).toHaveLength(0)
    expect(ast.errors).toBeUndefined()
  })

  it('should parse comment-only input', () => {
    const ast = parse('# this is a comment')
    expect(ast.body).toHaveLength(0)
  })

  it('should parse command with trailing comment', () => {
    const ast = parse('echo hello # comment')
    const cmd = ast.body[0] as Command
    expect(cmd.name?.value).toBe('echo')
  })

  it('should handle very long commands', () => {
    const longArg = 'x'.repeat(10000)
    const ast = parse(`echo ${longArg}`)
    expect(ast.errors).toBeUndefined()
  })

  it('should handle deeply nested structures', () => {
    const ast = parse('( ( ( echo deep ) ) )')
    expect(ast.errors).toBeUndefined()
  })

  it('should handle multiple newlines', () => {
    const ast = parse('echo a\n\n\necho b')
    expect(ast.errors).toBeUndefined()
  })

  it('should handle mixed newlines and semicolons', () => {
    const ast = parse('echo a;\necho b\necho c;')
    expect(ast.errors).toBeUndefined()
  })
})

// ============================================================================
// isValidSyntax Utility
// ============================================================================

describe('isValidSyntax', () => {
  it('should return true for valid commands', () => {
    expect(isValidSyntax('echo hello')).toBe(true)
    expect(isValidSyntax('ls -la | grep foo')).toBe(true)
    expect(isValidSyntax('if true; then echo yes; fi')).toBe(true)
  })

  it('should return false for invalid commands', () => {
    expect(isValidSyntax('echo "unclosed')).toBe(false)
    expect(isValidSyntax('if true; then echo yes')).toBe(false)
    expect(isValidSyntax('for x in a; do echo')).toBe(false)
  })

  it('should return true for empty input', () => {
    expect(isValidSyntax('')).toBe(true)
  })
})
