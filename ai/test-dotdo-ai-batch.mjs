try {
  console.log('Attempting to import batching utilities from @dotdo/ai...')
  const mod = await import('./index.ts')
  
  const batchExports = [
    'BatchQueue',
    'BatchMapPromise',
    'createBatch',
    'createBatchMap',
    'deferToBatch',
    'getBatchAdapter',
    'registerBatchAdapter',
    'isBatchMode',
    'isBatchMapPromise',
    'withBatchQueue',
    'BATCH_MODE_SYMBOL',
    'BATCH_MAP_SYMBOL'
  ]
  
  console.log('Checking if batching utilities are exported...')
  const available = batchExports.filter(name => name in mod)
  const missing = batchExports.filter(name => !(name in mod))
  
  console.log(`✓ Available (${available.length}/${batchExports.length}):`)
  available.forEach(name => console.log(`  - ${name}`))
  
  if (missing.length > 0) {
    console.log(`✗ Missing (${missing.length}/${batchExports.length}):`)
    missing.forEach(name => console.log(`  - ${name}`))
  } else {
    console.log('✓ All batching utilities are successfully exported!')
  }
} catch (e) {
  console.error('Error:', e.message)
  process.exit(1)
}
