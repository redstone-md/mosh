import type {
  AcceptInviteRequest,
  AttachmentSendResult,
  CallStarted,
  ChannelLeaveResult,
  ChannelListSnapshot,
  ChannelSnapshot,
  ChannelSendResult,
  CloseSessionResult,
  CreateGroupRequest,
  DiagnosticsSnapshot,
  GroupCreated,
  GroupLeaveResult,
  GroupListSnapshot,
  GroupSendResult,
  GroupSnapshot,
  InviteCreated,
  JoinChannelRequest,
  JoinGroupRequest,
  NativeMessagingGateway,
  NativeRuntimeStatus,
  NetworkInterfaceInfo,
  SendMessageResult,
  SessionListSnapshot,
  SessionSnapshot,
  StartSessionRequest,
  VpnDetection,
} from "./native-messaging-gateway";

const RUNTIME_UNAVAILABLE =
  "Mosh desktop runtime is unavailable. Run npm run tauri dev to connect to Moss.";

function unavailable(): never {
  throw new Error(RUNTIME_UNAVAILABLE);
}

export class UnavailableNativeMessagingGateway implements NativeMessagingGateway {
  async getDiagnostics(): Promise<DiagnosticsSnapshot> {
    return {
      app_name: "Mosh",
      privacy_model: "desktop runtime unavailable",
      discovery_model: "Moss runtime unavailable in browser preview",
      moss_link_mode: "unavailable",
    };
  }

  async getNativeRuntimeStatus(): Promise<NativeRuntimeStatus> {
    return {
      moss: {
        link_mode: "unavailable",
        library_name: "",
        required_symbols: [],
        available: false,
        checked_paths: [],
      },
      secure_storage: {
        backend: "unavailable",
        service: "Mosh",
        available: false,
      },
      openmls_smoke: { Err: RUNTIME_UNAVAILABLE },
      openmls_roundtrip: { Err: RUNTIME_UNAVAILABLE },
    };
  }

  async createPrivateInvite(_request: StartSessionRequest): Promise<InviteCreated> {
    return unavailable();
  }

  async acceptPrivateInvite(_request: AcceptInviteRequest): Promise<SessionSnapshot> {
    return unavailable();
  }

  async sendPrivateMessage(_sessionId: string, _body: string): Promise<SendMessageResult> {
    return unavailable();
  }

  async pollPrivateSession(_sessionId: string): Promise<SessionSnapshot> {
    return unavailable();
  }

  async listPrivateSessions(): Promise<SessionListSnapshot> {
    return { sessions: [] };
  }

  async closePrivateSession(_sessionId: string): Promise<CloseSessionResult> {
    return unavailable();
  }

  async joinChannel(_request: JoinChannelRequest): Promise<ChannelSnapshot> {
    return unavailable();
  }

  async leaveChannel(_name: string): Promise<ChannelLeaveResult> {
    return unavailable();
  }

  async sendChannelMessage(_name: string, _body: string): Promise<ChannelSendResult> {
    return unavailable();
  }

  async pollChannel(_name: string): Promise<ChannelSnapshot> {
    return unavailable();
  }

  async listChannels(): Promise<ChannelListSnapshot> {
    return { channels: [] };
  }

  async createPrivateGroup(_request: CreateGroupRequest): Promise<GroupCreated> {
    return unavailable();
  }

  async joinPrivateGroup(_request: JoinGroupRequest): Promise<GroupSnapshot> {
    return unavailable();
  }

  async sendGroupMessage(_groupId: string, _body: string): Promise<GroupSendResult> {
    return unavailable();
  }

  async pollPrivateGroup(_groupId: string): Promise<GroupSnapshot> {
    return unavailable();
  }

  async listPrivateGroups(): Promise<GroupListSnapshot> {
    return { groups: [] };
  }

  async closePrivateGroup(_groupId: string): Promise<GroupLeaveResult> {
    return unavailable();
  }

  async sendPrivateAttachment(): Promise<AttachmentSendResult> {
    return unavailable();
  }

  async downloadPrivateAttachment(): Promise<void> {
    return unavailable();
  }

  async cancelPrivateAttachment(): Promise<void> {
    return unavailable();
  }

  async sendGroupAttachment(): Promise<AttachmentSendResult> {
    return unavailable();
  }

  async downloadGroupAttachment(): Promise<void> {
    return unavailable();
  }

  async cancelGroupAttachment(): Promise<void> {
    return unavailable();
  }

  async sendChannelAttachment(): Promise<AttachmentSendResult> {
    return unavailable();
  }

  async downloadChannelAttachment(): Promise<void> {
    return unavailable();
  }

  async cancelChannelAttachment(): Promise<void> {
    return unavailable();
  }

  async sendChannelDmOffer(): Promise<void> {
    return unavailable();
  }

  async dismissChannelDmOffer(): Promise<void> {
    return unavailable();
  }

  async sendGroupDmOffer(): Promise<void> {
    return unavailable();
  }

  async dismissGroupDmOffer(): Promise<void> {
    return unavailable();
  }

  async callStart(): Promise<CallStarted> {
    return unavailable();
  }

  async callAccept(): Promise<void> {
    return unavailable();
  }

  async callDecline(): Promise<void> {
    return unavailable();
  }

  async callEnd(): Promise<void> {
    return unavailable();
  }

  async callSendFrame(): Promise<void> {
    return unavailable();
  }

  async callDrainFrames(): Promise<readonly string[]> {
    return [];
  }

  async listNetworkInterfaces(): Promise<readonly NetworkInterfaceInfo[]> {
    return [];
  }

  async detectVpn(): Promise<VpnDetection> {
    return {
      vpn_likely: false,
      suspect_interfaces: [],
      vpn_owns_default_route: false,
    };
  }

  async setBindInterface(_value: string | null): Promise<void> {}

  async getBindInterface(): Promise<string | null> {
    return null;
  }
}
