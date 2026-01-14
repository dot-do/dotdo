import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { Interpreter } from '../interpreter'
import { BenthosMessage } from '../../core/message'

describe('Debug Metadata', () => {
  it('should modify metadata', () => {
    const msg = new BenthosMessage('test', { 'key': 'original' })
    const ast = parse('root = .; meta("key") = "modified"')
    console.log('AST:', JSON.stringify(ast, null, 2))

    const interp = new Interpreter(msg)
    const result = interp.evaluate(ast)
    console.log('Result:', result)
    console.log('Metadata key:', msg.metadata.get('key'))
    console.log('Root:', msg.root)
    expect(msg.metadata.get('key')).toBe('modified')
  })
})
