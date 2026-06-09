export type OnboardStep = "menu" | "chat" | "group" | "join" | "channel";

export interface InviteCreateState {
  readonly inviteUri?: string;
  readonly copied: boolean;
}
