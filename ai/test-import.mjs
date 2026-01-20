try {
  console.log('Attempting to import ai-functions...')
  const mod = await import('ai-functions')
  console.log('Success! Available exports:')
  console.log(Object.keys(mod).filter(k => k.includes('Batch') || k.includes('batch')))
} catch (e) {
  console.error('Import failed:', e.message)
}
