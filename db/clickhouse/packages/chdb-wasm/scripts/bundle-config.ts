#!/usr/bin/env tsx
/**
 * WASM Module Bundler for chdb-wasm
 *
 * Combines WASM side modules into deployable configurations.
 *
 * Usage:
 *   npx tsx scripts/bundle-config.ts <config-name>
 *   npx tsx scripts/bundle-config.ts --all
 *   npx tsx scripts/bundle-config.ts --analyze <config-name>
 *   npx tsx scripts/bundle-config.ts --list
 *
 * Examples:
 *   npx tsx scripts/bundle-config.ts chdb-fetch
 *   npx tsx scripts/bundle-config.ts chdb-lake --verbose
 *   npx tsx scripts/bundle-config.ts --all
 *   npx tsx scripts/bundle-config.ts --analyze chdb-state
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, createReadStream } from 'fs';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

// Types for config file
interface ModuleDefinition {
  description: string;
  files: string[];
  required: boolean;
  estimatedSize: string;
  planned?: boolean;
}

interface TargetSize {
  min: string;
  max: string;
  unit: string;
}

interface BundleConfig {
  description: string;
  modules: string[];
  targetSize: TargetSize;
  useCase: string;
  cloudflareCompatible: boolean;
  durableObjectsOptimized?: boolean;
}

interface ConfigFile {
  modules: Record<string, ModuleDefinition>;
  configs: Record<string, BundleConfig>;
  wasmDistDir: string;
  outputDir: string;
  defaults: {
    compression: string;
    includeSourceMaps: boolean;
    generateTypes: boolean;
  };
}

interface BundleResult {
  configName: string;
  modules: string[];
  files: FileInfo[];
  totalSize: number;
  gzippedSize: number;
  targetSize: TargetSize;
  withinTarget: boolean;
  outputPath: string;
  timestamp: string;
}

interface FileInfo {
  name: string;
  path: string;
  size: number;
  gzippedSize: number;
  exists: boolean;
  module: string;
}

interface ModuleSizeInfo {
  name: string;
  wasmSize: number;
  jsSize: number;
  totalSize: number;
  gzippedWasmSize: number;
  gzippedJsSize: number;
  gzippedTotalSize: number;
  exists: boolean;
  planned: boolean;
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// Configuration
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'configs', 'configs.json');

// Utility functions
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  switch (unit) {
    case 'B':
      return value;
    case 'KB':
      return value * 1024;
    case 'MB':
      return value * 1024 * 1024;
    case 'GB':
      return value * 1024 * 1024 * 1024;
    default:
      return 0;
  }
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

async function getGzippedSize(filePath: string): Promise<number> {
  try {
    const content = await fs.readFile(filePath);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gzip = createGzip({ level: 9 });

      gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
      gzip.on('end', () => resolve(Buffer.concat(chunks).length));
      gzip.on('error', reject);

      gzip.write(content);
      gzip.end();
    });
  } catch {
    return 0;
  }
}

async function loadConfig(): Promise<ConfigFile> {
  const content = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(content) as ConfigFile;
}

function log(message: string): void {
  console.log(message);
}

function logError(message: string): void {
  console.error(`${colors.red}Error:${colors.reset} ${message}`);
}

function logSuccess(message: string): void {
  console.log(`${colors.green}Success:${colors.reset} ${message}`);
}

function logWarning(message: string): void {
  console.log(`${colors.yellow}Warning:${colors.reset} ${message}`);
}

function logInfo(message: string): void {
  console.log(`${colors.cyan}Info:${colors.reset} ${message}`);
}

// List available configs
async function listConfigs(): Promise<void> {
  const config = await loadConfig();

  log(`\n${colors.bold}${colors.cyan}Available Bundle Configurations${colors.reset}\n`);
  log('=' .repeat(60));

  for (const [name, bundleConfig] of Object.entries(config.configs)) {
    log(`\n${colors.bold}${name}${colors.reset}`);
    log(`  ${colors.gray}${bundleConfig.description}${colors.reset}`);
    log(`  Modules: ${bundleConfig.modules.join(', ')}`);
    log(`  Target: ${bundleConfig.targetSize.min} - ${bundleConfig.targetSize.max} (${bundleConfig.targetSize.unit})`);
    log(`  Use case: ${bundleConfig.useCase}`);
    if (bundleConfig.durableObjectsOptimized) {
      log(`  ${colors.green}Durable Objects optimized${colors.reset}`);
    }
  }

  log('\n' + '='.repeat(60));
  log(`\n${colors.gray}Use: npx tsx scripts/bundle-config.ts <config-name>${colors.reset}\n`);
}

// List available modules
async function listModules(): Promise<void> {
  const config = await loadConfig();
  const wasmDir = path.resolve(PROJECT_ROOT, config.wasmDistDir);

  log(`\n${colors.bold}${colors.cyan}Available WASM Modules${colors.reset}\n`);
  log('='.repeat(60));

  for (const [name, moduleDef] of Object.entries(config.modules)) {
    const status = moduleDef.planned
      ? `${colors.yellow}[PLANNED]${colors.reset}`
      : moduleDef.required
        ? `${colors.green}[REQUIRED]${colors.reset}`
        : `${colors.blue}[OPTIONAL]${colors.reset}`;

    log(`\n${colors.bold}${name}${colors.reset} ${status}`);
    log(`  ${colors.gray}${moduleDef.description}${colors.reset}`);
    log(`  Estimated size: ${moduleDef.estimatedSize}`);

    // Check if files exist
    for (const file of moduleDef.files) {
      const filePath = path.join(wasmDir, file);
      const exists = existsSync(filePath);
      const existsIcon = exists ? colors.green + 'exists' : colors.red + 'missing';
      log(`    - ${file}: ${existsIcon}${colors.reset}`);
    }
  }

  log('\n' + '='.repeat(60) + '\n');
}

// Analyze module sizes
async function analyzeModuleSizes(config: ConfigFile): Promise<ModuleSizeInfo[]> {
  const wasmDir = path.resolve(PROJECT_ROOT, config.wasmDistDir);
  const results: ModuleSizeInfo[] = [];

  for (const [name, moduleDef] of Object.entries(config.modules)) {
    let wasmSize = 0;
    let jsSize = 0;
    let gzippedWasmSize = 0;
    let gzippedJsSize = 0;
    let exists = false;

    for (const file of moduleDef.files) {
      const filePath = path.join(wasmDir, file);
      if (existsSync(filePath)) {
        exists = true;
        const size = await getFileSize(filePath);
        const gzippedSize = await getGzippedSize(filePath);

        if (file.endsWith('.wasm')) {
          wasmSize += size;
          gzippedWasmSize += gzippedSize;
        } else if (file.endsWith('.js')) {
          jsSize += size;
          gzippedJsSize += gzippedSize;
        }
      }
    }

    results.push({
      name,
      wasmSize,
      jsSize,
      totalSize: wasmSize + jsSize,
      gzippedWasmSize,
      gzippedJsSize,
      gzippedTotalSize: gzippedWasmSize + gzippedJsSize,
      exists,
      planned: moduleDef.planned ?? false,
    });
  }

  return results;
}

// Analyze a specific config
async function analyzeConfig(configName: string, verbose = false): Promise<void> {
  const config = await loadConfig();

  if (!config.configs[configName]) {
    logError(`Unknown config: ${configName}`);
    log(`Available configs: ${Object.keys(config.configs).join(', ')}`);
    process.exit(1);
  }

  const bundleConfig = config.configs[configName];
  const moduleSizes = await analyzeModuleSizes(config);

  log(`\n${colors.bold}${colors.cyan}Bundle Analysis: ${configName}${colors.reset}\n`);
  log('='.repeat(60));
  log(`Description: ${bundleConfig.description}`);
  log(`Target size: ${bundleConfig.targetSize.min} - ${bundleConfig.targetSize.max} (${bundleConfig.targetSize.unit})`);
  log('');

  // Calculate total sizes
  let totalWasm = 0;
  let totalJs = 0;
  let totalGzippedWasm = 0;
  let totalGzippedJs = 0;
  let missingModules: string[] = [];
  let plannedModules: string[] = [];

  log(`${colors.bold}Module Breakdown:${colors.reset}\n`);
  log(`${'Module'.padEnd(15)} ${'WASM'.padStart(10)} ${'JS'.padStart(10)} ${'Total'.padStart(10)} ${'Gzipped'.padStart(10)} Status`);
  log('-'.repeat(70));

  for (const moduleName of bundleConfig.modules) {
    const moduleInfo = moduleSizes.find((m) => m.name === moduleName);
    const moduleDef = config.modules[moduleName];

    if (!moduleInfo) {
      missingModules.push(moduleName);
      log(`${moduleName.padEnd(15)} ${'-'.padStart(10)} ${'-'.padStart(10)} ${'-'.padStart(10)} ${'-'.padStart(10)} ${colors.red}NOT FOUND${colors.reset}`);
      continue;
    }

    if (moduleInfo.planned) {
      plannedModules.push(moduleName);
      log(`${moduleName.padEnd(15)} ${formatBytes(parseSize(moduleDef.estimatedSize)).padStart(10)} ${'-'.padStart(10)} ${formatBytes(parseSize(moduleDef.estimatedSize)).padStart(10)} ${'-'.padStart(10)} ${colors.yellow}PLANNED${colors.reset}`);
      continue;
    }

    if (!moduleInfo.exists) {
      missingModules.push(moduleName);
      log(`${moduleName.padEnd(15)} ${'-'.padStart(10)} ${'-'.padStart(10)} ${'-'.padStart(10)} ${'-'.padStart(10)} ${colors.red}MISSING${colors.reset}`);
      continue;
    }

    totalWasm += moduleInfo.wasmSize;
    totalJs += moduleInfo.jsSize;
    totalGzippedWasm += moduleInfo.gzippedWasmSize;
    totalGzippedJs += moduleInfo.gzippedJsSize;

    log(
      `${moduleName.padEnd(15)} ${formatBytes(moduleInfo.wasmSize).padStart(10)} ${formatBytes(moduleInfo.jsSize).padStart(10)} ${formatBytes(moduleInfo.totalSize).padStart(10)} ${formatBytes(moduleInfo.gzippedTotalSize).padStart(10)} ${colors.green}OK${colors.reset}`
    );
  }

  log('-'.repeat(70));
  log(
    `${'TOTAL'.padEnd(15)} ${formatBytes(totalWasm).padStart(10)} ${formatBytes(totalJs).padStart(10)} ${formatBytes(totalWasm + totalJs).padStart(10)} ${formatBytes(totalGzippedWasm + totalGzippedJs).padStart(10)}`
  );

  // Target comparison
  log('\n' + colors.bold + 'Target Comparison:' + colors.reset + '\n');

  const minTarget = parseSize(bundleConfig.targetSize.min);
  const maxTarget = parseSize(bundleConfig.targetSize.max);
  const actualGzipped = totalGzippedWasm + totalGzippedJs;

  if (actualGzipped < minTarget) {
    log(`${colors.green}UNDER TARGET${colors.reset} - Actual: ${formatBytes(actualGzipped)} < Min: ${bundleConfig.targetSize.min}`);
  } else if (actualGzipped <= maxTarget) {
    log(`${colors.green}WITHIN TARGET${colors.reset} - Actual: ${formatBytes(actualGzipped)} (${bundleConfig.targetSize.min} - ${bundleConfig.targetSize.max})`);
  } else {
    const over = actualGzipped - maxTarget;
    log(`${colors.red}OVER TARGET${colors.reset} - Actual: ${formatBytes(actualGzipped)} exceeds ${bundleConfig.targetSize.max} by ${formatBytes(over)}`);
  }

  // Warnings
  if (missingModules.length > 0) {
    log(`\n${colors.yellow}Missing modules:${colors.reset} ${missingModules.join(', ')}`);
  }
  if (plannedModules.length > 0) {
    log(`${colors.yellow}Planned modules (not yet built):${colors.reset} ${plannedModules.join(', ')}`);
  }

  log('\n' + '='.repeat(60) + '\n');
}

// Bundle a config
async function bundleConfig(configName: string, verbose = false): Promise<BundleResult> {
  const config = await loadConfig();

  if (!config.configs[configName]) {
    logError(`Unknown config: ${configName}`);
    log(`Available configs: ${Object.keys(config.configs).join(', ')}`);
    process.exit(1);
  }

  const bundleConfig = config.configs[configName];
  const wasmDir = path.resolve(PROJECT_ROOT, config.wasmDistDir);
  const outputDir = path.resolve(PROJECT_ROOT, config.outputDir, configName);

  log(`\n${colors.bold}${colors.cyan}Bundling: ${configName}${colors.reset}\n`);
  log('='.repeat(60));

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  const files: FileInfo[] = [];
  let totalSize = 0;
  let gzippedSize = 0;
  const copiedFiles: string[] = [];
  const missingFiles: string[] = [];

  // Copy files for each module
  for (const moduleName of bundleConfig.modules) {
    const moduleDef = config.modules[moduleName];
    if (!moduleDef) {
      logWarning(`Module definition not found: ${moduleName}`);
      continue;
    }

    if (moduleDef.planned) {
      if (verbose) {
        logInfo(`Skipping planned module: ${moduleName}`);
      }
      continue;
    }

    for (const fileName of moduleDef.files) {
      const srcPath = path.join(wasmDir, fileName);
      const destPath = path.join(outputDir, fileName);

      if (!existsSync(srcPath)) {
        missingFiles.push(fileName);
        files.push({
          name: fileName,
          path: srcPath,
          size: 0,
          gzippedSize: 0,
          exists: false,
          module: moduleName,
        });
        continue;
      }

      // Copy file
      await fs.copyFile(srcPath, destPath);
      copiedFiles.push(fileName);

      const size = await getFileSize(srcPath);
      const gzipped = await getGzippedSize(srcPath);
      totalSize += size;
      gzippedSize += gzipped;

      files.push({
        name: fileName,
        path: destPath,
        size,
        gzippedSize: gzipped,
        exists: true,
        module: moduleName,
      });

      if (verbose) {
        log(`  Copied: ${fileName} (${formatBytes(size)}, ${formatBytes(gzipped)} gzipped)`);
      }
    }
  }

  // Generate bundle manifest
  const manifest = {
    name: configName,
    description: bundleConfig.description,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    modules: bundleConfig.modules,
    files: files.filter((f) => f.exists).map((f) => ({
      name: f.name,
      module: f.module,
      size: f.size,
      gzippedSize: f.gzippedSize,
    })),
    totalSize,
    gzippedSize,
    targetSize: bundleConfig.targetSize,
    cloudflareCompatible: bundleConfig.cloudflareCompatible,
    useCase: bundleConfig.useCase,
  };

  await fs.writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Generate index.js entry point
  const indexJs = generateIndexJs(configName, bundleConfig, files.filter((f) => f.exists));
  await fs.writeFile(path.join(outputDir, 'index.js'), indexJs);

  // Generate TypeScript declaration
  const indexDts = generateIndexDts(configName, bundleConfig);
  await fs.writeFile(path.join(outputDir, 'index.d.ts'), indexDts);

  // Check if within target
  const minTarget = parseSize(bundleConfig.targetSize.min);
  const maxTarget = parseSize(bundleConfig.targetSize.max);
  const withinTarget = gzippedSize >= minTarget && gzippedSize <= maxTarget;

  // Log results
  log('\n' + colors.bold + 'Bundle Summary:' + colors.reset);
  log(`  Files copied: ${copiedFiles.length}`);
  log(`  Total size: ${formatBytes(totalSize)}`);
  log(`  Gzipped size: ${formatBytes(gzippedSize)}`);
  log(`  Output: ${outputDir}`);

  if (missingFiles.length > 0) {
    logWarning(`Missing files: ${missingFiles.join(', ')}`);
  }

  if (gzippedSize < minTarget) {
    logSuccess(`Under target (${formatBytes(gzippedSize)} < ${bundleConfig.targetSize.min})`);
  } else if (withinTarget) {
    logSuccess(`Within target (${bundleConfig.targetSize.min} - ${bundleConfig.targetSize.max})`);
  } else {
    logError(`Over target (${formatBytes(gzippedSize)} > ${bundleConfig.targetSize.max})`);
  }

  log('\n' + '='.repeat(60) + '\n');

  return {
    configName,
    modules: bundleConfig.modules,
    files,
    totalSize,
    gzippedSize,
    targetSize: bundleConfig.targetSize,
    withinTarget,
    outputPath: outputDir,
    timestamp: new Date().toISOString(),
  };
}

// Generate index.js entry point for bundle
function generateIndexJs(configName: string, bundleConfig: BundleConfig, files: FileInfo[]): string {
  const wasmFiles = files.filter((f) => f.name.endsWith('.wasm'));
  const jsFiles = files.filter((f) => f.name.endsWith('.js'));

  let code = `/**
 * ${configName} - ${bundleConfig.description}
 *
 * Auto-generated bundle entry point.
 * Target size: ${bundleConfig.targetSize.min} - ${bundleConfig.targetSize.max}
 *
 * @generated
 */

// Module imports
`;

  // Import JS modules
  for (const file of jsFiles) {
    const moduleName = file.name.replace('.js', '');
    code += `import * as ${moduleName}Module from './${file.name}';\n`;
  }

  code += `
// Export modules
export const modules = {
`;

  for (const file of jsFiles) {
    const moduleName = file.name.replace('.js', '');
    code += `  ${moduleName}: ${moduleName}Module,\n`;
  }

  code += `};

// Bundle metadata
export const bundleInfo = {
  name: '${configName}',
  description: '${bundleConfig.description}',
  modules: ${JSON.stringify(bundleConfig.modules)},
  targetSize: ${JSON.stringify(bundleConfig.targetSize)},
  cloudflareCompatible: ${bundleConfig.cloudflareCompatible},
  useCase: '${bundleConfig.useCase}',
};

// WASM file list
export const wasmFiles = ${JSON.stringify(wasmFiles.map((f) => f.name))};

// Default export
export default {
  modules,
  bundleInfo,
  wasmFiles,
};
`;

  return code;
}

// Generate index.d.ts for bundle
function generateIndexDts(configName: string, bundleConfig: BundleConfig): string {
  return `/**
 * ${configName} - ${bundleConfig.description}
 *
 * Auto-generated TypeScript declarations.
 *
 * @generated
 */

export interface BundleInfo {
  name: string;
  description: string;
  modules: string[];
  targetSize: {
    min: string;
    max: string;
    unit: string;
  };
  cloudflareCompatible: boolean;
  useCase: string;
}

export declare const modules: Record<string, unknown>;
export declare const bundleInfo: BundleInfo;
export declare const wasmFiles: string[];

declare const _default: {
  modules: Record<string, unknown>;
  bundleInfo: BundleInfo;
  wasmFiles: string[];
};

export default _default;
`;
}

// Bundle all configs
async function bundleAll(verbose = false): Promise<void> {
  const config = await loadConfig();
  const results: BundleResult[] = [];

  log(`\n${colors.bold}${colors.cyan}Bundling All Configurations${colors.reset}\n`);
  log('='.repeat(60));

  for (const configName of Object.keys(config.configs)) {
    try {
      const result = await bundleConfig(configName, verbose);
      results.push(result);
    } catch (error) {
      logError(`Failed to bundle ${configName}: ${error}`);
    }
  }

  // Summary
  log(`\n${colors.bold}${colors.cyan}Bundle Summary${colors.reset}\n`);
  log('='.repeat(60));

  log(`\n${'Config'.padEnd(20)} ${'Total'.padStart(12)} ${'Gzipped'.padStart(12)} ${'Target'.padStart(15)} ${'Status'.padStart(10)}`);
  log('-'.repeat(75));

  for (const result of results) {
    const status = result.withinTarget
      ? `${colors.green}OK${colors.reset}`
      : `${colors.red}OVER${colors.reset}`;

    log(
      `${result.configName.padEnd(20)} ${formatBytes(result.totalSize).padStart(12)} ${formatBytes(result.gzippedSize).padStart(12)} ${(result.targetSize.min + '-' + result.targetSize.max).padStart(15)} ${status.padStart(10)}`
    );
  }

  log('\n' + '='.repeat(60) + '\n');
}

// Show overall size analysis
async function showSizeAnalysis(): Promise<void> {
  const config = await loadConfig();
  const moduleSizes = await analyzeModuleSizes(config);

  log(`\n${colors.bold}${colors.cyan}WASM Module Size Analysis${colors.reset}\n`);
  log('='.repeat(80));

  log(`\n${'Module'.padEnd(15)} ${'WASM'.padStart(12)} ${'JS'.padStart(12)} ${'Total'.padStart(12)} ${'Gzipped'.padStart(12)} ${'Status'.padStart(12)}`);
  log('-'.repeat(80));

  let totalWasm = 0;
  let totalJs = 0;
  let totalGzipped = 0;

  // Sort by size
  const sortedModules = [...moduleSizes].sort((a, b) => b.gzippedTotalSize - a.gzippedTotalSize);

  for (const mod of sortedModules) {
    let status: string;
    if (mod.planned) {
      status = `${colors.yellow}PLANNED${colors.reset}`;
    } else if (mod.exists) {
      status = `${colors.green}OK${colors.reset}`;
      totalWasm += mod.wasmSize;
      totalJs += mod.jsSize;
      totalGzipped += mod.gzippedTotalSize;
    } else {
      status = `${colors.red}MISSING${colors.reset}`;
    }

    log(
      `${mod.name.padEnd(15)} ${formatBytes(mod.wasmSize).padStart(12)} ${formatBytes(mod.jsSize).padStart(12)} ${formatBytes(mod.totalSize).padStart(12)} ${formatBytes(mod.gzippedTotalSize).padStart(12)} ${status.padStart(12)}`
    );
  }

  log('-'.repeat(80));
  log(
    `${'TOTAL'.padEnd(15)} ${formatBytes(totalWasm).padStart(12)} ${formatBytes(totalJs).padStart(12)} ${formatBytes(totalWasm + totalJs).padStart(12)} ${formatBytes(totalGzipped).padStart(12)}`
  );

  // Show bundle sizes
  log(`\n${colors.bold}Bundle Size Estimates:${colors.reset}\n`);

  for (const [configName, bundleConfig] of Object.entries(config.configs)) {
    let bundleGzipped = 0;
    let hasAllModules = true;

    for (const moduleName of bundleConfig.modules) {
      const mod = moduleSizes.find((m) => m.name === moduleName);
      if (mod && mod.exists) {
        bundleGzipped += mod.gzippedTotalSize;
      } else if (mod && mod.planned) {
        const def = config.modules[moduleName];
        bundleGzipped += parseSize(def.estimatedSize);
      } else {
        hasAllModules = false;
      }
    }

    const minTarget = parseSize(bundleConfig.targetSize.min);
    const maxTarget = parseSize(bundleConfig.targetSize.max);
    let targetStatus: string;

    if (!hasAllModules) {
      targetStatus = `${colors.yellow}INCOMPLETE${colors.reset}`;
    } else if (bundleGzipped < minTarget) {
      targetStatus = `${colors.green}UNDER${colors.reset}`;
    } else if (bundleGzipped <= maxTarget) {
      targetStatus = `${colors.green}OK${colors.reset}`;
    } else {
      targetStatus = `${colors.red}OVER${colors.reset}`;
    }

    log(`  ${configName.padEnd(15)} ${formatBytes(bundleGzipped).padStart(10)} / ${bundleConfig.targetSize.max.padEnd(6)} ${targetStatus}`);
  }

  log('\n' + '='.repeat(80) + '\n');
}

// Main CLI
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    log(`
${colors.bold}WASM Module Bundler for chdb-wasm${colors.reset}

Usage:
  npx tsx scripts/bundle-config.ts <config-name>    Bundle a specific config
  npx tsx scripts/bundle-config.ts --all            Bundle all configs
  npx tsx scripts/bundle-config.ts --analyze <name> Analyze a config's size
  npx tsx scripts/bundle-config.ts --list           List available configs
  npx tsx scripts/bundle-config.ts --modules        List available modules
  npx tsx scripts/bundle-config.ts --sizes          Show size analysis

Options:
  -v, --verbose    Show detailed output
  -h, --help       Show this help message

Examples:
  npx tsx scripts/bundle-config.ts chdb-fetch
  npx tsx scripts/bundle-config.ts chdb-lake --verbose
  npx tsx scripts/bundle-config.ts --all
  npx tsx scripts/bundle-config.ts --analyze chdb-state
`);
    process.exit(0);
  }

  const verbose = args.includes('--verbose') || args.includes('-v');

  if (args.includes('--list')) {
    await listConfigs();
  } else if (args.includes('--modules')) {
    await listModules();
  } else if (args.includes('--sizes') || args.includes('--analyze') && args.length === 1) {
    await showSizeAnalysis();
  } else if (args.includes('--analyze')) {
    const analyzeIndex = args.indexOf('--analyze');
    const configName = args[analyzeIndex + 1];
    if (!configName || configName.startsWith('-')) {
      logError('Please specify a config name to analyze');
      process.exit(1);
    }
    await analyzeConfig(configName, verbose);
  } else if (args.includes('--all')) {
    await bundleAll(verbose);
  } else {
    // First non-flag argument is the config name
    const configName = args.find((arg) => !arg.startsWith('-'));
    if (configName) {
      await bundleConfig(configName, verbose);
    } else {
      logError('Please specify a config name or use --all');
      process.exit(1);
    }
  }
}

main().catch((error) => {
  logError(String(error));
  process.exit(1);
});
