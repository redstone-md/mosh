export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return Boolean((window as Window & { __TAURI_INTERNALS__?: { metadata?: unknown } }).__TAURI_INTERNALS__?.metadata)
}
