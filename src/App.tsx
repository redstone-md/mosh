import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BootstrapErrorScreen, LoadingScreen } from './components/AppBootstrapState'
import { MainSurface } from './components/shell/MainSurface'
import { ShellI18nFrame } from './components/shell/ShellI18nFrame'
import { OnboardingSurface } from './components/shell/OnboardingSurface'
import { useDesktopErrorDialogs } from './hooks/useDesktopErrorDialogs'
import { useDesktopNotifications } from './hooks/useDesktopNotifications'
import { useIdentityTransferFlow } from './hooks/useIdentityTransferFlow'
import { useInviteFlow } from './hooks/useInviteFlow'
import { useMediaSession } from './hooks/useMediaSession'
import { useDocumentAppearance } from './hooks/useDocumentAppearance'
import { usePeerTrustState } from './hooks/usePeerTrustState'
import { useRoomActivityState } from './hooks/useRoomActivityState'
import { useShellPreferences } from './hooks/useShellPreferences'
import { useSignedChatArchive } from './hooks/useSignedChatArchive'
import { findRoomById, getVisiblePeers, sameRuntimeDraft, selectRoomFallback, toRuntimeDraft } from './lib/appShellSelectors'
import { reconcileGroups, reconcileRoomTypes } from './lib/appShellStorage'
import { dedupeMessages, formatRoomTitle } from './lib/chatPresentation'
import { desktopStatusClient } from './lib/desktopStatusClient'
import { getFallbackRoom } from './lib/fallbacks'
import { detectSystemLanguage, getI18nCopy } from './lib/i18n'
import { resolvePinnedMessages, togglePinnedMessage } from './lib/messagePins'
import type { ChannelType, RoomGroup, ThemeId } from './lib/appShellSchemas'
import type { UpdateRuntimeSettingsInput } from './lib/schemas'

export function App() {
  const queryClient = useQueryClient()
  const settingsHydratedRef = useRef(false)
  const runtimeAutoStartRef = useRef(false)
  const shellPreferences = useShellPreferences()
  const { preferences, setPreferences, identityFingerprint, regenerateIdentity, reload } = shellPreferences
  const [messageDraft, setMessageDraft] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [archiveRefreshKey, setArchiveRefreshKey] = useState(0)
  const systemLanguage = useMemo(() => detectSystemLanguage(), [])

  const snapshot = useQuery({
    queryKey: ['desktop-snapshot'],
    queryFn: () => desktopStatusClient.getSnapshot(),
    refetchInterval: 1500,
  })

  const toggleRuntime = useMutation({
    mutationFn: () => desktopStatusClient.toggleRuntime(),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
    },
  })

  const updateRuntimeSettings = useMutation({
    mutationFn: (draft: UpdateRuntimeSettingsInput) => desktopStatusClient.updateRuntimeSettings(draft),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      setPreferences((current) => ({
        ...current,
        runtimeDraft: toRuntimeDraft(data.settings),
        selectedRoomId: data.settings.initialRoom,
      }))
    },
  })

  const subscribeRoom = useMutation({
    mutationFn: (room: string) => desktopStatusClient.subscribeRoom({ room }),
    onSuccess: (data, room) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      setPreferences((current) => ({
        ...current,
        selectedDock: 'group',
        selectedRoomId: room.replace(/^#/, '').toLowerCase(),
      }))
    },
  })

  const openDirectRoom = useMutation({
    mutationFn: (target: string) => desktopStatusClient.openDirectRoom({ target }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      const nextRoom =
        data.rooms.find((room) => room.kind === 'dm' && room.id !== preferences.selectedRoomId) ??
        data.rooms.find((room) => room.kind === 'dm')
      if (nextRoom) {
        setPreferences((current) => ({
          ...current,
          selectedDock: 'home',
          selectedRoomId: nextRoom.id,
        }))
      }
    },
  })

  const publishMessage = useMutation({
    mutationFn: ({ roomId, body }: { roomId: string; body: string }) =>
      desktopStatusClient.publishMessage({
        room: roomId,
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
      setMessageDraft('')
    },
  })

  const connectPeer = useMutation({
    mutationFn: (addr: string) => desktopStatusClient.connectPeer({ addr }),
    onSuccess: (data) => {
      queryClient.setQueryData(['desktop-snapshot'], data)
    },
  })

  const mediaSession = useMediaSession(snapshot.data)
  const activeLanguage = useDocumentAppearance(preferences.theme, preferences.languagePreference, systemLanguage)
  const activeCopy = getI18nCopy(activeLanguage)

  useEffect(() => {
    if (shellPreferences.isPending || !snapshot.data || settingsHydratedRef.current) {
      return
    }
    settingsHydratedRef.current = true

    if (!sameRuntimeDraft(snapshot.data.settings, preferences.runtimeDraft)) {
      void updateRuntimeSettings.mutateAsync(preferences.runtimeDraft).catch(() => {
        settingsHydratedRef.current = false
      })
    }
  }, [preferences.runtimeDraft, shellPreferences.isPending, snapshot.data, updateRuntimeSettings])

  useEffect(() => {
    if (!snapshot.data || !preferences.onboardingCompleted) {
      return
    }
    if (!settingsHydratedRef.current || runtimeAutoStartRef.current) {
      return
    }
    if (snapshot.data.runtime.state !== 'Runtime offline') {
      return
    }

    runtimeAutoStartRef.current = true
    void toggleRuntime.mutateAsync().catch(() => undefined)
  }, [preferences.onboardingCompleted, snapshot.data, toggleRuntime])

  useDesktopNotifications({
    snapshot: snapshot.data,
    selectedRoomId: preferences.selectedRoomId,
    mutedRoomIds: preferences.mutedRooms,
    language: activeLanguage,
  })

  useDesktopErrorDialogs({
    errors: [
      snapshot.error instanceof Error ? snapshot.error.message : undefined,
      shellPreferences.error instanceof Error ? shellPreferences.error.message : undefined,
      toggleRuntime.error?.message,
      updateRuntimeSettings.error?.message,
      subscribeRoom.error?.message,
      openDirectRoom.error?.message,
      publishMessage.error?.message,
      connectPeer.error?.message,
      mediaSession.state.error ?? undefined,
    ].filter((value): value is string => Boolean(value)),
  })

  const data = snapshot.data
  const runtimeDraft = preferences.runtimeDraft
  const showOnboarding = data?.runtime.state !== 'Runtime online' && !preferences.onboardingCompleted
  const mentionablePeerNames = useMemo(() => (data?.peers ?? []).filter((peer) => peer.status !== 'self').map((peer) => peer.displayName), [data?.peers])
  const visibleRooms = useMemo(() => (data?.rooms.length ? data.rooms : [getFallbackRoom()]), [data?.rooms])
  const reconciledGroups = useMemo(() => reconcileGroups(preferences.groups, visibleRooms), [preferences.groups, visibleRooms])
  const reconciledRoomTypes = useMemo(() => reconcileRoomTypes(preferences.roomTypes, visibleRooms), [preferences.roomTypes, visibleRooms])
  const activeRoom = useMemo(
    () =>
      data
        ? selectRoomFallback(
            visibleRooms,
            preferences.selectedDock,
            reconciledGroups,
            preferences.selectedGroupId,
            preferences.selectedRoomId,
            data.settings.initialRoom,
          ) ?? getFallbackRoom()
        : getFallbackRoom(),
    [
      data,
      preferences.selectedDock,
      preferences.selectedGroupId,
      preferences.selectedRoomId,
      reconciledGroups,
      visibleRooms,
    ],
  )
  const visiblePeers = useMemo(() => (data ? getVisiblePeers(activeRoom, data.peers) : []), [activeRoom, data])
  const liveMessages = useMemo(
    () =>
      data
        ? dedupeMessages(data.messages.filter((message) => message.roomId === activeRoom.id))
        : [],
    [activeRoom.id, data?.messages],
  )
  const archiveState = useSignedChatArchive(
    showOnboarding ? '__inactive__' : activeRoom.id,
    showOnboarding ? [] : liveMessages,
    archiveRefreshKey,
  )
  const activePinnedMessageIds = preferences.pinnedMessages[activeRoom.id] ?? []
  const pinnedMessages = useMemo(
    () => resolvePinnedMessages(preferences.pinnedMessages, activeRoom.id, archiveState.mergedMessages),
    [activeRoom.id, archiveState.mergedMessages, preferences.pinnedMessages],
  )
  const roomActivity = useRoomActivityState({
    snapshot: data,
    selectedRoomId: preferences.selectedRoomId,
    lastReadMessageIds: preferences.lastReadMessageIds,
    mutedRooms: preferences.mutedRooms,
    setPreferences,
  })
  const peerTrust = usePeerTrustState({
    peers: data?.peers ?? [],
    trustedPeers: preferences.trustedPeers,
    setPreferences,
  })

  useEffect(() => {
    if (JSON.stringify(reconciledGroups) === JSON.stringify(preferences.groups)) {
      return
    }
    setPreferences((current) => ({
      ...current,
      groups: reconciledGroups,
    }))
  }, [preferences.groups, reconciledGroups])

  useEffect(() => {
    if (JSON.stringify(reconciledRoomTypes) === JSON.stringify(preferences.roomTypes)) {
      return
    }
    setPreferences((current) => ({
      ...current,
      roomTypes: reconciledRoomTypes,
    }))
  }, [preferences.roomTypes, reconciledRoomTypes])
  const inviteFlow = useInviteFlow({
    copy: {
      inviteApplied: activeCopy.createSpace.inviteApplied,
      inviteInvalid: activeCopy.createSpace.inviteInvalid,
    },
    data,
    runtimeDraft: preferences.runtimeDraft,
    currentIdentityFingerprint: identityFingerprint,
    regenerateIdentity,
    setPreferences,
    updateRuntimeSettings,
    connectPeer,
    subscribeRoom,
  })
  const identityTransferFlow = useIdentityTransferFlow({
    copy: {
      invalidLink: activeCopy.identityTransfer.deepLinkInvalid,
      imported: activeCopy.identityTransfer.deepLinkImported,
      importFailed: activeCopy.identityTransfer.importFailed,
    },
    currentIdentityFingerprint: identityFingerprint,
    onImported: reload,
  })
  const shellFrameProps = {
    language: activeLanguage,
    systemLanguage,
    languagePreference: preferences.languagePreference,
    onLanguagePreferenceChange: handleLanguagePreferenceChange,
    invite: {
      pendingInvite: inviteFlow.pendingInvite,
      isBusy: inviteFlow.reviewPending,
      currentIdentityFingerprint: inviteFlow.currentIdentityFingerprint,
      identityMode: inviteFlow.identityMode,
      onIdentityModeChange: inviteFlow.setIdentityMode,
      onApprove: () => void inviteFlow.approvePendingInvite(),
      onDismiss: inviteFlow.dismissPendingInvite,
    },
    identityTransfer: {
      pendingTransfer: identityTransferFlow.pendingTransfer,
      currentIdentityFingerprint: identityTransferFlow.currentIdentityFingerprint,
      passphrase: identityTransferFlow.passphrase,
      errorNote: identityTransferFlow.errorNote,
      isBusy: identityTransferFlow.importPending,
      onPassphraseChange: identityTransferFlow.setPassphrase,
      onApprove: () => void identityTransferFlow.approvePendingTransfer(),
      onDismiss: identityTransferFlow.dismissPendingTransfer,
    },
  }

  if (shellPreferences.isPending || snapshot.isPending) return <ShellI18nFrame {...shellFrameProps}><LoadingScreen /></ShellI18nFrame>
  if (shellPreferences.error instanceof Error) return <ShellI18nFrame {...shellFrameProps}><BootstrapErrorScreen message={shellPreferences.error.message} /></ShellI18nFrame>
  if (snapshot.isError) return <ShellI18nFrame {...shellFrameProps}><BootstrapErrorScreen message={snapshot.error.message} /></ShellI18nFrame>

  if (!data) {
    return null
  }

  async function handleStartFromOnboarding() {
    const updated = await updateRuntimeSettings.mutateAsync(preferences.runtimeDraft)
    setPreferences((current) => ({
      ...current,
      onboardingCompleted: true,
      selectedRoomId: updated.settings.initialRoom,
    }))
    if (updated.runtime.state !== 'Runtime online') {
      runtimeAutoStartRef.current = true
      void toggleRuntime.mutateAsync().catch(() => undefined)
    }
  }

  function handleSkipOnboarding() { setPreferences((current) => ({ ...current, onboardingCompleted: true })) }
  async function handleSaveRuntime() { await updateRuntimeSettings.mutateAsync(preferences.runtimeDraft) }

  function handleCreateGroup(group: Omit<RoomGroup, 'id'>) {
    const nextId = `group-${Date.now().toString(36)}`
    setPreferences((current) => ({
      ...current,
      selectedDock: 'group',
      selectedGroupId: nextId,
      groups: [
        ...current.groups,
        {
          id: nextId,
          ...group,
        },
      ],
    }))
  }

  async function handleSendMessage() {
    if (!activeRoom || messageDraft.trim().length === 0) {
      return
    }
    await publishMessage.mutateAsync({
      roomId: activeRoom.id,
      body: messageDraft.trim(),
    })
  }

  function handleThemeChange(theme: ThemeId) { setPreferences((current) => ({ ...current, theme })) }

  function handleLanguagePreferenceChange(languagePreference: 'system' | 'en' | 'ru') {
    setPreferences((current) => ({ ...current, languagePreference }))
  }

  function handleRuntimeDraftChange(draft: UpdateRuntimeSettingsInput) {
    setPreferences((current) => ({ ...current, runtimeDraft: draft }))
  }

  function handleSaveWorkspace(
    groups: RoomGroup[],
    roomTypes: Record<string, ChannelType>,
    selectedGroupId: string,
  ) {
    const nextGroups = reconcileGroups(groups, visibleRooms)
    const nextRoomTypes = reconcileRoomTypes(roomTypes, visibleRooms)
    const nextSelectedGroupId =
      nextGroups.find((group) => group.id === selectedGroupId)?.id ?? nextGroups[0]?.id ?? 'mesh'

    setPreferences((current) => ({
      ...current,
      groups: nextGroups,
      roomTypes: nextRoomTypes,
      selectedGroupId: nextSelectedGroupId,
    }))
  }

  async function handleRestoreStorage() {
    settingsHydratedRef.current = false
    runtimeAutoStartRef.current = false
    await shellPreferences.reload()
    await queryClient.invalidateQueries({ queryKey: ['desktop-snapshot'] })
    setArchiveRefreshKey((current) => current + 1)
  }

  const mediaLabel =
    mediaSession.state.activeRoomId
      ? activeCopy.runtime.roomLiveLabel(
          formatRoomTitle(
            visibleRooms.find((room) => room.id === mediaSession.state.activeRoomId),
            activeCopy.common.unknownRoom,
          ),
          mediaSession.state.remoteStreams.length,
        )
      : activeCopy.runtime.offlineLabel
  const activeVoiceRoom = data.voiceRooms.find((room) => room.joined) ?? null

  if (showOnboarding) {
    return (
      <ShellI18nFrame {...shellFrameProps}>
        <OnboardingSurface
        runtime={data.runtime}
        theme={preferences.theme}
        languagePreference={preferences.languagePreference}
        playIntro={!shellPreferences.hasPersistedPreferences}
        runtimeDraft={runtimeDraft}
        isBusy={toggleRuntime.isPending || updateRuntimeSettings.isPending}
        formErrorNote={toggleRuntime.error?.message ?? updateRuntimeSettings.error?.message}
        titlebarErrorNote={toggleRuntime.error?.message}
        onThemeChange={handleThemeChange}
        onLanguagePreferenceChange={handleLanguagePreferenceChange}
        onRuntimeDraftChange={handleRuntimeDraftChange}
        onStart={() => void handleStartFromOnboarding()}
        onSkip={handleSkipOnboarding}
        onToggleRuntime={() => toggleRuntime.mutate()}
        runtimeToggleBusy={toggleRuntime.isPending}
        />
      </ShellI18nFrame>
    )
  }

  return (
    <ShellI18nFrame {...shellFrameProps}>
      <MainSurface
        data={data}
        runtimeDraft={runtimeDraft}
        preferences={{
          theme: preferences.theme,
          languagePreference: preferences.languagePreference,
          selectedDock: preferences.selectedDock,
          selectedGroupId: preferences.selectedGroupId,
          selectedRoomId: preferences.selectedRoomId,
        }}
        reconciledGroups={reconciledGroups}
        visibleRooms={visibleRooms}
        activeRoom={activeRoom}
        visiblePeers={visiblePeers}
        mentionablePeerNames={mentionablePeerNames}
        createDialogOpen={createDialogOpen}
        settingsOpen={settingsOpen}
        archiveState={archiveState}
        archiveRefreshToken={archiveRefreshKey}
        identityFingerprint={identityFingerprint}
        mediaLabel={mediaLabel}
        activeVoiceRoom={activeVoiceRoom}
        mediaSession={mediaSession}
        messageDraft={messageDraft}
        roomTypes={reconciledRoomTypes}
        unreadCounts={roomActivity.unreadCounts}
        mutedRoomIds={roomActivity.mutedRooms}
        trustByPeerId={peerTrust.trustByPeerId}
        trustedPeerEntries={peerTrust.trustedPeerEntries}
        trustedCount={peerTrust.trustedCount}
        reviewCount={peerTrust.reviewCount}
        pinnedMessages={pinnedMessages}
        pinnedMessageIds={activePinnedMessageIds}
        publishPending={publishMessage.isPending}
        publishError={publishMessage.error?.message}
        runtimeTogglePending={toggleRuntime.isPending}
        runtimeToggleError={toggleRuntime.error?.message}
        runtimeSettingsPending={updateRuntimeSettings.isPending}
        runtimeSettingsError={updateRuntimeSettings.error?.message}
        onToggleRuntime={() => toggleRuntime.mutate()}
        onSelectHome={() =>
          setPreferences((current) => ({
            ...current,
            selectedDock: 'home',
            selectedRoomId:
              findRoomById(visibleRooms, current.selectedRoomId)?.kind === 'dm'
                ? current.selectedRoomId
                : visibleRooms.find((room) => room.kind === 'dm')?.id ?? current.selectedRoomId,
          }))
        }
        onSelectGroup={(groupId) =>
          setPreferences((current) => ({
            ...current,
            selectedDock: 'group',
            selectedGroupId: groupId,
          }))
        }
        onOpenCreate={() => setCreateDialogOpen(true)}
        onCloseCreate={setCreateDialogOpen}
        onOpenSettings={setSettingsOpen}
        onSelectRoom={(roomId) =>
          setPreferences((current) => ({
            ...current,
            selectedRoomId: roomId,
            selectedDock: findRoomById(visibleRooms, roomId)?.kind === 'dm' ? 'home' : current.selectedDock,
          }))
        }
        onOpenDirectRoom={(target) => openDirectRoom.mutate(target)}
        onCreateChannel={(room, channelType) => {
          setPreferences((current) => ({
            ...current,
            roomTypes: {
              ...current.roomTypes,
              [room.replace(/^#/, '').toLowerCase()]: channelType,
            },
          }))
          subscribeRoom.mutate(room)
        }}
        onCreateGroup={handleCreateGroup}
        onApplyInvite={inviteFlow.applyInvite}
        onDraftChange={setMessageDraft}
        onSendMessage={() => void handleSendMessage()}
        onTogglePinMessage={(messageId) =>
          setPreferences((current) => ({
            ...current,
            pinnedMessages: togglePinnedMessage(current.pinnedMessages, activeRoom.id, messageId),
          }))
        }
        onToggleMuteRoom={roomActivity.toggleRoomMute}
        onTogglePeerTrust={peerTrust.togglePeerTrust}
        onForgetPeer={peerTrust.removeTrustedPeer}
        onThemeChange={handleThemeChange}
        onLanguagePreferenceChange={handleLanguagePreferenceChange}
        onRuntimeDraftChange={handleRuntimeDraftChange}
        onSaveRuntime={() => void handleSaveRuntime()}
        onSaveWorkspace={handleSaveWorkspace}
        onRestoreStorage={() => void handleRestoreStorage()}
        onResetOnboarding={() =>
          setPreferences((current) => ({
            ...current,
            onboardingCompleted: false,
          }))
        }
      />
    </ShellI18nFrame>
  )
}
