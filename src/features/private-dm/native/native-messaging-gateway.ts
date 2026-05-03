import { invoke } from "@tauri-apps/api/core";

const APP_DIAGNOSTICS_COMMAND = "app_diagnostics";

export interface DiagnosticsSnapshot {
  readonly app_name: string;
  readonly privacy_model: string;
  readonly discovery_model: string;
  readonly moss_link_mode: string;
}

export interface NativeMessagingGateway {
  getDiagnostics(): Promise<DiagnosticsSnapshot>;
}

export class TauriNativeMessagingGateway implements NativeMessagingGateway {
  async getDiagnostics(): Promise<DiagnosticsSnapshot> {
    return invoke<DiagnosticsSnapshot>(APP_DIAGNOSTICS_COMMAND);
  }
}

export const nativeMessagingGateway = new TauriNativeMessagingGateway();
