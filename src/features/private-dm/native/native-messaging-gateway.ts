import { invoke } from "@tauri-apps/api/core";

const APP_DIAGNOSTICS_COMMAND = "app_diagnostics";
const NATIVE_RUNTIME_STATUS_COMMAND = "native_runtime_status";
const PRIVATE_DM_CREATE_INVITE_COMMAND = "private_dm_create_invite";
const PRIVATE_DM_ACCEPT_INVITE_COMMAND = "private_dm_accept_invite";
const PRIVATE_DM_SEND_MESSAGE_COMMAND = "private_dm_send_message";
const PRIVATE_DM_POLL_COMMAND = "private_dm_poll";

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
  readonly openmls_roundtrip: OpenMlsRoundTripResult;
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

export type OpenMlsRoundTripResult =
  | {
      readonly Ok: {
        readonly provider: string;
        readonly ciphersuite: string;
        readonly welcome_joined: boolean;
        readonly plaintext_roundtrip: boolean;
      };
    }
  | { readonly Err: string };

export interface StartSessionRequest {
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer?: string | null;
}

export interface AcceptInviteRequest {
  readonly invite_uri: string;
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer?: string | null;
}

export interface InviteCreated {
  readonly invite_uri: string;
  readonly session_id: string;
  readonly mesh_id: string;
  readonly fingerprint: string;
  readonly listen_address: string;
}

export interface ChatMessage {
  readonly from_device: string;
  readonly body: string;
}

export interface SessionSnapshot {
  readonly role: string;
  readonly state: string;
  readonly invite_uri: string | null;
  readonly fingerprint: string;
  readonly messages: readonly ChatMessage[];
}

export interface SendMessageResult {
  readonly state: string;
  readonly ciphertext_bytes: number;
}

export interface NativeMessagingGateway {
  getDiagnostics(): Promise<DiagnosticsSnapshot>;
  getNativeRuntimeStatus(): Promise<NativeRuntimeStatus>;
  createPrivateInvite(request: StartSessionRequest): Promise<InviteCreated>;
  acceptPrivateInvite(request: AcceptInviteRequest): Promise<SessionSnapshot>;
  sendPrivateMessage(body: string): Promise<SendMessageResult>;
  pollPrivateSession(): Promise<SessionSnapshot>;
}

export class TauriNativeMessagingGateway implements NativeMessagingGateway {
  async getDiagnostics(): Promise<DiagnosticsSnapshot> {
    return invoke<DiagnosticsSnapshot>(APP_DIAGNOSTICS_COMMAND);
  }

  async getNativeRuntimeStatus(): Promise<NativeRuntimeStatus> {
    return invoke<NativeRuntimeStatus>(NATIVE_RUNTIME_STATUS_COMMAND);
  }

  async createPrivateInvite(request: StartSessionRequest): Promise<InviteCreated> {
    return invoke<InviteCreated>(PRIVATE_DM_CREATE_INVITE_COMMAND, { request });
  }

  async acceptPrivateInvite(request: AcceptInviteRequest): Promise<SessionSnapshot> {
    return invoke<SessionSnapshot>(PRIVATE_DM_ACCEPT_INVITE_COMMAND, { request });
  }

  async sendPrivateMessage(body: string): Promise<SendMessageResult> {
    return invoke<SendMessageResult>(PRIVATE_DM_SEND_MESSAGE_COMMAND, { body });
  }

  async pollPrivateSession(): Promise<SessionSnapshot> {
    return invoke<SessionSnapshot>(PRIVATE_DM_POLL_COMMAND);
  }
}

export const nativeMessagingGateway = new TauriNativeMessagingGateway();
