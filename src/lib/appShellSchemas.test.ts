import { describe, expect, it } from 'vitest'

import { shellPreferencesSchema } from './appShellSchemas'

const basePreferences = {
  theme: 'moss',
  onboardingCompleted: false,
  selectedDock: 'group',
  selectedGroupId: 'mesh',
  selectedRoomId: 'lobby',
  selectedPanel: 'chat',
  runtimeDraft: {
    nickname: 'operator',
    meshId: 'mosh-chat',
    listenPort: 0,
    initialRoom: 'lobby',
    startupPeer: '',
    trackerMode: 'default',
    lanDiscoveryEnabled: true,
  },
  groups: [
    {
      id: 'mesh',
      name: 'Mesh',
      icon: 'MS',
      accent: 'forest',
      roomIds: ['lobby'],
    },
  ],
}

describe('appShellSchemas', () => {
  it('normalizes invalid trusted peer approval timestamps', () => {
    const parsed = shellPreferencesSchema.parse({
      ...basePreferences,
      trustedPeers: {
        peer: {
          displayName: 'operator',
          approvedAt: 'not-a-date',
        },
      },
    })

    expect(parsed.trustedPeers.peer?.approvedAt).toBe('1970-01-01T00:00:00.000Z')
  })
})
