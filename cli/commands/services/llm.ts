/**
 * LLM Command (Commander wrapper)
 *
 * Make LLM requests via llm.do (with streaming)
 *
 * Usage:
 *   do llm "Summarize this document"
 *   do llm "Hello" --model claude-sonnet
 *   do llm "Hello" --system "You are a helpful assistant"
 *   do llm "Hello" --max-tokens 100
 *   do llm "Hello" --temperature 0.7
 *   do llm "Hello" --no-stream
 *   do llm "Hello" --json
 */

import { Command } from 'commander'
import { run } from '../../src/commands/llm'

export const llmCommand = new Command('llm')
  .description('Make LLM requests via llm.do')
  .argument('<prompt>', 'The prompt to send')
  .option('--model <model>', 'Model to use')
  .option('--system <system>', 'System prompt')
  .option('--max-tokens <n>', 'Maximum tokens to generate')
  .option('--temperature <n>', 'Temperature (0-2)')
  .option('--no-stream', 'Disable streaming output')
  .option('--json', 'Output as JSON')
  .action(async (prompt, options) => {
    // Build args array for existing run function
    const args = [prompt]
    if (options.model) {
      args.push('--model', options.model)
    }
    if (options.system) {
      args.push('--system', options.system)
    }
    if (options.maxTokens) {
      args.push('--max-tokens', options.maxTokens)
    }
    if (options.temperature) {
      args.push('--temperature', options.temperature)
    }
    if (options.stream === false) {
      args.push('--no-stream')
    }
    if (options.json) {
      args.push('--json')
    }
    await run(args)
  })

export default llmCommand
