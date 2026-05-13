export const shellText = {
  productName: "MOSH",
  windowSubtitle: "Private DM · OpenMLS over Moss",
} as const;

export const setupText = {
  sectionTitle: "Session setup",
  displayNameLabel: "Your display name",
  displayNamePlaceholder: "e.g. Juno's laptop",
  staticPeerLabel: "Static peer (optional)",
  staticPeerPlaceholder: "host:port — bypass trackers, direct dial",
  staticPeerHint: "Leave empty to use Moss public trackers + NAT punch.",
  listenPortLabel: "Listen port",
  listenPortHint: "0 = OS picks",
} as const;

export const inviteText = {
  createSectionTitle: "Invite a friend",
  createHint: "Generates a one-time invite URI. Share it with your friend over any channel you trust. Moss handles peer discovery + NAT traversal.",
  createButton: "Create invite",
  recreateButton: "Replace invite",
  copyButton: "Copy",
  copiedButton: "Copied",
  joinSectionTitle: "Join via invite",
  joinHint: "Paste the mosh:// URI your friend sent you.",
  joinPlaceholder: "mosh://invite?mesh=...&session=...#fp=...",
  joinButton: "Connect",
  fingerprintLabel: "Peer fingerprint",
  fingerprintHint: "Verify out-of-band (voice call / in person). If it matches your friend's, click confirm.",
  confirmButton: "Confirm fingerprint",
  confirmedButton: "Fingerprint confirmed",
} as const;

export const chatText = {
  emptyTitle: "No messages yet.",
  emptyBody: "Once your peer joins and MLS handshake finishes, plaintext stays only on your devices.",
  composerPlaceholder: "Write a message…",
  sendLabel: "Send",
  cryptoFooter: "OpenMLS sealed · ciphertext over Moss gossip",
} as const;

export const stateLabels: Record<string, string> = {
  idle: "No session",
  waiting: "Waiting for peer",
  ready: "Connected",
};

export const cryptoNotice = {
  title: "End-to-end encrypted",
  body: "OpenMLS protects message content. Moss carries ciphertext via public trackers + supernodes for NAT punching — peer discovery metadata is NOT hidden.",
} as const;
