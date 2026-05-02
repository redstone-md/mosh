import { debug, error, info, warn, type LogOptions } from '@tauri-apps/plugin-log'

import { isTauriEnvironment } from './tauriEnv'

type DebugLogLevel = 'debug' | 'error' | 'info' | 'warn'

let globalHandlersRegistered = false

const writers: Record<DebugLogLevel, (message: string, options?: LogOptions) => Promise<void>> = {
  debug,
  error,
  info,
  warn,
}

export function debugLogDebug(message: string, options?: LogOptions) {
  return writeDebugLog('debug', message, options)
}

export function debugLogError(message: string, options?: LogOptions) {
  return writeDebugLog('error', message, options)
}

export function debugLogInfo(message: string, options?: LogOptions) {
  return writeDebugLog('info', message, options)
}

export function debugLogWarn(message: string, options?: LogOptions) {
  return writeDebugLog('warn', message, options)
}

export function registerFrontendDebugLogging() {
  if (globalHandlersRegistered || !isTauriEnvironment()) {
    return
  }

  globalHandlersRegistered = true
  window.addEventListener('error', (event) => {
    void debugLogError(`Unhandled frontend error: ${describeUnknownError(event.error ?? event.message)}`, {
      file: event.filename || undefined,
      line: event.lineno || undefined,
      keyValues: errorKeyValues(event.error ?? event.message),
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    void debugLogError(`Unhandled frontend promise rejection: ${describeUnknownError(event.reason)}`, {
      keyValues: errorKeyValues(event.reason),
    })
  })
}

async function writeDebugLog(level: DebugLogLevel, message: string, options?: LogOptions) {
  if (!isTauriEnvironment()) {
    return
  }

  try {
    await writers[level](message, options)
  } catch (error) {
    console.debug('MOSH debug log write failed', error)
  }
}

function errorKeyValues(value: unknown): Record<string, string | undefined> {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  return {
    message: typeof value === 'string' ? value : safeJson(value),
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function describeUnknownError(value: unknown): string {
  if (value instanceof Error) {
    return value.message || value.name
  }

  if (typeof value === 'string') {
    return value
  }

  return safeJson(value)
}
