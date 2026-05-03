export const appShellText = {
  productName: "MOSH",
  sectionLabel: "Private DM tracer",
  statusLabel: "Desktop first",
  navDirect: "Direct",
  navInvite: "Invite",
  navDiagnostics: "Diagnostics",
  localUser: "nevermore.local",
} as const;

export const invitePanelText = {
  title: "Start a private session",
  subtitle: "Create or paste a copyable invite URI, then confirm the peer fingerprint before the MLS welcome is accepted.",
  createLabel: "Create invite",
  pasteLabel: "Paste invite",
  inviteValue: "mosh://invite?mesh=7x9v&session=drift-41&peer=alice#fp=91A4-D2C8-77B0",
  fingerprintLabel: "Peer fingerprint",
  fingerprintValue: "91A4 D2C8 77B0 4F19",
  confirmLabel: "Confirm fingerprint",
} as const;

export const dmText = {
  contactName: "Alice Ives",
  contactStatus: "Private DM · MLS group pending · tracker discovery",
  bannerTitle: "OpenMLS message encryption over Moss transport",
  bannerBody: "Moss finds peers and carries ciphertext. OpenMLS protects private message content. Public trackers help discovery but do not hide metadata.",
  composerPlaceholder: "Encrypted message draft",
  sendLabel: "Send",
} as const;

export const diagnosticsText = {
  title: "Runtime diagnostics",
  mossLinkLabel: "Moss link",
  mossLinkValue: "dynamic release pin",
  discoveryLabel: "Discovery",
  discoveryValue: "default public trackers",
  storageLabel: "Secrets",
  storageValue: "native secure storage planned",
  mlsLabel: "Private crypto",
  mlsValue: "OpenMLS adapter boundary",
} as const;

export const messages = [
  {
    id: "m1",
    author: "system",
    time: "14:02",
    body: "Invite prepared. Waiting for fingerprint confirmation.",
  },
  {
    id: "m2",
    author: "alice",
    time: "14:04",
    body: "I can see the same fingerprint on my side.",
  },
  {
    id: "m3",
    author: "you",
    time: "14:05",
    body: "Confirmed. Next message should travel as MLS ciphertext.",
  },
] as const;

export const trustSteps = [
  "Invite URI",
  "Fingerprint",
  "MLS welcome",
  "Moss delivery",
] as const;
