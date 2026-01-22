#!/usr/bin/env tsx
/**
 * Bundle Size Analyzer for chdb-wasm
 *
 * Provides detailed size analysis and reporting for WASM bundles.
 *
 * Usage:
 *   npx tsx scripts/analyze-bundles.ts              Show all sizes
 *   npx tsx scripts/analyze-bundles.ts --json       Output as JSON
 *   npx tsx scripts/analyze-bundles.ts --markdown   Output as Markdown
 *   npx tsx scripts/analyze-bundles.ts --compare    Compare configs
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { createGzip } from 'zlib';

// Types
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
}

interface ConfigFile {
  modules: Record<string, ModuleDefinition>;
  configs: Record<string, BundleConfig>;
  wasmDistDir: string;
  outputDir: string;
}

interface ModuleSize {
  name: string;
  description: string;
  wasmSize: number;
  jsSize: number;
  totalSize: number;
  gzippedWasm: number;
  gzippedJs: number;
  gzippedTotal: number;
  estimatedSize: number;
  exists: boolean;
  planned: boolean;
  compressionRatio: number;
}

interface BundleSizeReport {
  name: string;
  description: string;
  modules: string[];
  sizes: {
    raw: number;
    gzipped: number;
    estimated: number;
  };
  target: {
    min: number;
    max: number;
    status: 'under' | 'within' | 'over' | 'incomplete';
    percentOfMax: number;
  };
  moduleBreakdown: ModuleSize[];
  missingModules: string[];
  plannedModules: string[];
}

interface FullReport {
  timestamp: string;
  modules: ModuleSize[];
  bundles: BundleSizeReport[];
  totals: {
    availableModules: number;
    plannedModules: number;
    totalWasmSize: number;
    totalGzippedSize: number;
  };
}

// Colors
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

// Utilities
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';
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
    case 'B': return value;
    case 'KB': return value * 1024;
    case 'MB': return value * 1024 * 1024;
    case 'GB': return value * 1024 * 1024 * 1024;
    default: return 0;
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
  return JSON.parse(content);
}

// Analysis functions
async function analyzeModule(
  name: string,
  def: ModuleDefinition,
  wasmDir: string
): Promise<ModuleSize> {
  let wasmSize = 0;
  let jsSize = 0;
  let gzippedWasm = 0;
  let gzippedJs = 0;
  let exists = false;

  if (!def.planned) {
    for (const file of def.files) {
      const filePath = path.join(wasmDir, file);
      if (existsSync(filePath)) {
        exists = true;
        const size = await getFileSize(filePath);
        const gzipped = await getGzippedSize(filePath);

        if (file.endsWith('.wasm')) {
          wasmSize += size;
          gzippedWasm += gzipped;
        } else if (file.endsWith('.js')) {
          jsSize += size;
          gzippedJs += gzipped;
        }
      }
    }
  }

  const totalSize = wasmSize + jsSize;
  const gzippedTotal = gzippedWasm + gzippedJs;
  const estimatedSize = parseSize(def.estimatedSize);

  return {
    name,
    description: def.description,
    wasmSize,
    jsSize,
    totalSize,
    gzippedWasm,
    gzippedJs,
    gzippedTotal,
    estimatedSize,
    exists,
    planned: def.planned ?? false,
    compressionRatio: totalSize > 0 ? gzippedTotal / totalSize : 0,
  };
}

async function analyzeBundles(): Promise<FullReport> {
  const config = await loadConfig();
  const wasmDir = path.resolve(PROJECT_ROOT, config.wasmDistDir);

  // Analyze all modules
  const modules: ModuleSize[] = [];
  for (const [name, def] of Object.entries(config.modules)) {
    const moduleSize = await analyzeModule(name, def, wasmDir);
    modules.push(moduleSize);
  }

  // Analyze all bundle configs
  const bundles: BundleSizeReport[] = [];

  for (const [configName, bundleConfig] of Object.entries(config.configs)) {
    const moduleBreakdown: ModuleSize[] = [];
    const missingModules: string[] = [];
    const plannedModules: string[] = [];

    let rawSize = 0;
    let gzippedSize = 0;
    let estimatedSize = 0;

    for (const moduleName of bundleConfig.modules) {
      const mod = modules.find((m) => m.name === moduleName);
      if (!mod) {
        missingModules.push(moduleName);
        continue;
      }

      moduleBreakdown.push(mod);

      if (mod.planned) {
        plannedModules.push(moduleName);
        estimatedSize += mod.estimatedSize;
      } else if (mod.exists) {
        rawSize += mod.totalSize;
        gzippedSize += mod.gzippedTotal;
        estimatedSize += mod.gzippedTotal; // Use actual gzipped for existing
      } else {
        missingModules.push(moduleName);
      }
    }

    const minTarget = parseSize(bundleConfig.targetSize.min);
    const maxTarget = parseSize(bundleConfig.targetSize.max);

    let status: 'under' | 'within' | 'over' | 'incomplete';
    if (missingModules.length > 0 || plannedModules.length > 0) {
      status = 'incomplete';
    } else if (gzippedSize < minTarget) {
      status = 'under';
    } else if (gzippedSize <= maxTarget) {
      status = 'within';
    } else {
      status = 'over';
    }

    bundles.push({
      name: configName,
      description: bundleConfig.description,
      modules: bundleConfig.modules,
      sizes: {
        raw: rawSize,
        gzipped: gzippedSize,
        estimated: estimatedSize,
      },
      target: {
        min: minTarget,
        max: maxTarget,
        status,
        percentOfMax: maxTarget > 0 ? (gzippedSize / maxTarget) * 100 : 0,
      },
      moduleBreakdown,
      missingModules,
      plannedModules,
    });
  }

  // Calculate totals
  const availableModules = modules.filter((m) => m.exists).length;
  const plannedModulesCount = modules.filter((m) => m.planned).length;
  const totalWasmSize = modules.reduce((sum, m) => sum + m.wasmSize, 0);
  const totalGzippedSize = modules.reduce((sum, m) => sum + m.gzippedTotal, 0);

  return {
    timestamp: new Date().toISOString(),
    modules,
    bundles,
    totals: {
      availableModules,
      plannedModules: plannedModulesCount,
      totalWasmSize,
      totalGzippedSize,
    },
  };
}

// Output formatters
function formatConsole(report: FullReport): void {
  console.log(`\n${colors.bold}${colors.cyan}=== WASM Bundle Size Analysis ===${colors.reset}\n`);
  console.log(`Timestamp: ${report.timestamp}\n`);

  // Module summary
  console.log(`${colors.bold}Module Summary${colors.reset}`);
  console.log('─'.repeat(90));
  console.log(
    `${'Module'.padEnd(15)} ${'WASM'.padStart(10)} ${'JS'.padStart(10)} ${'Total'.padStart(10)} ${'Gzipped'.padStart(10)} ${'Ratio'.padStart(8)} ${'Status'.padStart(12)}`
  );
  console.log('─'.repeat(90));

  for (const mod of report.modules.sort((a, b) => b.gzippedTotal - a.gzippedTotal)) {
    let status: string;
    if (mod.planned) {
      status = `${colors.yellow}PLANNED${colors.reset}`;
    } else if (mod.exists) {
      status = `${colors.green}OK${colors.reset}`;
    } else {
      status = `${colors.red}MISSING${colors.reset}`;
    }

    const ratio = mod.compressionRatio > 0
      ? `${(mod.compressionRatio * 100).toFixed(1)}%`
      : '-';

    console.log(
      `${mod.name.padEnd(15)} ${formatBytes(mod.wasmSize).padStart(10)} ${formatBytes(mod.jsSize).padStart(10)} ${formatBytes(mod.totalSize).padStart(10)} ${formatBytes(mod.gzippedTotal).padStart(10)} ${ratio.padStart(8)} ${status.padStart(12)}`
    );
  }

  console.log('─'.repeat(90));
  console.log(
    `${'TOTAL'.padEnd(15)} ${formatBytes(report.totals.totalWasmSize).padStart(10)} ${'-'.padStart(10)} ${formatBytes(report.totals.totalWasmSize).padStart(10)} ${formatBytes(report.totals.totalGzippedSize).padStart(10)}`
  );

  // Bundle summary
  console.log(`\n${colors.bold}Bundle Configurations${colors.reset}`);
  console.log('─'.repeat(90));
  console.log(
    `${'Bundle'.padEnd(18)} ${'Raw'.padStart(10)} ${'Gzipped'.padStart(10)} ${'Target'.padStart(15)} ${'%'.padStart(8)} ${'Status'.padStart(12)}`
  );
  console.log('─'.repeat(90));

  for (const bundle of report.bundles) {
    let statusStr: string;
    switch (bundle.target.status) {
      case 'under':
        statusStr = `${colors.green}UNDER${colors.reset}`;
        break;
      case 'within':
        statusStr = `${colors.green}OK${colors.reset}`;
        break;
      case 'over':
        statusStr = `${colors.red}OVER${colors.reset}`;
        break;
      case 'incomplete':
        statusStr = `${colors.yellow}INCOMPLETE${colors.reset}`;
        break;
    }

    const targetRange = `${formatBytes(bundle.target.min)}-${formatBytes(bundle.target.max)}`;

    console.log(
      `${bundle.name.padEnd(18)} ${formatBytes(bundle.sizes.raw).padStart(10)} ${formatBytes(bundle.sizes.gzipped).padStart(10)} ${targetRange.padStart(15)} ${bundle.target.percentOfMax.toFixed(1).padStart(7)}% ${statusStr.padStart(12)}`
    );
  }

  console.log('─'.repeat(90));

  // Detailed breakdown per bundle
  console.log(`\n${colors.bold}Detailed Bundle Breakdown${colors.reset}\n`);

  for (const bundle of report.bundles) {
    console.log(`${colors.cyan}${bundle.name}${colors.reset}: ${bundle.description}`);
    console.log(`  Modules: ${bundle.modules.join(', ')}`);

    if (bundle.missingModules.length > 0) {
      console.log(`  ${colors.red}Missing: ${bundle.missingModules.join(', ')}${colors.reset}`);
    }
    if (bundle.plannedModules.length > 0) {
      console.log(`  ${colors.yellow}Planned: ${bundle.plannedModules.join(', ')}${colors.reset}`);
    }

    // Size breakdown
    const existingModules = bundle.moduleBreakdown.filter((m) => m.exists && !m.planned);
    if (existingModules.length > 0) {
      console.log('  Size breakdown:');
      for (const mod of existingModules.sort((a, b) => b.gzippedTotal - a.gzippedTotal)) {
        const pct = bundle.sizes.gzipped > 0
          ? ((mod.gzippedTotal / bundle.sizes.gzipped) * 100).toFixed(1)
          : '0';
        console.log(`    ${mod.name}: ${formatBytes(mod.gzippedTotal)} (${pct}%)`);
      }
    }

    console.log('');
  }

  // Summary stats
  console.log(`${colors.bold}Summary${colors.reset}`);
  console.log(`  Available modules: ${report.totals.availableModules}`);
  console.log(`  Planned modules: ${report.totals.plannedModules}`);
  console.log(`  Total WASM size: ${formatBytes(report.totals.totalWasmSize)}`);
  console.log(`  Total gzipped: ${formatBytes(report.totals.totalGzippedSize)}`);
  console.log('');
}

function formatJson(report: FullReport): void {
  console.log(JSON.stringify(report, null, 2));
}

function formatMarkdown(report: FullReport): void {
  console.log('# WASM Bundle Size Analysis\n');
  console.log(`*Generated: ${report.timestamp}*\n`);

  // Module table
  console.log('## Modules\n');
  console.log('| Module | WASM | JS | Total | Gzipped | Status |');
  console.log('|--------|------|-------|-------|---------|--------|');

  for (const mod of report.modules.sort((a, b) => b.gzippedTotal - a.gzippedTotal)) {
    const status = mod.planned ? 'Planned' : mod.exists ? 'OK' : 'Missing';
    console.log(
      `| ${mod.name} | ${formatBytes(mod.wasmSize)} | ${formatBytes(mod.jsSize)} | ${formatBytes(mod.totalSize)} | ${formatBytes(mod.gzippedTotal)} | ${status} |`
    );
  }

  console.log(`| **TOTAL** | **${formatBytes(report.totals.totalWasmSize)}** | - | - | **${formatBytes(report.totals.totalGzippedSize)}** | |`);

  // Bundle table
  console.log('\n## Bundle Configurations\n');
  console.log('| Bundle | Raw | Gzipped | Target | % of Max | Status |');
  console.log('|--------|-----|---------|--------|----------|--------|');

  for (const bundle of report.bundles) {
    const targetRange = `${formatBytes(bundle.target.min)}-${formatBytes(bundle.target.max)}`;
    const status = bundle.target.status.toUpperCase();
    console.log(
      `| ${bundle.name} | ${formatBytes(bundle.sizes.raw)} | ${formatBytes(bundle.sizes.gzipped)} | ${targetRange} | ${bundle.target.percentOfMax.toFixed(1)}% | ${status} |`
    );
  }

  // Bundle details
  console.log('\n## Bundle Details\n');

  for (const bundle of report.bundles) {
    console.log(`### ${bundle.name}\n`);
    console.log(`**Description:** ${bundle.description}\n`);
    console.log(`**Modules:** ${bundle.modules.join(', ')}\n`);

    if (bundle.missingModules.length > 0) {
      console.log(`**Missing:** ${bundle.missingModules.join(', ')}\n`);
    }
    if (bundle.plannedModules.length > 0) {
      console.log(`**Planned:** ${bundle.plannedModules.join(', ')}\n`);
    }

    const existingModules = bundle.moduleBreakdown.filter((m) => m.exists && !m.planned);
    if (existingModules.length > 0) {
      console.log('**Size breakdown:**\n');
      for (const mod of existingModules.sort((a, b) => b.gzippedTotal - a.gzippedTotal)) {
        const pct = bundle.sizes.gzipped > 0
          ? ((mod.gzippedTotal / bundle.sizes.gzipped) * 100).toFixed(1)
          : '0';
        console.log(`- ${mod.name}: ${formatBytes(mod.gzippedTotal)} (${pct}%)`);
      }
      console.log('');
    }
  }

  // Summary
  console.log('## Summary\n');
  console.log(`- Available modules: ${report.totals.availableModules}`);
  console.log(`- Planned modules: ${report.totals.plannedModules}`);
  console.log(`- Total WASM size: ${formatBytes(report.totals.totalWasmSize)}`);
  console.log(`- Total gzipped: ${formatBytes(report.totals.totalGzippedSize)}`);
}

function formatCompare(report: FullReport): void {
  console.log(`\n${colors.bold}${colors.cyan}Bundle Comparison${colors.reset}\n`);

  // Create a matrix of bundles and their modules
  const allModules = [...new Set(report.bundles.flatMap((b) => b.modules))].sort();

  // Header
  console.log('Module'.padEnd(15) + report.bundles.map((b) => b.name.padStart(15)).join(''));
  console.log('─'.repeat(15 + report.bundles.length * 15));

  for (const moduleName of allModules) {
    let row = moduleName.padEnd(15);
    for (const bundle of report.bundles) {
      const hasModule = bundle.modules.includes(moduleName);
      const mod = report.modules.find((m) => m.name === moduleName);
      const isPlanned = mod?.planned ?? false;
      const exists = mod?.exists ?? false;

      let cell: string;
      if (!hasModule) {
        cell = '-';
      } else if (isPlanned) {
        cell = `${colors.yellow}P${colors.reset}`;
      } else if (exists) {
        cell = `${colors.green}Y${colors.reset}`;
      } else {
        cell = `${colors.red}M${colors.reset}`;
      }
      row += cell.padStart(15);
    }
    console.log(row);
  }

  console.log('─'.repeat(15 + report.bundles.length * 15));

  // Size row
  let sizeRow = 'Gzipped'.padEnd(15);
  for (const bundle of report.bundles) {
    sizeRow += formatBytes(bundle.sizes.gzipped).padStart(15);
  }
  console.log(sizeRow);

  // Target row
  let targetRow = 'Target'.padEnd(15);
  for (const bundle of report.bundles) {
    targetRow += formatBytes(bundle.target.max).padStart(15);
  }
  console.log(targetRow);

  // Status row
  let statusRow = 'Status'.padEnd(15);
  for (const bundle of report.bundles) {
    let status: string;
    switch (bundle.target.status) {
      case 'under':
      case 'within':
        status = `${colors.green}OK${colors.reset}`;
        break;
      case 'over':
        status = `${colors.red}OVER${colors.reset}`;
        break;
      case 'incomplete':
        status = `${colors.yellow}INC${colors.reset}`;
        break;
    }
    statusRow += status.padStart(15);
  }
  console.log(statusRow);

  console.log('\nLegend: Y=Yes, P=Planned, M=Missing, -=Not included\n');
}

// Main
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Bundle Size Analyzer for chdb-wasm

Usage:
  npx tsx scripts/analyze-bundles.ts              Show all sizes (console)
  npx tsx scripts/analyze-bundles.ts --json       Output as JSON
  npx tsx scripts/analyze-bundles.ts --markdown   Output as Markdown
  npx tsx scripts/analyze-bundles.ts --compare    Compare configs side-by-side

Options:
  -h, --help      Show this help message
`);
    process.exit(0);
  }

  const report = await analyzeBundles();

  if (args.includes('--json')) {
    formatJson(report);
  } else if (args.includes('--markdown')) {
    formatMarkdown(report);
  } else if (args.includes('--compare')) {
    formatCompare(report);
  } else {
    formatConsole(report);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
