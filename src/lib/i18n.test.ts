import { describe, expect, it } from 'vitest'

import { shellPreferencesSchema } from './appShellSchemas'
import {
  describeArchiveStateLabel,
  detectSystemLanguage,
  getI18nCopy,
  getLanguageOptionLabel,
  resolveAppLanguage,
} from './i18n'

describe('language resolution', () => {
  it('detects russian system locales', () => {
    expect(detectSystemLanguage('ru-RU')).toBe('ru')
  })

  it('falls back to english for unsupported locales', () => {
    expect(detectSystemLanguage('cs-CZ')).toBe('en')
  })

  it('resolves system preference to the detected language', () => {
    expect(resolveAppLanguage('system', 'ru')).toBe('ru')
    expect(resolveAppLanguage('system', 'en')).toBe('en')
  })

  it('preserves an explicit user override', () => {
    expect(resolveAppLanguage('ru', 'en')).toBe('ru')
  })
})

describe('language copy helpers', () => {
  it('labels the system option with the resolved locale name', () => {
    const copy = getI18nCopy('ru')
    expect(getLanguageOptionLabel(copy, 'system', 'ru')).toBe('Система (Русский)')
  })

  it('describes signed archive state in the selected language', () => {
    const copy = getI18nCopy('ru')
    expect(describeArchiveStateLabel(copy, undefined, undefined)).toBe('Архив ещё не создан')
    expect(describeArchiveStateLabel(copy, 'abc123', true)).toBe('Подписано ключом abc123')
  })
})

describe('preferences schema migration', () => {
  it('fills missing language preference for older persisted configs', () => {
    const parsed = shellPreferencesSchema.parse({
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
      roomTypes: {
        lobby: 'text',
      },
    })

    expect(parsed.languagePreference).toBe('system')
  })
})
