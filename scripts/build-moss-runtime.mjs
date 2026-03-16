import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveMossRuntimePlan } from './moss-runtime-plan.mjs';

function parseArgs(argv) {
  const args = { target: process.env.MOSS_TARGET_TRIPLE || process.env.TAURI_ENV_TARGET_TRIPLE || '' };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--target') {
      args.target = argv[index + 1] ?? '';
      index += 1;
    }
  }

  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} ${args.join(' ')} failed`);
  }

  return result.stdout.trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = resolveMossRuntimePlan(args.target || undefined);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const mossDir = path.join(repoRoot, 'moss');
  const bundleDir = path.join(repoRoot, 'src-tauri', 'resources', 'moss');
  const libraryPath = path.join(bundleDir, plan.libraryFile);
  const headerPath = path.join(bundleDir, plan.headerFile);

  await fs.rm(bundleDir, { recursive: true, force: true });
  await fs.mkdir(bundleDir, { recursive: true });
  await fs.writeFile(path.join(bundleDir, '.gitkeep'), '');

  console.log(`[moss:bundle] target=${plan.targetTriple} host=${plan.hostPlatform}/${plan.hostArch}`);
  run(
    'go',
    ['build', '-buildmode=c-shared', '-o', libraryPath, './cmd/moss-ffi'],
    {
      cwd: mossDir,
      env: {
        ...process.env,
        CGO_ENABLED: '1',
        GOOS: plan.goos,
        GOARCH: plan.goarch,
        ...(process.env.MOSS_CC ? { CC: process.env.MOSS_CC } : {}),
        ...(process.env.MOSS_CXX ? { CXX: process.env.MOSS_CXX } : {}),
      },
    },
  );

  if (!existsSync(libraryPath) || !existsSync(headerPath)) {
    throw new Error(`Expected bundled runtime files were not created in ${bundleDir}`);
  }

  const revision = runCapture('git', ['rev-parse', 'HEAD'], { cwd: mossDir });
  const manifestPath = path.join(bundleDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        targetTriple: plan.targetTriple,
        artifactLabel: plan.artifactLabel,
        goos: plan.goos,
        goarch: plan.goarch,
        libraryFile: plan.libraryFile,
        headerFile: plan.headerFile,
        mossRevision: revision,
        mossBranch: 'main',
      },
      null,
      2,
    ),
  );

  console.log(`[moss:bundle] attached ${plan.libraryFile} (${revision.slice(0, 7)}) to src-tauri/resources/moss`);
}

main().catch((error) => {
  console.error(`[moss:bundle] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
