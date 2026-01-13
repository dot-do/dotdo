/**
 * ShellDO - Shell Execution on the Edge
 *
 * Demonstrates bashx capabilities:
 * - $.bash template literal execution
 * - Build automation pipelines
 * - Image processing with ImageMagick
 * - Python script execution
 * - Command chaining and pipes
 * - Safety analysis and dangerous command blocking
 *
 * @example
 * ```typescript
 * const shell = new ShellDO()
 *
 * // Clone and build a project
 * await shell.buildProject('https://github.com/user/repo')
 *
 * // Process images
 * await shell.processImage('https://example.com/photo.jpg')
 *
 * // Run Python analysis
 * await shell.runPythonAnalysis({ data: [1, 2, 3] })
 * ```
 */

import { DO } from 'dotdo'
import { withBash, withFs } from 'dotdo/mixins'

// ============================================================================
// TYPES
// ============================================================================

export interface BuildResult {
  success: boolean
  output: string
  artifacts: string[]
  duration: number
}

export interface ImageResult {
  full: ArrayBuffer
  thumb: ArrayBuffer
  metadata: {
    width: number
    height: number
    format: string
  }
}

export interface AnalysisResult {
  summary: string
  metrics: Record<string, number>
  recommendations: string[]
}

export interface PipelineResult {
  stages: Array<{
    name: string
    success: boolean
    output: string
    duration: number
  }>
  totalDuration: number
}

// ============================================================================
// SHELL DURABLE OBJECT
// ============================================================================

/**
 * ShellDO - Durable Object with shell execution capabilities
 *
 * This DO demonstrates running shell commands on Cloudflare's edge network
 * without VMs. Commands are:
 * - Parsed to AST for structural analysis
 * - Classified for safety (read/write/delete/system)
 * - Executed in optimal tier (native/RPC/sandbox)
 * - Blocked if dangerous (rm -rf /, chmod 777 /, etc.)
 */
export class ShellDO extends withBash(withFs(DO), {
  executor: (instance) => ({
    execute: async (cmd, opts) => {
      // In production, this routes to bashx.do service
      // For this example, we simulate execution
      return instance.executeCommand(cmd, opts)
    }
  }),
  fs: (instance) => instance.$.fs,
  useNativeOps: true
}) {
  static readonly $type = 'ShellDO'

  // ============================================================================
  // BUILD AUTOMATION
  // ============================================================================

  /**
   * Clone and build a project
   *
   * @example
   * ```typescript
   * const result = await shell.buildProject('https://github.com/user/app')
   * console.log(result.artifacts) // ['dist/index.js', 'dist/styles.css']
   * ```
   */
  async buildProject(repoUrl: string): Promise<BuildResult> {
    const start = Date.now()

    // Clone repository
    await this.$.bash`git clone ${repoUrl} ./project`

    // Install dependencies
    await this.$.bash`cd project && npm install`

    // Run build
    const result = await this.$.bash`cd project && npm run build`

    if (result.exitCode !== 0) {
      throw new Error(`Build failed: ${result.stderr}`)
    }

    // Find build artifacts
    const artifacts = await this.$.fs.glob('project/dist/**/*')

    return {
      success: true,
      output: result.stdout,
      artifacts: artifacts.map(f => f.name),
      duration: Date.now() - start
    }
  }

  /**
   * Run CI/CD pipeline
   *
   * @example
   * ```typescript
   * const result = await shell.runPipeline({
   *   lint: true,
   *   test: true,
   *   build: true,
   *   deploy: false
   * })
   * ```
   */
  async runPipeline(options: {
    lint?: boolean
    test?: boolean
    build?: boolean
    deploy?: boolean
  }): Promise<PipelineResult> {
    const stages: PipelineResult['stages'] = []
    const pipelineStart = Date.now()

    // Lint stage
    if (options.lint) {
      const start = Date.now()
      try {
        const result = await this.$.bash`npm run lint`
        stages.push({
          name: 'lint',
          success: result.exitCode === 0,
          output: result.stdout,
          duration: Date.now() - start
        })
      } catch (error) {
        stages.push({
          name: 'lint',
          success: false,
          output: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start
        })
      }
    }

    // Test stage
    if (options.test) {
      const start = Date.now()
      try {
        const result = await this.$.bash`npm test`
        stages.push({
          name: 'test',
          success: result.exitCode === 0,
          output: result.stdout,
          duration: Date.now() - start
        })
      } catch (error) {
        stages.push({
          name: 'test',
          success: false,
          output: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start
        })
      }
    }

    // Build stage
    if (options.build) {
      const start = Date.now()
      try {
        const result = await this.$.bash`npm run build`
        stages.push({
          name: 'build',
          success: result.exitCode === 0,
          output: result.stdout,
          duration: Date.now() - start
        })
      } catch (error) {
        stages.push({
          name: 'build',
          success: false,
          output: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start
        })
      }
    }

    // Deploy stage (requires confirmation for safety)
    if (options.deploy) {
      const start = Date.now()
      try {
        const result = await this.$.bash.exec('npm', ['run', 'deploy'], { confirm: true })
        stages.push({
          name: 'deploy',
          success: result.exitCode === 0,
          output: result.stdout,
          duration: Date.now() - start
        })
      } catch (error) {
        stages.push({
          name: 'deploy',
          success: false,
          output: error instanceof Error ? error.message : String(error),
          duration: Date.now() - start
        })
      }
    }

    return {
      stages,
      totalDuration: Date.now() - pipelineStart
    }
  }

  // ============================================================================
  // IMAGE PROCESSING
  // ============================================================================

  /**
   * Process an image with ImageMagick
   *
   * Demonstrates:
   * - Fetching remote content
   * - Writing to virtual filesystem
   * - Running ImageMagick commands
   * - Reading processed results
   *
   * @example
   * ```typescript
   * const result = await shell.processImage('https://example.com/photo.jpg')
   * await saveFile('output.jpg', result.full)
   * await saveFile('thumb.jpg', result.thumb)
   * ```
   */
  async processImage(imageUrl: string): Promise<ImageResult> {
    // Fetch and save input image
    const response = await fetch(imageUrl)
    const buffer = await response.arrayBuffer()
    await this.$.fs.write('input.jpg', buffer)

    // Resize to web-optimized size
    await this.$.bash`convert input.jpg -resize 800x600 -quality 85 output.jpg`

    // Create thumbnail with smart cropping
    await this.$.bash`convert input.jpg -thumbnail 150x150^ -gravity center -extent 150x150 thumb.jpg`

    // Get image metadata
    const identify = await this.$.bash`identify -format '%w %h %m' input.jpg`
    const [width, height, format] = identify.stdout.trim().split(' ')

    return {
      full: await this.$.fs.read('output.jpg'),
      thumb: await this.$.fs.read('thumb.jpg'),
      metadata: {
        width: parseInt(width, 10),
        height: parseInt(height, 10),
        format
      }
    }
  }

  /**
   * Generate image variants for responsive design
   *
   * @example
   * ```typescript
   * const variants = await shell.generateResponsiveImages('hero.jpg', [320, 640, 1024, 1920])
   * // Returns { 320: buffer, 640: buffer, 1024: buffer, 1920: buffer }
   * ```
   */
  async generateResponsiveImages(
    imagePath: string,
    widths: number[]
  ): Promise<Record<number, ArrayBuffer>> {
    const results: Record<number, ArrayBuffer> = {}

    for (const width of widths) {
      const outputPath = `responsive-${width}.jpg`
      await this.$.bash`convert ${imagePath} -resize ${width}x -quality 80 ${outputPath}`
      results[width] = await this.$.fs.read(outputPath)
    }

    return results
  }

  // ============================================================================
  // PYTHON EXECUTION
  // ============================================================================

  /**
   * Run Python data analysis
   *
   * Demonstrates:
   * - Writing data files
   * - Python script execution
   * - Parsing JSON output
   *
   * @example
   * ```typescript
   * const result = await shell.runPythonAnalysis({
   *   values: [1, 2, 3, 4, 5],
   *   operation: 'statistics'
   * })
   * console.log(result.metrics) // { mean: 3, stddev: 1.58, ... }
   * ```
   */
  async runPythonAnalysis(data: object): Promise<AnalysisResult> {
    // Write input data
    await this.$.fs.write('data.json', JSON.stringify(data))

    // Write analysis script
    await this.$.fs.write('analyze.py', `
import json
import sys
from statistics import mean, stdev

with open('data.json') as f:
    data = json.load(f)

values = data.get('values', [])
result = {
    'summary': f'Analyzed {len(values)} values',
    'metrics': {
        'count': len(values),
        'mean': mean(values) if values else 0,
        'stddev': stdev(values) if len(values) > 1 else 0,
        'min': min(values) if values else 0,
        'max': max(values) if values else 0
    },
    'recommendations': []
}

# Add recommendations based on analysis
if result['metrics']['stddev'] > result['metrics']['mean'] * 0.5:
    result['recommendations'].append('High variance detected - consider normalizing data')
if len(values) < 30:
    result['recommendations'].append('Sample size may be too small for reliable statistics')

print(json.dumps(result))
`)

    // Execute analysis
    const result = await this.$.bash`python3 analyze.py`

    if (result.exitCode !== 0) {
      throw new Error(`Python analysis failed: ${result.stderr}`)
    }

    return JSON.parse(result.stdout)
  }

  /**
   * Run a custom Python script
   *
   * @example
   * ```typescript
   * const output = await shell.runPythonScript(`
   *   print("Hello from Python!")
   *   print(2 + 2)
   * `)
   * ```
   */
  async runPythonScript(script: string, args: string[] = []): Promise<string> {
    await this.$.fs.write('script.py', script)

    const argsStr = args.map(a => `'${a}'`).join(' ')
    const result = await this.$.bash`python3 script.py ${argsStr}`

    if (result.exitCode !== 0) {
      throw new Error(`Script failed: ${result.stderr}`)
    }

    return result.stdout
  }

  // ============================================================================
  // COMMAND CHAINING & PIPES
  // ============================================================================

  /**
   * Process log files with Unix pipes
   *
   * @example
   * ```typescript
   * const result = await shell.analyzeLogFile('access.log', 'ERROR')
   * console.log(result.lines) // Array of matching lines
   * console.log(result.count) // Number of matches
   * ```
   */
  async analyzeLogFile(logPath: string, pattern: string): Promise<{
    lines: string[]
    count: number
    topOccurrences: Array<{ line: string; count: number }>
  }> {
    // Find matching lines
    const grep = await this.$.bash`grep ${pattern} ${logPath}`
    const lines = grep.stdout.trim().split('\n').filter(Boolean)

    // Count occurrences
    const wc = await this.$.bash`grep -c ${pattern} ${logPath}`
    const count = parseInt(wc.stdout.trim(), 10)

    // Find top recurring patterns (command chaining)
    const top = await this.$.bash`grep ${pattern} ${logPath} | sort | uniq -c | sort -rn | head -10`
    const topOccurrences = top.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const match = line.trim().match(/^\s*(\d+)\s+(.*)$/)
        return match ? { line: match[2], count: parseInt(match[1], 10) } : null
      })
      .filter((x): x is { line: string; count: number } => x !== null)

    return { lines, count, topOccurrences }
  }

  /**
   * Run a shell pipeline with multiple stages
   *
   * @example
   * ```typescript
   * const result = await shell.pipeline([
   *   'cat data.txt',
   *   'grep important',
   *   'sort -u',
   *   'wc -l'
   * ])
   * ```
   */
  async pipeline(commands: string[]): Promise<string> {
    const piped = commands.join(' | ')
    const result = await this.$.bash.exec('sh', ['-c', piped])
    return result.stdout
  }

  // ============================================================================
  // SAFETY ANALYSIS
  // ============================================================================

  /**
   * Analyze a command for safety before execution
   *
   * @example
   * ```typescript
   * const analysis = await shell.analyzeCommand('rm -rf /')
   * console.log(analysis.classification.impact) // 'critical'
   * console.log(analysis.blocked) // true
   * console.log(analysis.blockReason) // 'Recursive delete targeting root filesystem'
   * ```
   */
  async analyzeCommand(command: string): Promise<{
    classification: {
      type: 'read' | 'write' | 'delete' | 'execute' | 'network' | 'system' | 'mixed'
      impact: 'none' | 'low' | 'medium' | 'high' | 'critical'
      reversible: boolean
      reason: string
    }
    intent: {
      commands: string[]
      reads: string[]
      writes: string[]
      deletes: string[]
      network: boolean
      elevated: boolean
    }
    dangerous: boolean
    dangerReason?: string
  }> {
    const analysis = this.$.bash.analyze(command)
    const dangerCheck = this.$.bash.isDangerous(command)

    return {
      classification: analysis.classification,
      intent: analysis.intent,
      dangerous: dangerCheck.dangerous,
      dangerReason: dangerCheck.reason
    }
  }

  /**
   * Execute a command only if it passes safety checks
   *
   * @example
   * ```typescript
   * // Safe command executes
   * await shell.safeExec('ls -la')
   *
   * // Dangerous command throws
   * await shell.safeExec('rm -rf /') // throws Error
   * ```
   */
  async safeExec(command: string): Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }> {
    const dangerCheck = this.$.bash.isDangerous(command)

    if (dangerCheck.dangerous) {
      throw new Error(`Command blocked: ${dangerCheck.reason}`)
    }

    const result = await this.$.bash.exec(command, [])
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    }
  }

  // ============================================================================
  // ENVIRONMENT SETUP
  // ============================================================================

  /**
   * Set up a development environment
   *
   * @example
   * ```typescript
   * await shell.setupEnvironment({
   *   node: '20',
   *   python: '3.11',
   *   packages: ['typescript', 'vitest']
   * })
   * ```
   */
  async setupEnvironment(config: {
    node?: string
    python?: string
    packages?: string[]
    env?: Record<string, string>
  }): Promise<{ installed: string[]; versions: Record<string, string> }> {
    const installed: string[] = []
    const versions: Record<string, string> = {}

    // Set environment variables
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        await this.$.bash`export ${key}=${value}`
      }
    }

    // Check Node.js version
    if (config.node) {
      const nodeVersion = await this.$.bash`node --version`
      versions['node'] = nodeVersion.stdout.trim()
    }

    // Check Python version
    if (config.python) {
      const pythonVersion = await this.$.bash`python3 --version`
      versions['python'] = pythonVersion.stdout.trim()
    }

    // Install npm packages
    if (config.packages?.length) {
      const packages = config.packages.join(' ')
      await this.$.bash`npm install ${packages}`
      installed.push(...config.packages)
    }

    return { installed, versions }
  }

  // ============================================================================
  // FFMPEG MEDIA PROCESSING
  // ============================================================================

  /**
   * Transcode video with FFmpeg
   *
   * @example
   * ```typescript
   * await shell.transcodeVideo('input.mp4', {
   *   format: 'webm',
   *   resolution: '1280x720',
   *   bitrate: '2M'
   * })
   * ```
   */
  async transcodeVideo(inputPath: string, options: {
    format?: 'mp4' | 'webm' | 'mov'
    resolution?: string
    bitrate?: string
  }): Promise<ArrayBuffer> {
    const format = options.format || 'mp4'
    const outputPath = `output.${format}`

    let command = `ffmpeg -i ${inputPath}`

    if (options.resolution) {
      command += ` -s ${options.resolution}`
    }

    if (options.bitrate) {
      command += ` -b:v ${options.bitrate}`
    }

    command += ` -y ${outputPath}`

    const result = await this.$.bash.exec('sh', ['-c', command])

    if (result.exitCode !== 0) {
      throw new Error(`Video transcoding failed: ${result.stderr}`)
    }

    return this.$.fs.read(outputPath)
  }

  /**
   * Extract audio from video
   *
   * @example
   * ```typescript
   * const audio = await shell.extractAudio('video.mp4', 'mp3')
   * ```
   */
  async extractAudio(videoPath: string, format: 'mp3' | 'wav' | 'aac' = 'mp3'): Promise<ArrayBuffer> {
    const outputPath = `audio.${format}`

    await this.$.bash`ffmpeg -i ${videoPath} -vn -acodec ${format === 'mp3' ? 'libmp3lame' : format} -y ${outputPath}`

    return this.$.fs.read(outputPath)
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  /**
   * Internal command executor (used by withBash mixin)
   * In production, this routes to bashx.do service
   */
  async executeCommand(command: string, options?: any): Promise<any> {
    // This is a placeholder for the actual execution
    // In production, bashx.do handles tiered execution:
    // - Tier 1: Native in-worker (<1ms) - cat, ls, echo
    // - Tier 2: RPC services (<5ms) - jq, git, npm
    // - Tier 3: Dynamic modules (<10ms) - npm packages
    // - Tier 4: Full sandbox (2-3s cold) - bash, python, ffmpeg

    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: '',
      stderr: '',
      exitCode: 0,
      intent: {
        commands: [command.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false
      },
      classification: {
        type: 'execute' as const,
        impact: 'low' as const,
        reversible: true,
        reason: 'Command execution'
      }
    }
  }
}
