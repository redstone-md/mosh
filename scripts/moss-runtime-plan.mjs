import os from 'node:os'

const TARGET_RUNTIME_PLANS = {
  'x86_64-pc-windows-msvc': {
    goos: 'windows',
    goarch: 'amd64',
    libraryFile: 'moss.dll',
    headerFile: 'moss.h',
    artifactLabel: 'windows-x64',
  },
  'aarch64-pc-windows-msvc': {
    goos: 'windows',
    goarch: 'arm64',
    libraryFile: 'moss.dll',
    headerFile: 'moss.h',
    artifactLabel: 'windows-arm64',
  },
  'x86_64-unknown-linux-gnu': {
    goos: 'linux',
    goarch: 'amd64',
    libraryFile: 'libmoss.so',
    headerFile: 'libmoss.h',
    artifactLabel: 'linux-x64',
  },
  'aarch64-unknown-linux-gnu': {
    goos: 'linux',
    goarch: 'arm64',
    libraryFile: 'libmoss.so',
    headerFile: 'libmoss.h',
    artifactLabel: 'linux-arm64',
  },
  'x86_64-apple-darwin': {
    goos: 'darwin',
    goarch: 'amd64',
    libraryFile: 'libmoss.dylib',
    headerFile: 'libmoss.h',
    artifactLabel: 'macos-x64',
  },
  'aarch64-apple-darwin': {
    goos: 'darwin',
    goarch: 'arm64',
    libraryFile: 'libmoss.dylib',
    headerFile: 'libmoss.h',
    artifactLabel: 'macos-arm64',
  },
}

export function detectHostTargetTriple(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') {
    return 'x86_64-pc-windows-msvc'
  }
  if (platform === 'win32' && arch === 'arm64') {
    return 'aarch64-pc-windows-msvc'
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'x86_64-unknown-linux-gnu'
  }
  if (platform === 'linux' && arch === 'arm64') {
    return 'aarch64-unknown-linux-gnu'
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'x86_64-apple-darwin'
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'aarch64-apple-darwin'
  }

  throw new Error(`Unsupported host target: ${platform}/${arch}`)
}

export function resolveMossRuntimePlan(targetTriple = detectHostTargetTriple()) {
  const plan = TARGET_RUNTIME_PLANS[targetTriple]
  if (!plan) {
    throw new Error(`Unsupported target triple: ${targetTriple}`)
  }

  return {
    targetTriple,
    ...plan,
    hostPlatform: os.platform(),
    hostArch: os.arch(),
  }
}
