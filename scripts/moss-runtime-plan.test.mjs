import { describe, expect, it } from 'vitest'

import { detectHostTargetTriple, resolveMossRuntimePlan } from './moss-runtime-plan.mjs'

describe('moss runtime plan', () => {
  it('maps host platform and architecture pairs to supported target triples', () => {
    expect(detectHostTargetTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc')
    expect(detectHostTargetTriple('win32', 'arm64')).toBe('aarch64-pc-windows-msvc')
    expect(detectHostTargetTriple('linux', 'arm64')).toBe('aarch64-unknown-linux-gnu')
    expect(detectHostTargetTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin')
  })

  it('returns the correct shared runtime naming plan for each target family', () => {
    expect(resolveMossRuntimePlan('x86_64-pc-windows-msvc')).toMatchObject({
      goos: 'windows',
      goarch: 'amd64',
      libraryFile: 'moss.dll',
      headerFile: 'moss.h',
    })
    expect(resolveMossRuntimePlan('aarch64-pc-windows-msvc')).toMatchObject({
      goos: 'windows',
      goarch: 'arm64',
      libraryFile: 'moss.dll',
      headerFile: 'moss.h',
    })
    expect(resolveMossRuntimePlan('aarch64-apple-darwin')).toMatchObject({
      goos: 'darwin',
      goarch: 'arm64',
      libraryFile: 'libmoss.dylib',
      headerFile: 'libmoss.h',
    })
  })

  it('rejects unsupported targets', () => {
    expect(() => resolveMossRuntimePlan('riscv64-unknown-linux-gnu')).toThrow(/Unsupported target triple/)
  })
})
