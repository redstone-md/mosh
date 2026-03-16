import { invoke } from '@tauri-apps/api/core'
import { isTauriEnvironment } from './tauriEnv'

export async function hideWindowToTray() {
  if (!isTauriEnvironment()) {
    return
  }
  await invoke('window_hide_to_tray')
}

export async function showDesktopWindow() {
  if (!isTauriEnvironment()) {
    return
  }
  await invoke('window_show_main')
}

export async function minimizeDesktopWindow() {
  if (!isTauriEnvironment()) {
    return
  }
  await invoke('window_minimize')
}

export async function toggleDesktopWindowMaximize() {
  if (!isTauriEnvironment()) {
    return
  }
  await invoke('window_toggle_maximize')
}

export async function startDesktopWindowDrag() {
  if (!isTauriEnvironment()) {
    return
  }
  await invoke('window_start_drag')
}

export async function readDesktopWindowState() {
  if (!isTauriEnvironment()) {
    return {
      focused: true,
      visible: true,
      maximized: false,
    }
  }
  return invoke<{ focused: boolean; visible: boolean; maximized: boolean }>('window_state')
}
