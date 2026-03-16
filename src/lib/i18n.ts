export const supportedLanguages = ['en', 'ru'] as const
export const languagePreferenceOptions = ['system', ...supportedLanguages] as const

export type AppLanguage = (typeof supportedLanguages)[number]
export type LanguagePreference = (typeof languagePreferenceOptions)[number]

const translations = {
  en: {
    common: {
      settings: 'Settings',
      preferences: 'Preferences',
      appearance: 'Appearance',
      workspace: 'Workspace',
      runtime: 'Runtime',
      archive: 'Archive',
      language: 'Language',
      theme: 'Theme',
      group: 'Group',
      groups: 'Groups',
      channel: 'Channel',
      channels: 'Channels',
      direct: 'Direct',
      voice: 'Voice',
      text: 'Text',
      active: 'Active',
      save: 'Save',
      unknownRoom: 'Unknown room',
      create: 'Create',
      continue: 'Continue',
    },
    app: {
      loading: 'Loading mesh shell...',
      bootstrapError: 'Bootstrap error',
    },
    languageNames: {
      system: 'System',
      en: 'English',
      ru: 'Russian',
      systemResolved: (languageLabel: string) => `System (${languageLabel})`,
    },
    themes: {
      moss: 'Moss',
      graphite: 'Graphite',
      linen: 'Linen',
      ember: 'Ember',
    },
    runtime: {
      online: 'Runtime online',
      offline: 'Runtime offline',
      applying: 'Applying...',
      saveAndEnter: 'Save and enter',
      saveSettings: 'Save runtime settings',
      saving: 'Saving...',
      status: 'Runtime status',
      persisted: 'What is persisted',
      persistedTheme: 'Theme, language, and onboarding completion.',
      persistedDraft: 'Runtime draft so you do not re-enter mesh data each launch.',
      persistedArchive: 'Signed local chat archives for every opened room.',
      openShellOnly: 'Open shell only',
      start: 'Start runtime',
      stop: 'Stop runtime',
      minimize: 'Minimize',
      maximize: 'Maximize',
      restore: 'Restore',
      hideToTray: 'Hide to tray',
      trackerBuiltIn: 'Built-in tracker',
      trackerDisabled: 'Disabled',
      stateLabel: 'State',
      routeLabel: 'Route',
      bridgeLabel: 'Bridge',
      natLabel: 'NAT',
      offlineLabel: 'Voice idle',
      roomLiveLabel: (roomLabel: string, peers: number) => `${roomLabel} · ${peers} peers`,
    },
    onboarding: {
      title: 'MOSH Desktop',
      description: 'Persist your mesh identity once and reopen directly into the shell.',
    },
    intro: {
      summary:
        'Private mesh chat that keeps your identity on this machine, finds peers directly, and restores rooms without another setup pass.',
      steps: [
        {
          label: 'Identity stays local',
          detail:
            'MOSH creates a local operator profile first. Nothing is pushed anywhere before you join a mesh.',
        },
        {
          label: 'Peers route directly',
          detail:
            'A shared mesh id and bootstrap path tell nodes how to discover each other and open rooms.',
        },
        {
          label: 'Rooms stay live',
          detail:
            'Messages, voice and screen sessions attach to rooms, so the shell reopens exactly where you left it.',
        },
      ],
      roomLabel: 'mesh room',
      roomDetail: 'chat, voice, screen share',
      countdown: 'Intro ends in 3 seconds',
      skip: 'Skip intro',
    },
    form: {
      nickname: 'Nickname',
      meshId: 'Mesh ID',
      initialChannel: 'Initial Channel',
      startupPeer: 'Startup Peer',
      listenPort: 'Listen Port',
      trackerBootstrap: 'Tracker Bootstrap',
      lanDiscovery: 'Enable LAN discovery',
      startupPeerPlaceholder: 'host:port',
    },
    sidebar: {
      directMessages: 'Direct messages',
      searchConversations: 'Search conversations',
      searchChannels: 'Search channels',
      pinnedDms: 'Pinned DMs',
      peersOnline: 'Peers online',
      utilities: 'Utilities',
      noDirectRooms: 'No direct rooms yet.',
      waitForPeers: 'Wait for peers to announce presence.',
      noTextChannels: 'No text channels assigned to this group.',
      noVoiceChannels: 'No voice channels assigned to this group.',
      createSpace: 'Create space',
      preferences: 'Preferences',
    },
    room: {
      participants: (count: number) => `${count} participants`,
      members: (count: number) => `${count} members`,
    },
    archive: {
      title: 'Signed archive',
      pending: 'Archive pending',
      signedBy: (fingerprint: string) => `Signed by ${fingerprint}`,
      failed: (fingerprint: string) => `Archive signature failed for ${fingerprint}`,
      verificationMatches: 'Archive payload matches the stored signature.',
      verificationMismatch: 'Archive payload does not match the stored signature.',
      verificationPending: 'Verification starts after the first persisted room snapshot.',
      firstPersistedMessage: 'Archive will be signed after the first persisted message set.',
      transcript: 'Signed transcript',
      fingerprint: 'Fingerprint',
      verification: 'Verification',
      noArchive: 'No archive written yet',
      currentStatus: (label: string) => `Current archive status: ${label}`,
    },
    call: {
      status: 'Call status',
      inVoice: (count: number) => `${count} in voice`,
      voiceActive: 'Voice session is active for this room.',
      microphone: 'Toggle microphone',
      stopShare: 'Stop share',
      leave: 'Leave',
      shareScreen: 'Share screen in voice room',
      joinVoiceChannel: 'Join voice channel',
      leaveVoiceChannel: 'Leave voice channel',
      joinVoiceRoom: 'Join voice for this room',
      leaveVoiceRoom: 'Leave voice room',
      connectedSummary: (members: number, connected: number, modes: string) =>
        `${members} members · ${connected} connected · ${modes}`,
      modeVoice: 'voice',
      modeScreen: 'screen',
      modeUnknown: 'live',
    },
    messages: {
      placeholder: (roomLabel: string) => `Message ${roomLabel}...`,
      noMessages: 'No messages yet',
      noMessagesSystem:
        'System updates will appear here as soon as the runtime has something to report.',
      noMessagesRoom: (roomLabel: string) =>
        `Start the conversation in ${roomLabel} and new messages will stream in here.`,
      reply: 'Reply',
      copy: 'Copy text',
      attachImage: 'Attach image (<40KB)',
      insertEmoji: 'Insert emoji',
      imageTooLarge: 'File is too large. Base64 attachments are limited to 40KB in this demo.',
    },
    settings: {
      description: 'Appearance, runtime boot settings, and signed local archive metadata.',
      showOnboarding: 'Show onboarding on next launch',
    },
    workspace: {
      addGroup: 'Add group',
      groupSettings: 'Group settings',
      createGroupToStart: 'Create a group to start organizing channels.',
      channelRouting: 'Channel routing',
      routingNote: 'Type and group are saved locally for this shell.',
      deleteGroup: 'Delete group',
      saveWorkspace: 'Save workspace',
      createGroupFirst: 'Create at least one group before saving the workspace.',
      invalidLayout: 'Workspace layout is invalid.',
      channelsRouted: (count: number) => `${count} channels routed to this group.`,
      channelCount: (count: number) => `${count} channels`,
      joinChannelFirst: 'Join a channel first, then route it into a local group here.',
      name: 'Name',
      icon: 'Icon',
      accent: 'Accent',
      assignedChannels: 'Assigned channels',
      groupName: (index: number) => `Group ${index}`,
      groupSelect: 'Group',
      typeSelect: 'Type',
      accents: {
        forest: 'Forest',
        slate: 'Slate',
        sand: 'Sand',
        ember: 'Ember',
      },
    },
    createSpace: {
      title: 'Create space',
      description: 'Join a channel, open a direct room, or create a local group layout.',
      joinCreateChannel: 'Join or create channel',
      openDirectRoom: 'Open direct room',
      createGroup: 'Create group',
      channelType: 'Channel type',
      channelName: 'Channel name',
      peerNickname: 'Peer nickname',
      groupName: 'Group name',
      textChannel: 'Text channel',
      voiceChannel: 'Voice channel',
      channelNameInvalid: 'Channel name is invalid.',
      peerTargetInvalid: 'Peer target is invalid.',
      groupInvalid: 'Group is invalid.',
      joinChannelFirst: 'Join a channel first to group it here.',
    },
    notifications: {
      mentionFrom: (author: string) => `Mention from ${author}`,
      directMessageFrom: (author: string) => `Direct message from ${author}`,
      newMessageIn: (roomLabel: string) => `New message in ${roomLabel}`,
    },
    peerStatus: {
      self: 'You',
      online: 'Online',
    },
  },
  ru: {
    common: {
      settings: 'Настройки',
      preferences: 'Параметры',
      appearance: 'Внешний вид',
      workspace: 'Рабочее пространство',
      runtime: 'Рантайм',
      archive: 'Архив',
      language: 'Язык',
      theme: 'Тема',
      group: 'Группа',
      groups: 'Группы',
      channel: 'Канал',
      channels: 'Каналы',
      direct: 'Личка',
      voice: 'Голос',
      text: 'Текст',
      active: 'Активна',
      save: 'Сохранить',
      unknownRoom: 'Неизвестная комната',
      create: 'Создать',
      continue: 'Продолжить',
    },
    app: {
      loading: 'Загрузка MOSH shell...',
      bootstrapError: 'Ошибка запуска',
    },
    languageNames: {
      system: 'Система',
      en: 'English',
      ru: 'Русский',
      systemResolved: (languageLabel: string) => `Система (${languageLabel})`,
    },
    themes: {
      moss: 'Moss',
      graphite: 'Graphite',
      linen: 'Linen',
      ember: 'Ember',
    },
    runtime: {
      online: 'Рантайм онлайн',
      offline: 'Рантайм офлайн',
      applying: 'Применение...',
      saveAndEnter: 'Сохранить и войти',
      saveSettings: 'Сохранить настройки рантайма',
      saving: 'Сохранение...',
      status: 'Состояние рантайма',
      persisted: 'Что сохраняется',
      persistedTheme: 'Тема, язык и завершение onboarding.',
      persistedDraft: 'Черновик рантайма, чтобы не вводить mesh-данные при каждом запуске.',
      persistedArchive: 'Подписанные локальные архивы чатов для каждой открытой комнаты.',
      openShellOnly: 'Открыть только shell',
      start: 'Запустить рантайм',
      stop: 'Остановить рантайм',
      minimize: 'Свернуть',
      maximize: 'Развернуть',
      restore: 'Восстановить',
      hideToTray: 'Скрыть в трей',
      trackerBuiltIn: 'Встроенный трекер',
      trackerDisabled: 'Отключен',
      stateLabel: 'Статус',
      routeLabel: 'Маршрут',
      bridgeLabel: 'Бридж',
      natLabel: 'NAT',
      offlineLabel: 'Голос не активен',
      roomLiveLabel: (roomLabel: string, peers: number) => `${roomLabel} · ${peers} пиров`,
    },
    onboarding: {
      title: 'MOSH Desktop',
      description: 'Один раз сохрани mesh identity и затем открывайся сразу в shell.',
    },
    intro: {
      summary:
        'Приватный mesh-чат, который хранит identity на этом устройстве, находит пиры напрямую и восстанавливает комнаты без повторной настройки.',
      steps: [
        {
          label: 'Identity хранится локально',
          detail: 'MOSH сначала создаёт локальный профиль оператора. Ничего не отправляется наружу до входа в mesh.',
        },
        {
          label: 'Пиры маршрутизируются напрямую',
          detail: 'Общий mesh id и bootstrap путь помогают узлам находить друг друга и открывать комнаты.',
        },
        {
          label: 'Комнаты остаются живыми',
          detail: 'Сообщения, голос и screen share привязаны к комнатам, поэтому shell открывается там, где ты остановился.',
        },
      ],
      roomLabel: 'mesh-комната',
      roomDetail: 'чат, голос, screen share',
      countdown: 'Интро закончится через 3 секунды',
      skip: 'Пропустить интро',
    },
    form: {
      nickname: 'Никнейм',
      meshId: 'Mesh ID',
      initialChannel: 'Стартовый канал',
      startupPeer: 'Стартовый пир',
      listenPort: 'Порт прослушивания',
      trackerBootstrap: 'Трекер bootstrap',
      lanDiscovery: 'Включить обнаружение по LAN',
      startupPeerPlaceholder: 'host:port',
    },
    sidebar: {
      directMessages: 'Личные сообщения',
      searchConversations: 'Поиск диалогов',
      searchChannels: 'Поиск каналов',
      pinnedDms: 'Закреплённые DM',
      peersOnline: 'Пиры онлайн',
      utilities: 'Служебное',
      noDirectRooms: 'Личных комнат пока нет.',
      waitForPeers: 'Дождись, пока пиры объявят о своём присутствии.',
      noTextChannels: 'В этой группе нет текстовых каналов.',
      noVoiceChannels: 'В этой группе нет голосовых каналов.',
      createSpace: 'Создать пространство',
      preferences: 'Параметры',
    },
    room: {
      participants: (count: number) => `${count} участников`,
      members: (count: number) => `${count} участников`,
    },
    archive: {
      title: 'Подписанный архив',
      pending: 'Архив ещё не создан',
      signedBy: (fingerprint: string) => `Подписано ключом ${fingerprint}`,
      failed: (fingerprint: string) => `Подпись архива не совпала для ${fingerprint}`,
      verificationMatches: 'Содержимое архива совпадает с сохранённой подписью.',
      verificationMismatch: 'Содержимое архива не совпадает с сохранённой подписью.',
      verificationPending: 'Проверка начнётся после первого сохранённого снимка комнаты.',
      firstPersistedMessage: 'Архив будет подписан после первого сохранённого набора сообщений.',
      transcript: 'Подписанная расшифровка',
      fingerprint: 'Отпечаток',
      verification: 'Проверка',
      noArchive: 'Архив ещё не записан',
      currentStatus: (label: string) => `Текущий статус архива: ${label}`,
    },
    call: {
      status: 'Статус звонка',
      inVoice: (count: number) => `${count} в голосе`,
      voiceActive: 'Голосовая сессия активна для этой комнаты.',
      microphone: 'Переключить микрофон',
      stopShare: 'Остановить показ',
      leave: 'Выйти',
      shareScreen: 'Показать экран в голосовой комнате',
      joinVoiceChannel: 'Войти в голосовой канал',
      leaveVoiceChannel: 'Покинуть голосовой канал',
      joinVoiceRoom: 'Войти в голос для этой комнаты',
      leaveVoiceRoom: 'Покинуть голосовую комнату',
      connectedSummary: (members: number, connected: number, modes: string) =>
        `${members} участников · ${connected} подключено · ${modes}`,
      modeVoice: 'голос',
      modeScreen: 'экран',
      modeUnknown: 'сессия',
    },
    messages: {
      placeholder: (roomLabel: string) => `Сообщение в ${roomLabel}...`,
      noMessages: 'Сообщений пока нет',
      noMessagesSystem: 'Системные обновления появятся здесь, как только рантайм сможет что-то показать.',
      noMessagesRoom: (roomLabel: string) =>
        `Начни разговор в ${roomLabel}, и новые сообщения появятся здесь.`,
      reply: 'Ответить',
      copy: 'Скопировать текст',
      attachImage: 'Прикрепить изображение (<40KB)',
      insertEmoji: 'Вставить эмодзи',
      imageTooLarge: 'Файл слишком большой. В этой демо Base64-вложения ограничены 40KB.',
    },
    settings: {
      description: 'Внешний вид, загрузка рантайма и метаданные подписанного локального архива.',
      showOnboarding: 'Показать onboarding при следующем запуске',
    },
    workspace: {
      addGroup: 'Добавить группу',
      groupSettings: 'Настройки группы',
      createGroupToStart: 'Создай группу, чтобы начать раскладывать каналы.',
      channelRouting: 'Маршрутизация каналов',
      routingNote: 'Тип и группа сохраняются локально только для этого shell.',
      deleteGroup: 'Удалить группу',
      saveWorkspace: 'Сохранить workspace',
      createGroupFirst: 'Перед сохранением workspace создай хотя бы одну группу.',
      invalidLayout: 'Структура workspace некорректна.',
      channelsRouted: (count: number) => `${count} каналов привязано к этой группе.`,
      channelCount: (count: number) => `${count} каналов`,
      joinChannelFirst: 'Сначала зайди в канал, затем сможешь привязать его к локальной группе.',
      name: 'Название',
      icon: 'Иконка',
      accent: 'Акцент',
      assignedChannels: 'Назначенные каналы',
      groupName: (index: number) => `Группа ${index}`,
      groupSelect: 'Группа',
      typeSelect: 'Тип',
      accents: {
        forest: 'Forest',
        slate: 'Slate',
        sand: 'Sand',
        ember: 'Ember',
      },
    },
    createSpace: {
      title: 'Создать пространство',
      description: 'Подключись к каналу, открой личную комнату или собери локальную структуру групп.',
      joinCreateChannel: 'Войти или создать канал',
      openDirectRoom: 'Открыть личную комнату',
      createGroup: 'Создать группу',
      channelType: 'Тип канала',
      channelName: 'Название канала',
      peerNickname: 'Никнейм пира',
      groupName: 'Название группы',
      textChannel: 'Текстовый канал',
      voiceChannel: 'Голосовой канал',
      channelNameInvalid: 'Некорректное имя канала.',
      peerTargetInvalid: 'Некорректная цель для личной комнаты.',
      groupInvalid: 'Некорректная группа.',
      joinChannelFirst: 'Сначала подключись к каналу, и только потом сможешь добавить его в группу.',
    },
    notifications: {
      mentionFrom: (author: string) => `Упоминание от ${author}`,
      directMessageFrom: (author: string) => `Личное сообщение от ${author}`,
      newMessageIn: (roomLabel: string) => `Новое сообщение в ${roomLabel}`,
    },
    peerStatus: {
      self: 'Вы',
      online: 'Онлайн',
    },
  },
} as const

export type I18nCopy = (typeof translations)[AppLanguage]

export function detectSystemLanguage(input?: string): AppLanguage {
  const source =
    input ??
    (typeof navigator !== 'undefined'
      ? navigator.languages?.find(Boolean) ?? navigator.language
      : 'en')
  const normalized = source.trim().toLowerCase()

  if (normalized.startsWith('ru')) {
    return 'ru'
  }

  return 'en'
}

export function resolveAppLanguage(
  preference: LanguagePreference,
  systemLanguage: AppLanguage,
): AppLanguage {
  return preference === 'system' ? systemLanguage : preference
}

export function getI18nCopy(language: AppLanguage): I18nCopy {
  return translations[language]
}

export function getLanguageOptionLabel(
  copy: I18nCopy,
  preference: LanguagePreference,
  systemLanguage: AppLanguage,
): string {
  if (preference === 'system') {
    return copy.languageNames.systemResolved(copy.languageNames[systemLanguage])
  }

  return copy.languageNames[preference]
}

export function localizeRuntimeState(copy: I18nCopy, state: string): string {
  if (state === 'Runtime online') {
    return copy.runtime.online
  }
  if (state === 'Runtime offline') {
    return copy.runtime.offline
  }
  return state
}

export function localizePeerStatus(copy: I18nCopy, status: string): string {
  if (status === 'self') {
    return copy.peerStatus.self
  }
  if (status === 'online') {
    return copy.peerStatus.online
  }
  return status
}

export function describeArchiveStateLabel(
  copy: I18nCopy,
  fingerprint: string | undefined,
  verified: boolean | undefined,
): string {
  if (!fingerprint) {
    return copy.archive.pending
  }
  if (verified) {
    return copy.archive.signedBy(fingerprint)
  }
  return copy.archive.failed(fingerprint)
}

export function formatCallModes(copy: I18nCopy, modes: string[]): string {
  return modes
    .map((mode) => {
      if (mode === 'voice') {
        return copy.call.modeVoice
      }
      if (mode === 'screen') {
        return copy.call.modeScreen
      }
      return copy.call.modeUnknown
    })
    .join(' + ')
}
