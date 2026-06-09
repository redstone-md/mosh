export interface InviteCreateState {
  readonly inviteUri?: string;
  readonly copied: boolean;
}

export interface PrivateDmRequestBase {
  readonly display_name: string;
  readonly listen_port: number;
  readonly static_peer: string | null;
}
