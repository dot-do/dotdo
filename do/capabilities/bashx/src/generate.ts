/**
 * Command Generation Module
 *
 * Generates bash commands from natural language intents.
 * This is a key capability for AI-enhanced bash execution.
 */

/**
 * Context information to help with command generation
 */
export interface GenerateContext {
  /** Whether the current directory is a git repository */
  isGitRepo?: boolean
  /** Whether package.json exists in the current directory */
  hasPackageJson?: boolean
  /** List of files in the current directory */
  files?: string[]
  /** Type of project (node, rust, python, etc.) */
  projectType?: string
}

/**
 * Options for command generation
 */
export interface GenerateOptions {
  /** Current working directory for context */
  cwd?: string
  /** Target shell (bash, zsh, sh) */
  shell?: 'bash' | 'zsh' | 'sh'
  /** Target platform (linux, darwin, win32) */
  platform?: 'linux' | 'darwin' | 'win32'
  /** Only generate safe commands (no destructive operations) */
  safe?: boolean
  /** Additional context for generation */
  context?: GenerateContext
}

/**
 * Result of command generation
 */
export interface GenerateCommandResult {
  /** Whether generation was successful */
  success: boolean
  /** The generated command */
  command: string
  /** Confidence score between 0 and 1 */
  confidence: number
  /** The original intent */
  intent: string
  /** Human-readable explanation of the command */
  explanation: string
  /** Alternative commands that could satisfy the intent */
  alternatives?: string[]
  /** Whether the intent was ambiguous */
  ambiguous?: boolean
  /** Error message if generation failed */
  error?: string
  /** Warning message for potentially dangerous commands */
  warning?: string
  /** Whether the command is dangerous */
  dangerous?: boolean
  /** Whether the command was blocked for safety */
  blocked?: boolean
  /** Whether the command requires user confirmation */
  requiresConfirmation?: boolean
}

// Pattern definitions for intent matching
interface IntentPattern {
  patterns: RegExp[]
  handler: (
    match: RegExpMatchArray,
    intent: string,
    options?: GenerateOptions
  ) => Partial<GenerateCommandResult>
}

// extractFilename is reserved for future complex filename extraction
// Currently unused as simpler inline extraction is sufficient

/**
 * Quote filename if it contains special characters or spaces
 */
function quoteIfNeeded(filename: string): string {
  if (/[\s$]/.test(filename)) {
    return `'${filename}'`
  }
  return filename
}

// Intent patterns and their handlers
const intentPatterns: IntentPattern[] = [
  // ============================================
  // LIST FILES
  // ============================================
  {
    patterns: [
      /^list\s+files?$/i,
      /^show\s+(?:all\s+)?files?$/i,
      /^ls$/i,
      /^list\s+all\s+files?\s+with\s+details\s+(?:including\s+)?hidden$/i,
      /^list\s+files?\s+with\s+details$/i,
    ],
    handler: () => ({
      command: 'ls -la',
      confidence: 0.95,
      explanation: 'Lists all files including hidden ones with detailed information',
      alternatives: ['ls', 'ls -l', 'ls -a'],
    }),
  },

  // Show hidden files
  {
    patterns: [/^show\s+hidden\s+files?$/i],
    handler: () => ({
      command: 'ls -la',
      confidence: 0.9,
      explanation: 'Lists all files including hidden ones',
      alternatives: ['ls -a', 'ls -lA'],
    }),
  },

  // ============================================
  // CURRENT DIRECTORY
  // ============================================
  {
    patterns: [
      /^show\s+(?:me\s+)?(?:the\s+)?current\s+directory$/i,
      /^where\s+am\s+I$/i,
      /^pwd$/i,
      /^print\s+working\s+directory$/i,
    ],
    handler: () => ({
      command: 'pwd',
      confidence: 0.95,
      explanation: 'Prints the current working directory',
      alternatives: [],
    }),
  },

  // ============================================
  // CAT / READ FILES
  // ============================================
  {
    patterns: [
      /^(?:show\s+)?contents?\s+of\s+(.+)$/i,
      /^cat\s+(.+)$/i,
      /^read\s+(?:the\s+)?(.+)$/i,
    ],
    handler: (match, intent) => {
      let filename = match[1]
      // Handle "the README" -> "README.md"
      if (/^README$/i.test(filename)) {
        filename = 'README.md'
      }
      filename = filename.replace(/^the\s+/i, '')
      // Check for quoted filename
      const quotedMatch = intent.match(/["']([^"']+)["']/)
      if (quotedMatch) {
        filename = quotedMatch[1]
      }
      return {
        command: `cat ${quoteIfNeeded(filename)}`,
        confidence: 0.9,
        explanation: `Displays the contents of ${filename}`,
        alternatives: ['less', 'more', 'head', 'tail'].map((cmd) => `${cmd} ${quoteIfNeeded(filename)}`),
      }
    },
  },

  // Show file contents (generic)
  {
    patterns: [/^show\s+file\s+contents?$/i],
    handler: () => ({
      command: 'cat',
      confidence: 0.7,
      explanation: 'Displays file contents (filename required)',
      alternatives: ['less', 'more', 'head'],
    }),
  },

  // ============================================
  // MKDIR
  // ============================================
  {
    patterns: [/^create\s+(?:a\s+)?directory\s+(?:called\s+)?(.+)$/i, /^mkdir\s+(.+)$/i],
    handler: (match) => ({
      command: `mkdir ${match[1]}`,
      confidence: 0.9,
      explanation: `Creates a directory named ${match[1]}`,
      alternatives: [`mkdir -p ${match[1]}`],
    }),
  },

  {
    patterns: [
      /^create\s+nested\s+director(?:y|ies)\s+(.+)$/i,
      /^create\s+parent\s+director(?:y|ies)\s+if\s+they\s+don'?t\s+exist$/i,
    ],
    handler: (match) => {
      const path = match[1] || 'directory'
      return {
        command: `mkdir -p ${path}`,
        confidence: 0.85,
        explanation: `Creates nested directories, creating parent directories as needed`,
        alternatives: [],
      }
    },
  },

  // ============================================
  // TOUCH / CREATE FILE
  // ============================================
  {
    patterns: [/^create\s+(?:a\s+)?(?:new\s+)?file\s+(?:called\s+)?(.+)$/i, /^touch\s+(.+)$/i],
    handler: (match) => ({
      command: `touch ${match[1]}`,
      confidence: 0.9,
      explanation: `Creates a new empty file named ${match[1]}`,
      alternatives: [],
    }),
  },

  // ============================================
  // RM / DELETE
  // ============================================
  {
    patterns: [/^delete\s+(.+\.[\w]+)$/i, /^remove\s+(.+\.[\w]+)$/i, /^rm\s+(.+)$/i],
    handler: (match, _intent) => {
      const filename = match[1]
      return {
        command: `rm ${quoteIfNeeded(filename)}`,
        confidence: 0.9,
        explanation: `Deletes the file ${filename}`,
        alternatives: [`rm -i ${quoteIfNeeded(filename)}`],
      }
    },
  },

  {
    patterns: [
      /^delete\s+(.+)\s+recursively$/i,
      /^remove\s+(.+)\s+recursively$/i,
      /^rm\s+-r\s+(.+)$/i,
    ],
    handler: (match) => ({
      command: `rm -r ${match[1]}`,
      confidence: 0.85,
      explanation: `Recursively deletes ${match[1]} and its contents`,
      alternatives: [`rm -rf ${match[1]}`],
      dangerous: true,
      warning: 'This will recursively delete files and directories',
    }),
  },

  {
    patterns: [
      /^force\s+delete\s+(.+)\s+and\s+contents$/i,
      /^rm\s+-rf\s+(.+)$/i,
    ],
    handler: (match) => ({
      command: `rm -rf ${match[1]}`,
      confidence: 0.85,
      explanation: `Forcefully and recursively deletes ${match[1]}`,
      alternatives: [],
      dangerous: true,
      warning: 'This will forcefully delete all files without confirmation',
    }),
  },

  {
    patterns: [/^delete\s+files?\s+with\s+confirmation$/i],
    handler: () => ({
      command: 'rm -i',
      confidence: 0.8,
      explanation: 'Deletes files with interactive confirmation for each file',
      alternatives: [],
    }),
  },

  // ============================================
  // CP / COPY
  // ============================================
  {
    patterns: [/^copy\s+(.+)\s+to\s+(.+)$/i, /^cp\s+(.+)\s+(.+)$/i],
    handler: (match, intent) => {
      // Check if intent mentions "folder" or "recursively"
      if (/folder|directory|recursively/i.test(intent)) {
        return {
          command: `cp -r ${match[1]}`,
          confidence: 0.85,
          explanation: 'Copies directory recursively',
          alternatives: [],
        }
      }
      return {
        command: `cp ${match[1]} ${match[2]}`,
        confidence: 0.9,
        explanation: `Copies ${match[1]} to ${match[2]}`,
        alternatives: [`cp -i ${match[1]} ${match[2]}`],
      }
    },
  },

  {
    patterns: [/^copy\s+folder\s+recursively$/i, /^copy\s+(.+)\s+recursively$/i],
    handler: (match) => ({
      command: `cp -r ${match[1] || 'source destination'}`,
      confidence: 0.8,
      explanation: 'Copies directory recursively',
      alternatives: [],
    }),
  },

  {
    patterns: [/^copy\s+files?\s+with\s+verbose\s+output$/i],
    handler: () => ({
      command: 'cp -v',
      confidence: 0.8,
      explanation: 'Copies files with verbose output showing each file copied',
      alternatives: [],
    }),
  },

  // ============================================
  // MV / RENAME
  // ============================================
  {
    patterns: [/^rename\s+(.+)\s+to\s+(.+)$/i, /^mv\s+(.+)\s+(.+)$/i, /^move\s+(.+)\s+to\s+(.+)$/i],
    handler: (match) => ({
      command: `mv ${match[1]} ${match[2]}`,
      confidence: 0.9,
      explanation: `Renames/moves ${match[1]} to ${match[2]}`,
      alternatives: [],
    }),
  },

  // ============================================
  // FIND
  // ============================================
  {
    patterns: [/^find\s+(?:all\s+)?typescript\s+files?$/i],
    handler: () => ({
      command: "find . -name '*.ts'",
      confidence: 0.85,
      explanation: 'Finds all TypeScript files in current directory and subdirectories',
      alternatives: ["find . -name '*.ts' -o -name '*.tsx'"],
    }),
  },

  {
    patterns: [/^find\s+files?\s+larger\s+than\s+(\d+)([MmGgKk])[Bb]?$/i],
    handler: (match) => ({
      command: `find . -size +${match[1]}${match[2].toUpperCase()}`,
      confidence: 0.85,
      explanation: `Finds files larger than ${match[1]}${match[2].toUpperCase()}`,
      alternatives: [],
    }),
  },

  // Generic "find large files"
  {
    patterns: [/^find\s+large\s+files?$/i],
    handler: () => ({
      command: 'find . -size +100M',
      confidence: 0.85,
      explanation: 'Finds files larger than 100MB',
      alternatives: ['find . -size +10M', 'find . -size +1G', 'du -ah . | sort -rh | head -20'],
    }),
  },

  {
    patterns: [/^find\s+files?\s+modified\s+in\s+(?:the\s+)?last\s+24\s+hours?$/i],
    handler: () => ({
      command: 'find . -mtime -1',
      confidence: 0.85,
      explanation: 'Finds files modified in the last 24 hours',
      alternatives: ['find . -mmin -1440'],
    }),
  },

  {
    patterns: [/^find\s+(?:all\s+)?director(?:y|ies)$/i],
    handler: () => ({
      command: 'find . -type d',
      confidence: 0.85,
      explanation: 'Finds all directories in current directory tree',
      alternatives: [],
    }),
  },

  // Ambiguous "find"
  {
    patterns: [/^find$/i],
    handler: () => ({
      command: 'find .',
      confidence: 0.5,
      explanation: 'Find command - specify what to find for better results',
      alternatives: ["find . -name '*.txt'", 'find . -type f', 'find . -type d'],
      ambiguous: true,
    }),
  },

  // ============================================
  // GREP / SEARCH
  // ============================================
  {
    patterns: [/^search\s+(?:for\s+)?(.+)\s+in\s+all\s+files?$/i, /^grep\s+(.+)$/i],
    handler: (match) => {
      const pattern = match[1]
      return {
        command: `grep -r '${pattern}' .`,
        confidence: 0.85,
        explanation: `Searches for "${pattern}" in all files recursively`,
        alternatives: [`grep -rn '${pattern}' .`],
      }
    },
  },

  {
    patterns: [/^search\s+(?:for\s+)?(?:pattern\s+)?(?:and\s+)?show\s+line\s+numbers?$/i],
    handler: () => ({
      command: 'grep -n',
      confidence: 0.8,
      explanation: 'Searches for pattern and shows line numbers',
      alternatives: [],
    }),
  },

  {
    patterns: [/^search\s+recursively\s+and\s+show\s+line\s+numbers?$/i],
    handler: () => ({
      command: 'grep -rn',
      confidence: 0.85,
      explanation: 'Searches recursively and shows line numbers',
      alternatives: [],
    }),
  },

  {
    patterns: [/^search\s+for\s+['"](.+)['"]$/i],
    handler: (match) => ({
      command: `grep -r '${match[1]}' .`,
      confidence: 0.85,
      explanation: `Searches for "${match[1]}" in all files`,
      alternatives: [],
    }),
  },

  // ============================================
  // GIT COMMANDS
  // ============================================
  {
    patterns: [/^(?:check\s+)?git\s+status$/i, /^show\s+git\s+status$/i],
    handler: () => ({
      command: 'git status',
      confidence: 0.95,
      explanation: 'Shows the current git status',
      alternatives: ['git status -s'],
    }),
  },

  {
    patterns: [/^show\s+git\s+history$/i, /^git\s+log$/i],
    handler: () => ({
      command: 'git log',
      confidence: 0.9,
      explanation: 'Shows the git commit history',
      alternatives: ['git log --oneline', 'git log --graph'],
    }),
  },

  {
    patterns: [/^show\s+(?:the\s+)?last\s+(\d+)\s+commits?$/i],
    handler: (match) => ({
      command: `git log --oneline -${match[1]}`,
      confidence: 0.85,
      explanation: `Shows the last ${match[1]} commits`,
      alternatives: [`git log -${match[1]}`],
    }),
  },

  {
    patterns: [/^list\s+(?:all\s+)?branches?$/i, /^git\s+branch(?:\s+-a)?$/i],
    handler: () => ({
      command: 'git branch -a',
      confidence: 0.9,
      explanation: 'Lists all git branches including remote branches',
      alternatives: ['git branch', 'git branch -r'],
    }),
  },

  {
    patterns: [/^show\s+uncommitted\s+changes?$/i, /^git\s+diff$/i],
    handler: () => ({
      command: 'git diff',
      confidence: 0.85,
      explanation: 'Shows uncommitted changes in the working directory',
      alternatives: ['git diff --staged', 'git diff HEAD'],
    }),
  },

  {
    patterns: [/^stash\s+(?:my\s+)?changes?$/i, /^git\s+stash$/i],
    handler: () => ({
      command: 'git stash',
      confidence: 0.9,
      explanation: 'Stashes current changes',
      alternatives: ['git stash push', 'git stash -m "message"'],
    }),
  },

  {
    patterns: [/^create\s+(?:a\s+)?(?:new\s+)?branch\s+(?:called\s+)?(.+)$/i],
    handler: (match) => ({
      command: `git checkout -b ${match[1]}`,
      confidence: 0.85,
      explanation: `Creates and switches to a new branch called ${match[1]}`,
      alternatives: [`git branch ${match[1]}`],
    }),
  },

  {
    patterns: [/^commit\s+(?:my\s+)?changes?$/i],
    handler: (_, __, options) => {
      if (options?.context?.isGitRepo) {
        return {
          command: 'git commit',
          confidence: 0.85,
          explanation: 'Commits staged changes',
          alternatives: ['git commit -m "message"', 'git commit -a'],
        }
      }
      return {
        command: 'git commit',
        confidence: 0.7,
        explanation: 'Commits staged changes (requires git repository)',
        alternatives: [],
      }
    },
  },

  // Ambiguous "status"
  {
    patterns: [/^status$/i],
    handler: () => ({
      command: 'git status',
      confidence: 0.6,
      explanation: 'Shows git status (could also mean system status)',
      alternatives: ['systemctl status', 'docker ps'],
      ambiguous: true,
    }),
  },

  // ============================================
  // PIPELINE COMMANDS
  // ============================================
  {
    patterns: [/^count\s+lines?\s+in\s+(.+)$/i],
    handler: (match) => ({
      command: `wc -l ${match[1]}`,
      confidence: 0.85,
      explanation: `Counts the number of lines in ${match[1]}`,
      alternatives: [`cat ${match[1]} | wc -l`],
    }),
  },

  {
    patterns: [/^find\s+duplicate\s+lines?\s+in\s+(.+)$/i],
    handler: (match) => ({
      command: `sort ${match[1]} | uniq -d`,
      confidence: 0.75,
      explanation: `Finds duplicate lines in ${match[1]}`,
      alternatives: [`sort ${match[1]} | uniq -c | sort -rn`],
    }),
  },

  {
    patterns: [/^sort\s+(?:file\s+)?(?:by\s+)?second\s+column$/i, /^sort\s+file\s+by\s+second\s+column$/i],
    handler: () => ({
      command: 'sort -k 2',
      confidence: 0.75,
      explanation: 'Sorts input by the second column',
      alternatives: ['sort -k2,2'],
    }),
  },

  {
    patterns: [/^show\s+(?:the\s+)?top\s+(\d+)\s+largest\s+files?$/i],
    handler: (match) => ({
      command: `du -ah . | sort -rh | head -${match[1]}`,
      confidence: 0.7,
      explanation: `Shows the ${match[1]} largest files`,
      alternatives: ['ls -lhS | head'],
    }),
  },

  // ============================================
  // SYSTEM INFO
  // ============================================
  {
    patterns: [/^check\s+disk\s+space$/i, /^show\s+disk\s+(space|usage)$/i, /^df$/i],
    handler: () => ({
      command: 'df -h',
      confidence: 0.95,
      explanation: 'Shows disk space usage in human-readable format',
      alternatives: ['df', 'df -H'],
    }),
  },

  {
    patterns: [/^show\s+disk\s+usage\s+in\s+human\s+readable\s+format$/i],
    handler: () => ({
      command: 'du -h',
      confidence: 0.9,
      explanation: 'Shows disk usage in human-readable format',
      alternatives: ['du -sh', 'df -h'],
    }),
  },

  {
    patterns: [/^show\s+memory\s+usage$/i, /^check\s+memory$/i],
    handler: (_, __, options) => {
      if (options?.platform === 'darwin') {
        return {
          command: 'vm_stat',
          confidence: 0.85,
          explanation: 'Shows virtual memory statistics on macOS',
          alternatives: ['top -l 1 | head -10'],
        }
      }
      // Default to Linux
      return {
        command: 'free -h',
        confidence: 0.85,
        explanation: 'Shows memory usage in human-readable format',
        alternatives: ['cat /proc/meminfo', 'top'],
      }
    },
  },

  {
    patterns: [/^show\s+running\s+processes?$/i, /^ps$/i],
    handler: () => ({
      command: 'ps aux',
      confidence: 0.9,
      explanation: 'Shows all running processes with details',
      alternatives: ['ps ef', 'top', 'htop'],
    }),
  },

  {
    patterns: [/^show\s+system\s+information$/i, /^uname$/i],
    handler: () => ({
      command: 'uname -a',
      confidence: 0.85,
      explanation: 'Shows detailed system information',
      alternatives: ['uname', 'hostname'],
    }),
  },

  {
    patterns: [/^(?:how\s+long\s+has\s+)?system\s+been\s+running$/i, /^uptime$/i],
    handler: () => ({
      command: 'uptime',
      confidence: 0.9,
      explanation: 'Shows how long the system has been running',
      alternatives: [],
    }),
  },

  // ============================================
  // DANGEROUS OPERATIONS
  // ============================================
  {
    patterns: [/^delete\s+(?:all\s+)?(?:the\s+)?(?:files?|everything)$/i],
    handler: (_, __, options) => {
      if (options?.safe) {
        return {
          command: 'rm -i *',
          confidence: 0.5,
          explanation: 'Delete files with confirmation (safe mode)',
          dangerous: true,
          warning: 'This operation could delete important files. Safe mode enabled.',
        }
      }
      return {
        command: 'rm -rf ./*',
        confidence: 0.7,
        explanation: 'Deletes all files in current directory',
        dangerous: true,
        warning: 'This will permanently delete all files in the current directory',
      }
    },
  },

  {
    patterns: [/^change\s+permissions?\s+for\s+everything$/i, /^chmod\s+-R/i],
    handler: () => ({
      command: 'chmod -R',
      confidence: 0.6,
      explanation: 'Changes permissions recursively (specify permissions and path)',
      dangerous: true,
      warning: 'Changing permissions recursively can affect system stability',
    }),
  },

  {
    patterns: [/^format\s+(?:the\s+)?hard\s+drive$/i],
    handler: () => ({
      command: '',
      confidence: 0,
      explanation: 'This operation is blocked for safety',
      blocked: true,
      dangerous: true,
      warning: 'Formatting drives is blocked for safety reasons',
      success: false,
      error: 'Dangerous operation blocked',
    }),
  },

  {
    patterns: [/^install\s+(?:package|.+)\s+as\s+root$/i, /^sudo\s+/i],
    handler: () => ({
      command: 'sudo',
      confidence: 0.7,
      explanation: 'Runs command with elevated privileges',
      requiresConfirmation: true,
      warning: 'This command requires root privileges',
    }),
  },

  // ============================================
  // CONTEXT-AWARE COMMANDS
  // ============================================
  {
    patterns: [/^edit\s+(?:the\s+)?config\s+file$/i],
    handler: (_, __, options) => {
      const files = options?.context?.files || []
      const configFile =
        files.find((f) => /config\.(json|yaml|yml|toml)$/i.test(f)) ||
        'config.json'
      return {
        command: `$EDITOR ${configFile}`,
        confidence: 0.7,
        explanation: `Opens ${configFile} for editing`,
        alternatives: files
          .filter((f) => /config/i.test(f))
          .map((f) => `$EDITOR ${f}`),
      }
    },
  },

  {
    patterns: [/^run\s+(?:the\s+)?tests?$/i],
    handler: (_, __, options) => {
      const projectType = options?.context?.projectType
      const hasPackageJson = options?.context?.hasPackageJson

      if (projectType === 'rust') {
        return {
          command: 'cargo test',
          confidence: 0.9,
          explanation: 'Runs Rust tests',
          alternatives: ['cargo test --release'],
        }
      }

      if (hasPackageJson || projectType === 'node') {
        return {
          command: 'npm test',
          confidence: 0.9,
          explanation: 'Runs npm test script',
          alternatives: ['npm run test', 'yarn test'],
        }
      }

      return {
        command: 'npm test',
        confidence: 0.6,
        explanation: 'Runs tests (detected as npm project)',
        alternatives: ['cargo test', 'pytest', 'go test'],
      }
    },
  },

  {
    patterns: [/^build\s+(?:the\s+)?project$/i],
    handler: (_, __, options) => {
      const projectType = options?.context?.projectType

      if (projectType === 'rust') {
        return {
          command: 'cargo build',
          confidence: 0.9,
          explanation: 'Builds Rust project',
          alternatives: ['cargo build --release'],
        }
      }

      return {
        command: 'npm run build',
        confidence: 0.7,
        explanation: 'Builds project',
        alternatives: ['make', 'cargo build'],
      }
    },
  },

  // ============================================
  // AMBIGUOUS SINGLE-WORD COMMANDS
  // ============================================
  {
    patterns: [/^list$/i],
    handler: () => ({
      command: 'ls',
      confidence: 0.6,
      explanation: 'Lists files (ambiguous - could mean different things)',
      alternatives: ['ls -la', 'docker ps', 'npm list'],
      ambiguous: true,
    }),
  },

  // ============================================
  // FILE WITH SPECIAL CHARACTERS
  // ============================================
  {
    patterns: [/^delete\s+file\s+with(.+)$/i],
    handler: (match) => {
      // Extract the filename with special chars
      const filename = match[1].trim()
      return {
        command: `rm '${filename}'`,
        confidence: 0.8,
        explanation: `Deletes file with special characters: ${filename}`,
        alternatives: [],
      }
    },
  },
]

/**
 * Generate a bash command from a natural language intent.
 *
 * @param intent - The natural language description of the desired action
 * @param options - Optional configuration for command generation
 * @returns Promise resolving to the generation result
 */
export async function generateCommand(
  intent: string,
  options?: GenerateOptions
): Promise<GenerateCommandResult> {
  // Handle invalid inputs
  if (!intent || intent.trim() === '') {
    return {
      success: false,
      command: '',
      confidence: 0,
      intent: intent || '',
      explanation: 'No intent provided',
      error: 'Intent cannot be empty',
    }
  }

  const normalizedIntent = intent.trim()

  // Check for blocked dangerous operations
  const dangerousPatterns = [
    /^format\s+(?:the\s+)?(?:hard\s+)?drive$/i,
    /^dd\s+if=.*of=\/dev\/sd/i,
    /^rm\s+-rf\s+\/[^*]/i, // rm -rf / but not rm -rf ./*
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(normalizedIntent)) {
      return {
        success: false,
        command: '',
        confidence: 0,
        intent: normalizedIntent,
        explanation: 'This operation is blocked for safety',
        blocked: true,
        dangerous: true,
        warning: 'This dangerous operation has been blocked',
        error: 'Dangerous operation blocked',
      }
    }
  }

  // Try to match intent against patterns
  for (const { patterns, handler } of intentPatterns) {
    for (const pattern of patterns) {
      const match = normalizedIntent.match(pattern)
      if (match) {
        const result = handler(match, normalizedIntent, options)

        // Handle safe mode for dangerous commands
        if (options?.safe && result.dangerous) {
          return {
            success: true,
            command: result.command?.replace(/rm\s+-rf/, 'rm -i') || '',
            confidence: result.confidence || 0.5,
            intent: normalizedIntent,
            explanation: result.explanation || 'Command generated with safe mode',
            warning: 'Safe mode: destructive operation modified',
            dangerous: true,
            alternatives: result.alternatives,
          }
        }

        return {
          success: result.success !== false,
          command: result.command || '',
          confidence: result.confidence || 0.8,
          intent: normalizedIntent,
          explanation: result.explanation || 'Command generated',
          alternatives: result.alternatives,
          ambiguous: result.ambiguous,
          warning: result.warning,
          dangerous: result.dangerous,
          blocked: result.blocked,
          requiresConfirmation: result.requiresConfirmation,
          error: result.error,
        }
      }
    }
  }

  // No pattern matched - check for nonsense
  const commonWords = [
    'list',
    'show',
    'find',
    'search',
    'delete',
    'create',
    'move',
    'copy',
    'git',
    'run',
    'check',
    'cat',
    'grep',
    'mkdir',
    'touch',
    'rm',
    'cp',
    'mv',
    'pwd',
    'cd',
  ]

  const words = normalizedIntent.toLowerCase().split(/\s+/)
  const hasRecognizedWord = words.some((w) =>
    commonWords.some((cw) => w.includes(cw))
  )

  if (!hasRecognizedWord) {
    return {
      success: false,
      command: '',
      confidence: 0.1,
      intent: normalizedIntent,
      explanation: 'Could not understand the intent',
      error: 'Unrecognized intent',
    }
  }

  // Partial match - return with low confidence
  return {
    success: false,
    command: '',
    confidence: 0.3,
    intent: normalizedIntent,
    explanation: 'Intent was partially recognized but could not generate a specific command',
    error: 'Could not generate command from intent',
    alternatives: [],
  }
}
