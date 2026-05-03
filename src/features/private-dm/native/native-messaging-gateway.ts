import { invoke } from "@tauri-apps/api/core";

const APP_DIAGNOSTICS_COMMAND = "app_diagnostics";
const NATIVE_RUNTIME_STATUS_COMMAND = "native_runtime_status";

export interface DiagnosticsSnapshot {
  readonly app_name: string;
  readonly privacy_model: string;
  readonly discovery_model: string;
  readonly moss_link_mode: string;
}

export interface NativeRuntimeStatus {
  readonly moss: {
    readonly link_mode: string;
    readonly library_name: string;
    readonly required_symbols: readonly string[];
    readonly available: boolean;
    readonly checked_paths: readonly string[];
  };
  readonly secure_storage: {
    readonly backend: string;
    readonly service: string;
    readonly available: boolean;
  };
  readonly openmls_smoke: OpenMlsSmokeResult;
}

export type OpenMlsSmokeResult =
  | {
      readonly Ok: {
        readonly provider: string;
        readonly ciphersuite: string;
        readonly protected_message_created: boolean;
      };
    }
  | { readonly Err: string };

export interface NativeMessagingGateway {
  getDiagnostics(): Promise<DiagnosticsSnapshot>;
  getNativeRuntimeStatus(): Promise<NativeRuntimeStatus>;
}

export class TauriNativeMessagingGateway implements NativeMessagingGateway {
  async getDiagnostics(): Promise<DiagnosticsSnapshot> {
    return invoke<DiagnosticsSnapshot>(APP_DIAGNOSTICS_COMMAND);
  }

  async getNativeRuntimeStatus(): Promise<NativeRuntimeStatus> {
    return invoke<NativeRuntimeStatus>(NATIVE_RUNTIME_STATUS_COMMAND);
  }
}

export const nativeMessagingGateway = new TauriNativeMessagingGateway();
