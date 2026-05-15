export const shellText = {
  productName: "MOSH",
  windowSubtitle: "Private DM · OpenMLS over Moss",
  newSession: "New",
  closeSession: "Close session",
  noActive: "No active session",
} as const;

export const setupText = {
  sectionTitle: "Session setup",
  displayNameLabel: "Your display name",
  displayNamePlaceholder: "e.g. juno-laptop",
  staticPeerLabel: "Static peer (optional)",
  staticPeerPlaceholder: "host:port — bypass trackers, direct dial",
  staticPeerHint: "Empty = Moss public trackers + NAT punch.",
  listenPortLabel: "Listen port",
  listenPortHint: "0 = OS picks",
} as const;

export const inviteText = {
  newSessionTitle: "Start a private chat",
  createSectionTitle: "Invite a friend",
  createHint: "Generates a one-time invite URI. Share it any channel you trust.",
  createButton: "Create invite",
  recreateButton: "Replace invite",
  copyButton: "Copy",
  copiedButton: "Copied",
  joinSectionTitle: "Join via invite",
  joinHint: "Paste the mosh:// URI your friend sent you.",
  joinPlaceholder: "mosh://invite?mesh=...&session=...#fp=...",
  joinButton: "Connect",
  fingerprintLabel: "Peer fingerprint",
  fingerprintHint: "Verify out-of-band (voice / in person). Then click confirm.",
  confirmButton: "Confirm fingerprint",
  confirmedButton: "Fingerprint confirmed",
} as const;

export const chatText = {
  emptyTitle: "No messages yet.",
  emptyBody: "Once the peer joins and MLS handshake finishes, plaintext stays only on your devices.",
  composerPlaceholder: "Write a message…",
  sendLabel: "Send",
  attachLabel: "Attach a file",
  dropHint: "Drop a file to share it",
  cryptoFooter: "OpenMLS sealed · ciphertext over Moss gossip",
  noSessionTitle: "Welcome to Mosh.",
  noSessionBody: "Create an invite or paste one to start your first encrypted conversation.",
  startCta: "New private chat",
} as const;

export const stateLabels: Record<string, string> = {
  idle: "Idle",
  waiting: "Waiting",
  ready: "Connected",
};

export const cryptoNotice = {
  title: "End-to-end encrypted",
  body: "OpenMLS protects message content. Moss carries ciphertext via public trackers + supernodes for NAT punching — peer discovery metadata is NOT hidden.",
} as const;

export const groupText = {
  createCardTitle: "Create private group",
  createHint: "MLS-encrypted N-member group with random mesh id. Only people you share the invite with can join. You are the admin until membership control is added.",
  labelLabel: "Group name (optional)",
  labelHint: "Human-readable label embedded in the invite URI.",
  labelPlaceholder: "Friends, work, etc.",
  createButton: "Create group",
  recreateButton: "Replace group invite",
  joinCardTitle: "Join private group",
  joinHint: "Paste a mosh://group invite URI from the admin.",
  joinPlaceholder: "mosh://group?mesh=...&group=...&name=...#fp=...",
  joinButton: "Join group",
  noticeTitle: "End-to-end encrypted group",
  noticeBody: "OpenMLS protects message content. Only members the admin has admitted can decrypt. New members do not see prior history.",
  emptyTitle: "No messages in this group yet.",
  emptyBody: "Once members join via invite, the admin admits them and they decrypt messages from this point onward.",
  adminBadge: "admin",
  leaveLabel: "Leave group",
  copyInvite: "Copy invite",
  untitled: "Private group",
} as const;

export const channelText = {
  cardTitle: "Join a public channel",
  cardHint: "Type a channel name to subscribe. Anyone who knows the name can join. Messages are NOT end-to-end encrypted — only Moss transport (Noise) protects in-flight bytes.",
  nameLabel: "Channel name",
  namePlaceholder: "@mosh-dev",
  joinButton: "Join channel",
  subtitle: "Public channel · plaintext over Moss",
  leaveLabel: "Leave channel",
  broadcastBadge: "Broadcast",
  noticeTitle: "Public channel",
  noticeBody: "Not end-to-end encrypted. Anyone who joins this channel can read messages. Your device fingerprint is shown next to each message you publish.",
  emptyTitle: "No messages in this channel yet.",
  emptyBody: "Say hi. Anyone subscribed to this channel will see your message.",
} as const;
