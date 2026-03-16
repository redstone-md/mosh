import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BootstrapErrorScreen, LoadingScreen } from './components/AppBootstrapState'
import { ShellToaster } from './components/ShellToaster'
import { CallDock } from './components/shell/CallDock'
import { ConversationSidebar } from './components/shell/ConversationSidebar'
import { ConversationView } from './components/shell/ConversationView'
import { CreateSpaceDialog } from './components/shell/CreateSpaceDialog'
import { IntroSurface } from './components/shell/IntroSurface'
import { MemberSidebar } from './components/shell/MemberSidebar'
import { OnboardingSurface } from './components/shell/OnboardingSurface'
import { ServerRail } from './components/shell/ServerRail'
import { SettingsDialog } from './components/shell/SettingsDialog'
import { Titlebar } from './components/Titlebar'
import { useDesktopErrorDialogs } from './hooks/useDesktopErrorDialogs'
import { useDesktopNotifications } from './hooks/useDesktopNotifications'
import { useMediaSession } from './hooks/useMediaSession'
import { useSignedChatArchive } from './hooks/useSignedChatArchive'
import { findRoomById, getVisiblePeers, sameRuntimeDraft, selectRoomFallback, toRuntimeDraft } from './lib/appShellSelectors'
import { ensureSigningIdentity } from './lib/appShellStorage'
import { getChannelType, hasPersistedPreferences, loadPreferences, reconcileGroups, reconcileRoomTypes, savePreferences } from './lib/appShellStorage'
import { dedupeMessages, describeArchiveState, formatRoomTitle } from './lib/chatPresentation'
import { desktopStatusClient } from './lib/desktopStatusClient'
import { getFallbackRoom } from './lib/fallbacks'
import type { ChannelType, RoomGroup, ThemeId } from './lib/appShellSchemas'
import type { UpdateRuntimeSettingsInput } from './lib/schemas'

export function App() {
  const queryClient = useQueryClient()
  const settingsHydratedRef = useRef(false)
  const runtimeAutoStartRef = useRef(false)
  const [preferences, setPreferences] = useState(loadPreferences)
  const [messageDraft, setMessageDraft] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [identityFingerprint, setIdentityFingerprint] = useState<string>('')
  const [introComplete, setIntroComplete] = useState(() => hasPersistedPreferences())

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

  const mediaSession = useMediaSession(snapshot.data)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      savePreferences(preferences)
    }, 120)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [preferences])

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
  }, [preferences.theme])

  useEffect(() => {
    void ensureSigningIdentity().then((identity) => {
      setIdentityFingerprint(identity.fingerprint)
    })
  }, [])

  useEffect(() => {
    if (!snapshot.data || settingsHydratedRef.current) {
      return
    }
    settingsHydratedRef.current = true

    if (!sameRuntimeDraft(snapshot.data.settings, preferences.runtimeDraft)) {
      void updateRuntimeSettings.mutateAsync(preferences.runtimeDraft).catch(() => {
        settingsHydratedRef.current = false
      })
    }
  }, [preferences.runtimeDraft, snapshot.data, updateRuntimeSettings])

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
  })

  useDesktopErrorDialogs({
    errors: [
      snapshot.error instanceof Error ? snapshot.error.message : undefined,
      toggleRuntime.error?.message,
      updateRuntimeSettings.error?.message,
      subscribeRoom.error?.message,
      openDirectRoom.error?.message,
      publishMessage.error?.message,
      mediaSession.state.error ?? undefined,
    ].filter((value): value is string => Boolean(value)),
  })

  const data = snapshot.data
  const runtimeDraft = preferences.runtimeDraft
  const showOnboarding =
    data?.runtime.state !== 'Runtime online' && !preferences.onboardingCompleted
  const mentionablePeerNames = useMemo(
    () =>
      (data?.peers ?? [])
        .filter((peer) => peer.status !== 'self')
        .map((peer) => peer.displayName),
    [data?.peers],
  )
  const visibleRooms = useMemo(
    () => (data?.rooms.length ? data.rooms : [getFallbackRoom()]),
    [data?.rooms],
  )
  const reconciledGroups = useMemo(
    () => reconcileGroups(preferences.groups, visibleRooms),
    [preferences.groups, visibleRooms],
  )
  const reconciledRoomTypes = useMemo(
    () => reconcileRoomTypes(preferences.roomTypes, visibleRooms),
    [preferences.roomTypes, visibleRooms],
  )
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
  const visiblePeers = useMemo(
    () => (data ? getVisiblePeers(activeRoom, data.peers) : []),
    [activeRoom, data],
  )
  const liveMessages = useMemo(
    () =>
      data
        ? dedupeMessages(data.messages.filter((message) => message.roomId === activeRoom.id))
        : [],
    [activeRoom.id, data?.messages],
  )
  const archiveState = useSignedChatArchive(showOnboarding ? '__inactive__' : activeRoom.id, showOnboarding ? [] : liveMessages)

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

  if (snapshot.isPending) {
    return <LoadingScreen />
  }

  if (snapshot.isError) {
    return <BootstrapErrorScreen message={snapshot.error.message} />
  }

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

  function handleSkipOnboarding() {
    setPreferences((current) => ({
      ...current,
      onboardingCompleted: true,
    }))
  }

  async function handleSaveRuntime() {
    await updateRuntimeSettings.mutateAsync(preferences.runtimeDraft)
  }

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

  function handleThemeChange(theme: ThemeId) {
    setPreferences((current) => ({
      ...current,
      theme,
    }))
  }

  function handleRuntimeDraftChange(draft: UpdateRuntimeSettingsInput) {
    setPreferences((current) => ({
      ...current,
      runtimeDraft: draft,
    }))
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

  const mediaLabel =
    mediaSession.state.activeRoomId
      ? `${formatRoomTitle(visibleRooms.find((room) => room.id === mediaSession.state.activeRoomId))} · ${mediaSession.state.remoteStreams.length} peers`
      : 'Voice idle'
  const activeVoiceRoom = data.voiceRooms.find((room) => room.joined) ?? null

  if (!introComplete) {
    return (
      <IntroSurface
        runtime={data.runtime}
        isBusy={toggleRuntime.isPending}
        errorNote={toggleRuntime.error?.message}
        onToggleRuntime={() => toggleRuntime.mutate()}
        onComplete={() => setIntroComplete(true)}
      />
    )
  }

  if (showOnboarding) {
    return (
      <OnboardingSurface
        runtime={data.runtime}
        theme={preferences.theme}
        runtimeDraft={runtimeDraft}
        isBusy={toggleRuntime.isPending || updateRuntimeSettings.isPending}
        formErrorNote={toggleRuntime.error?.message ?? updateRuntimeSettings.error?.message}
        titlebarErrorNote={toggleRuntime.error?.message}
        onThemeChange={handleThemeChange}
        onRuntimeDraftChange={handleRuntimeDraftChange}
        onStart={() => void handleStartFromOnboarding()}
        onSkip={handleSkipOnboarding}
        onToggleRuntime={() => toggleRuntime.mutate()}
        runtimeToggleBusy={toggleRuntime.isPending}
      />
    )
  }

  return (
    <main className="flex h-screen flex-col bg-[var(--app)] text-foreground">
      <ShellToaster />

      <Titlebar
        runtime={data.runtime}
        onToggleRuntime={() => toggleRuntime.mutate()}
        isBusy={toggleRuntime.isPending}
        errorNote={toggleRuntime.error?.message}
      />

      <section className="flex min-h-0 flex-1">
        <ServerRail
          groups={reconciledGroups}
          selectedDock={preferences.selectedDock}
          selectedGroupId={preferences.selectedGroupId}
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
        />

        <ConversationSidebar
          runtime={data.runtime}
          currentUser={runtimeDraft.nickname}
          selectedDock={preferences.selectedDock}
          activeGroup={reconciledGroups.find((group) => group.id === preferences.selectedGroupId)}
          rooms={visibleRooms}
          peers={data.peers}
          selectedRoomId={activeRoom.id}
          mediaLabel={mediaLabel}
          roomTypes={reconciledRoomTypes}
          activeVoiceRoom={activeVoiceRoom}
          onSelectRoom={(roomId) =>
            setPreferences((current) => ({
              ...current,
              selectedRoomId: roomId,
              selectedDock: findRoomById(visibleRooms, roomId)?.kind === 'dm' ? 'home' : current.selectedDock,
            }))
          }
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenCreate={() => setCreateDialogOpen(true)}
          onOpenDirectRoom={(target) => openDirectRoom.mutate(target)}
        />

        <ConversationView
          room={activeRoom}
          peers={visiblePeers}
          messages={archiveState.mergedMessages}
          archiveFingerprint={archiveState.archive?.signerFingerprint}
          archiveVerified={archiveState.archive?.verified}
          draft={messageDraft}
          isSending={publishMessage.isPending}
          mediaLive={mediaSession.state.status === 'live'}
          mediaRoomId={mediaSession.state.activeRoomId}
          channelType={getChannelType(activeRoom, reconciledRoomTypes)}
          peerNames={mentionablePeerNames}
          errorNote={publishMessage.error?.message}
          onDraftChange={setMessageDraft}
          onSend={() => void handleSendMessage()}
          onOpenSettings={() => setSettingsOpen(true)}
          onStartVoice={() => {
            if (mediaSession.state.activeRoomId === activeRoom.id) {
              void mediaSession.leaveVoiceRoom()
              return
            }
            void mediaSession.joinVoiceRoom(activeRoom.id, false)
          }}
          onStartScreenShare={() => {
            if (mediaSession.state.activeRoomId === activeRoom.id) {
              if (mediaSession.state.screenSharingEnabled) {
                void mediaSession.stopScreenShare()
              } else {
                void mediaSession.startScreenShare()
              }
              return
            }
            void mediaSession.joinVoiceRoom(activeRoom.id, true)
          }}
        />

        <MemberSidebar
          room={activeRoom}
          peers={visiblePeers}
          archiveFingerprint={archiveState.archive?.signerFingerprint ?? identityFingerprint}
          archiveVerified={archiveState.archive?.verified}
          mediaLabel={mediaLabel}
          activeVoiceRoom={activeVoiceRoom}
          onOpenDirectRoom={(target) => openDirectRoom.mutate(target)}
        />
      </section>

      <CreateSpaceDialog
        open={createDialogOpen}
        availableChannels={visibleRooms.filter((room) => room.kind === 'channel')}
        peers={data.peers}
        onOpenChange={setCreateDialogOpen}
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
        onCreateDirect={(target) => openDirectRoom.mutate(target)}
      />

      <SettingsDialog
        open={settingsOpen}
        theme={preferences.theme}
        runtimeDraft={runtimeDraft}
        groups={reconciledGroups}
        rooms={visibleRooms}
        roomTypes={reconciledRoomTypes}
        selectedGroupId={preferences.selectedGroupId}
        runtimeError={updateRuntimeSettings.error?.message}
        archiveLabel={describeArchiveState(
          archiveState.archive?.signerFingerprint ?? identityFingerprint,
          archiveState.archive?.verified,
        )}
        archiveFingerprint={archiveState.archive?.signerFingerprint ?? identityFingerprint}
        archiveVerified={archiveState.archive?.verified}
        saving={updateRuntimeSettings.isPending}
        onOpenChange={setSettingsOpen}
        onThemeChange={handleThemeChange}
        onRuntimeDraftChange={handleRuntimeDraftChange}
        onSaveRuntime={() => void handleSaveRuntime()}
        onSaveWorkspace={handleSaveWorkspace}
        onResetOnboarding={() =>
          setPreferences((current) => ({
            ...current,
            onboardingCompleted: false,
          }))
        }
      />

      <CallDock
        roomLabel={formatRoomTitle(activeRoom)}
        memberCount={visiblePeers.length}
        mediaState={mediaSession.state}
        onToggleMicrophone={mediaSession.toggleMicrophone}
        onStopScreenShare={mediaSession.stopScreenShare}
        onLeaveVoice={mediaSession.leaveVoiceRoom}
      />
    </main>
  )
}
