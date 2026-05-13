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
