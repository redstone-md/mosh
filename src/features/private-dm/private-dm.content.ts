export const shellText = {
  productName: "MOSH",
  windowSubtitle: "DM · Alice Park",
  directTooltip: "Direct messages",
  exploreTooltip: "Explore",
  settingsTooltip: "Settings",
  userName: "Juno",
  userKey: "6e872f...c2b1",
} as const;

export const contacts = [
  {
    id: "alice",
    name: "Alice Park",
    handle: "alice",
    preview: "fingerprint matches on my side",
    time: "14:08",
    presence: "online",
    active: true,
    unread: 0,
  },
  {
    id: "bao",
    name: "Bao Nguyen",
    handle: "bao",
    preview: "tracker announce looks healthy",
    time: "13:40",
    presence: "online",
    active: false,
    unread: 2,
  },
  {
    id: "devon",
    name: "Devon Liu",
    handle: "devon",
    preview: "routing...",
    time: "--",
    presence: "pending",
    active: false,
    unread: 0,
  },
] as const;

export const inviteText = {
  header: "Direct messages",
  searchPlaceholder: "Search people",
  pinnedLabel: "Pinned",
  recentLabel: "Recent",
  inviteValue: "mosh://invite?mesh=7x9v&session=drift-41#fp=91A4-D2C8-77B0",
  pasteLabel: "Paste invite",
  createLabel: "Create invite",
  confirmLabel: "Confirm fingerprint",
  fingerprintLabel: "Peer fingerprint",
  fingerprintValue: "91A4 D2C8 77B0 4F19",
  confirmedLabel: "Fingerprint confirmed",
} as const;

export const dmText = {
  contactName: "Alice Park",
  contactSubtitle: "Direct · tracker discovery · MLS pending",
  bannerTitle: "OpenMLS E2EE over Moss transport",
  bannerBody: "Moss discovers peers and carries ciphertext. OpenMLS protects private message content. Public trackers help discovery but do not hide metadata.",
  dayLabel: "Today",
  composerPlaceholder: "Message Alice Park",
  footerCrypto: "OpenMLS group · ciphertext history · Moss public trackers",
} as const;

export const diagnostics = [
  ["Moss link", "dynamic release pin"],
  ["Discovery", "default public trackers"],
  ["Secrets", "native secure storage planned"],
  ["Private crypto", "OpenMLS adapter boundary"],
] as const;

export const messages = [
  {
    id: "m1",
    from: "alice",
    name: "Alice Park",
    key: "91a4d2...77b0",
    time: "14:02",
    body: "I pasted the invite. My side shows the same short fingerprint.",
  },
  {
    id: "m2",
    from: "me",
    name: "Juno",
    key: "6e872f...c2b1",
    time: "14:05",
    body: "Confirmed. The next implementation step is turning this shell into real MLS application messages.",
  },
  {
    id: "m3",
    from: "alice",
    name: "Alice Park",
    key: "91a4d2...77b0",
    time: "14:08",
    body: "Good. Also keep the tracker metadata warning visible. It is calm enough here.",
  },
] as const;

export const trustSteps = [
  ["Invite URI", "copied"],
  ["Fingerprint", "manual check"],
  ["MLS welcome", "next slice"],
  ["Moss delivery", "tracker discovery"],
] as const;
