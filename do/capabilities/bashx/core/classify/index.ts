/**
 * Input Classification Module
 *
 * Classifies input as either a bash command or natural language intent.
 * This is a critical component for AI-enhanced bash execution.
 *
 * @packageDocumentation
 */

/**
 * Alternative interpretation for ambiguous inputs
 */
export interface ClassificationAlternative {
  type: 'command' | 'intent'
  interpretation: string
}

/**
 * Result of classifying user input.
 */
export interface InputClassification {
  /**
   * Type of input detected:
   * - 'command': Valid bash command syntax
   * - 'intent': Natural language request
   * - 'invalid': Empty or invalid input
   */
  type: 'command' | 'intent' | 'invalid'

  /**
   * Confidence score between 0 and 1.
   * Higher values indicate more certainty in the classification.
   */
  confidence: number

  /**
   * The original input (trimmed)
   */
  input: string

  /**
   * Human-readable explanation of the classification decision
   */
  reason: string

  /**
   * Whether the input is ambiguous (could be either command or intent)
   */
  ambiguous: boolean

  /**
   * For intent type: suggested bash command to execute
   */
  suggestedCommand?: string

  /**
   * For ambiguous inputs: alternative interpretations
   */
  alternatives?: ClassificationAlternative[]
}

/**
 * Common bash commands and builtins for detection
 */
const BASH_COMMANDS = new Set([
  // Filesystem
  'ls', 'cd', 'pwd', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'cat', 'head', 'tail',
  'less', 'more', 'find', 'locate', 'du', 'df', 'ln', 'chmod', 'chown', 'chgrp', 'dd',
  // Text processing
  'grep', 'awk', 'sed', 'sort', 'uniq', 'wc', 'cut', 'tr', 'diff', 'comm',
  // System
  'ps', 'top', 'kill', 'killall', 'bg', 'fg', 'jobs', 'nohup', 'nice', 'time',
  'date', 'cal', 'uptime', 'whoami', 'who', 'w', 'id', 'groups', 'uname',
  // Network
  'ping', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'nc', 'netstat', 'ifconfig', 'ip',
  // Package managers
  'npm', 'npx', 'yarn', 'pnpm', 'pip', 'pip3', 'brew', 'apt', 'apt-get', 'yum', 'dnf',
  // Development
  'git', 'make', 'cmake', 'gcc', 'g++', 'clang', 'rustc', 'cargo', 'go', 'python', 'python3',
  'node', 'deno', 'bun', 'ruby', 'perl', 'java', 'javac',
  // Containers
  'docker', 'docker-compose', 'podman', 'kubectl', 'helm',
  // Shells/Builtins
  'echo', 'printf', 'read', 'export', 'source', 'alias', 'unalias', 'type', 'which',
  'test', 'true', 'false', 'exit', 'return', 'break', 'continue', 'eval', 'exec',
  'set', 'unset', 'shift', 'trap', 'wait', 'history', 'fc',
  // Archive
  'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'bzip2', 'xz',
  // Misc
  'man', 'info', 'help', 'clear', 'reset', 'tee', 'xargs', 'env', 'printenv', 'sleep',
])

/**
 * Words that strongly indicate natural language (not commands)
 */
const NATURAL_LANGUAGE_INDICATORS = [
  // Questions
  'how', 'what', 'which', 'where', 'when', 'why', 'who', 'whom', 'whose',
  // Polite phrases
  'please', 'could', 'would', 'can', 'may', 'might', 'should',
  // Pronouns and articles
  'the', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their',
  'me', 'you', 'him', 'her', 'them', 'us',
  // Verbs indicating intent
  'want', 'need', 'wish', 'like', 'prefer', 'help',
  // Conversational
  'show', 'display', 'give', 'tell', 'explain', 'describe',
  // Action descriptors
  'all', 'every', 'each', 'some', 'any', 'most', 'few',
  // Prepositions in conversational context
  'about', 'using', 'with', 'without', 'into', 'onto', 'through',
  // Conjunctions
  'and', 'but', 'because', 'since', 'although', 'however',
  // Foreign common words
  'les', 'fichiers', 'afficher', 'montrer', 'voir',
]

/**
 * Bash shell syntax patterns
 */
const BASH_SYNTAX_PATTERNS = [
  /\|/,                      // Pipe
  /[<>]/,                    // Redirects
  /&&/,                      // AND
  /\|\|/,                    // OR
  /;/,                       // Command separator
  /^\s*for\s+\w+\s+in\b/m,   // for loop
  /^\s*while\s+/m,           // while loop
  /^\s*if\s+/m,              // if statement
  /^\s*case\s+/m,            // case statement
  /<<\s*\w+/,                // Here-doc
  /\$\(/,                    // Command substitution
  /\$\{/,                    // Variable expansion
  /\$\w+/,                   // Variable reference
  /"[^"]*"/,                 // Double-quoted string
  /'[^']*'/,                 // Single-quoted string
  /`[^`]*`/,                 // Backtick substitution
]

/**
 * Flag patterns common in commands
 */
const FLAG_PATTERN = /\s+-{1,2}[a-zA-Z][\w-]*(=\S+)?/

/**
 * Check if input looks like a bash command
 */
function hasCommandSyntax(input: string): boolean {
  // Check for common bash syntax
  for (const pattern of BASH_SYNTAX_PATTERNS) {
    if (pattern.test(input)) {
      return true
    }
  }
  // Check for flags
  if (FLAG_PATTERN.test(input)) {
    return true
  }
  return false
}

/**
 * Check if input contains natural language indicators
 */
function countNaturalLanguageIndicators(input: string): number {
  const words = input.toLowerCase().split(/\s+/)
  let count = 0
  for (const word of words) {
    if (NATURAL_LANGUAGE_INDICATORS.includes(word.replace(/[?.,!]/g, ''))) {
      count++
    }
  }
  return count
}

/**
 * Check if input starts with a known command
 */
function startsWithCommand(input: string): string | null {
  const firstWord = input.split(/\s+/)[0]?.toLowerCase()
  if (firstWord && BASH_COMMANDS.has(firstWord)) {
    return firstWord
  }
  return null
}

/**
 * Detect if input is a question
 */
function isQuestion(input: string): boolean {
  const questionWords = ['how', 'what', 'which', 'where', 'when', 'why', 'who']
  const firstWord = input.toLowerCase().split(/\s+/)[0]?.replace(/[?.,!]/g, '')
  return questionWords.includes(firstWord || '') || input.trim().endsWith('?')
}

/**
 * Detect conversational patterns
 */
function isConversational(input: string): boolean {
  const patterns = [
    /^i\s+(want|need|would like|wish)\s+/i,
    /^(please|could you|would you|can you|may i|can i|help me)\b/i,
    /\bplease\b/i,
    /^(show|display|give|tell)\s+me\b/i,
  ]
  return patterns.some(p => p.test(input))
}

/**
 * Check if single word is ambiguous
 */
function isSingleWordAmbiguous(word: string): boolean {
  const ambiguousSingleWords = new Set([
    'ls', 'list', 'status', 'history', 'test', 'exit', 'pwd', 'cd', 'help',
    'make', 'find', 'cat', 'which', 'type', 'time', 'clear', 'diff',
  ])
  return ambiguousSingleWords.has(word.toLowerCase())
}

/**
 * Suggest a command for natural language intents
 */
function suggestCommand(input: string): string | undefined {
  const lower = input.toLowerCase()

  if (/list\s+(all\s+)?files|show\s+(me\s+)?(all\s+)?files|afficher\s+les\s+fichiers/i.test(lower)) {
    return 'ls -la'
  }
  if (/git\s+history|show\s+(me\s+)?the\s+git\s+history/i.test(lower)) {
    return 'git log'
  }
  if (/disk\s+space|check\s+disk/i.test(lower)) {
    return 'df -h'
  }
  if (/current\s+directory|what\s+is\s+the\s+current\s+directory/i.test(lower)) {
    return 'pwd'
  }
  if (/memory\s+usage/i.test(lower)) {
    return 'free -h'
  }
  if (/(list\s+)?(all\s+)?branches/i.test(lower)) {
    return 'git branch -a'
  }

  return undefined
}

/**
 * Classify input as command or natural language intent.
 *
 * @param input - The user input to classify
 * @returns Classification result with type, confidence, and metadata
 *
 * @example
 * ```typescript
 * const result = await classifyInput('ls -la')
 * // { type: 'command', confidence: 0.95, ... }
 *
 * const result = await classifyInput('show me all files')
 * // { type: 'intent', confidence: 0.9, suggestedCommand: 'ls -la', ... }
 * ```
 */
export async function classifyInput(input: string): Promise<InputClassification> {
  const trimmed = input.trim()

  // Handle empty/whitespace input
  if (!trimmed) {
    return {
      type: 'invalid',
      confidence: 1,
      input: trimmed,
      reason: 'Empty or whitespace-only input',
      ambiguous: false,
    }
  }

  const words = trimmed.split(/\s+/)
  const wordCount = words.length
  const firstCommand = startsWithCommand(trimmed)
  const hasShellSyntax = hasCommandSyntax(trimmed)
  const nlIndicatorCount = countNaturalLanguageIndicators(trimmed)
  const questionLike = isQuestion(trimmed)
  const conversational = isConversational(trimmed)

  // Check for multiline scripts (for loops, while, if, here-doc)
  const isMultiline = trimmed.includes('\n')
  const isScript = /^\s*(for|while|if|case)\b/m.test(trimmed) || /<<\s*\w+/.test(trimmed)

  // Strong command indicators
  if (isScript || (isMultiline && firstCommand)) {
    return {
      type: 'command',
      confidence: 0.95,
      input: trimmed,
      reason: 'Multi-line bash script or control structure detected',
      ambiguous: false,
    }
  }

  // Strong intent indicators: questions and conversational patterns
  if (questionLike || conversational) {
    const suggested = suggestCommand(trimmed)
    return {
      type: 'intent',
      confidence: nlIndicatorCount >= 2 ? 0.9 : 0.85,
      input: trimmed,
      reason: questionLike
        ? 'Question-like input detected'
        : 'Conversational pattern detected',
      ambiguous: false,
      suggestedCommand: suggested,
    }
  }

  // Single word handling
  if (wordCount === 1) {
    const word = trimmed.toLowerCase()
    const isKnownCommand = BASH_COMMANDS.has(word)
    const isAmbiguous = isSingleWordAmbiguous(word)

    if (isAmbiguous) {
      // pwd is more command-like than list
      const isPureCommand = ['pwd', 'cd', 'ls', 'cat', 'echo', 'date', 'cal', 'uptime', 'whoami'].includes(word)
      const confidence = isPureCommand ? 0.7 : 0.5
      const type = isKnownCommand ? 'command' : 'intent'

      return {
        type,
        confidence,
        input: trimmed,
        reason: `Single word "${word}" could be interpreted as ${isKnownCommand ? 'command or' : ''} natural language`,
        ambiguous: true,
        alternatives: [
          { type: 'command', interpretation: `${word} (if command exists)` },
          { type: 'intent', interpretation: isKnownCommand ? `Execute ${word} command` : `${word} files or items` },
        ],
      }
    }

    // Known command but not ambiguous (less common single-word commands)
    if (isKnownCommand) {
      return {
        type: 'command',
        confidence: 0.75,
        input: trimmed,
        reason: `"${word}" is a known bash command`,
        ambiguous: true,
        alternatives: [
          { type: 'command', interpretation: `${word} command` },
          { type: 'intent', interpretation: `Action related to ${word}` },
        ],
      }
    }

    // Unknown single word - likely intent
    return {
      type: 'intent',
      confidence: 0.6,
      input: trimmed,
      reason: `Single word "${word}" interpreted as natural language`,
      ambiguous: true,
      alternatives: [
        { type: 'command', interpretation: `${word} (if command exists)` },
        { type: 'intent', interpretation: `Natural language request` },
      ],
    }
  }

  // Multi-word with clear command syntax (pipes, flags, redirects)
  if (hasShellSyntax) {
    return {
      type: 'command',
      confidence: 0.95,
      input: trimmed,
      reason: 'Contains bash syntax elements (pipes, redirects, flags, or shell constructs)',
      ambiguous: false,
    }
  }

  // Starts with known command and has arguments
  if (firstCommand && wordCount >= 2) {
    // Check if rest looks like natural language
    const restOfInput = words.slice(1).join(' ')
    const restNlCount = countNaturalLanguageIndicators(restOfInput)

    // "cat the config file please" - command word but natural language
    if (restNlCount >= 2 || /\b(the|a|an|please|all)\b/i.test(restOfInput)) {
      const suggested = suggestCommand(trimmed)
      return {
        type: 'intent',
        confidence: 0.8,
        input: trimmed,
        reason: `Starts with command "${firstCommand}" but rest appears to be natural language`,
        ambiguous: false,
        suggestedCommand: suggested,
      }
    }

    // Check if arguments look like natural language rather than command args
    const naturalLanguageArgs = /\b(large|big|small|old|new|recent|latest|oldest|newest|empty|hidden|modified|changed|created|deleted)\b/i
    const looksLikePath = /^[.~\/]|\/|\.[a-z]+$/i
    const restWords = words.slice(1)
    const hasNaturalArgs = naturalLanguageArgs.test(restOfInput)
    const hasPathLikeArgs = restWords.some(w => looksLikePath.test(w) || w.startsWith('-'))

    if (hasNaturalArgs && !hasPathLikeArgs) {
      const suggested = suggestCommand(trimmed)
      return {
        type: 'intent',
        confidence: 0.85,
        input: trimmed,
        reason: `Starts with command "${firstCommand}" but arguments appear to be natural language`,
        ambiguous: false,
        suggestedCommand: suggested,
      }
    }

    // Looks like a proper command
    return {
      type: 'command',
      confidence: 0.95,
      input: trimmed,
      reason: `Valid command "${firstCommand}" with arguments`,
      ambiguous: false,
    }
  }

  // High natural language indicator count
  if (nlIndicatorCount >= 2) {
    const suggested = suggestCommand(trimmed)
    return {
      type: 'intent',
      confidence: 0.85,
      input: trimmed,
      reason: 'Multiple natural language indicators detected',
      ambiguous: false,
      suggestedCommand: suggested,
    }
  }

  // Default: looks like natural language if no command patterns found
  if (!firstCommand && wordCount >= 2) {
    const suggested = suggestCommand(trimmed)
    return {
      type: 'intent',
      confidence: 0.8,
      input: trimmed,
      reason: 'Multi-word input without command syntax',
      ambiguous: false,
      suggestedCommand: suggested,
    }
  }

  // Fallback for edge cases
  return {
    type: 'intent',
    confidence: 0.6,
    input: trimmed,
    reason: 'Unable to determine type with high confidence',
    ambiguous: true,
    alternatives: [
      { type: 'command', interpretation: 'Possible command' },
      { type: 'intent', interpretation: 'Natural language request' },
    ],
  }
}
