import { useEffect, useMemo, useState } from 'react'

import type { ChannelType, LanguagePreference, RoomGroup, ThemeId } from '../../lib/appShellSchemas'
import { describeArchiveStateLabel } from '../../lib/i18n'
import { formatRoomTitle } from '../../lib/chatPresentation'
import { useGlobalSearchArchives } from '../../hooks/useGlobalSearchArchives'
import type { MediaSessionState } from '../../hooks/useMediaSession'
import type { VerifiedArchive } from '../../lib/appShellStorage'
import { buildGlobalSearchEntries, type GlobalSearchResult } from '../../lib/globalMessageSearch'
import type {
  DesktopSnapshot,
  Message,
  PeerSummary,
  RoomSummary,
  VoiceRoom,
  UpdateRuntimeSettingsInput,
} from '../../lib/schemas'
import { useI18n } from '../I18nProvider'
import { Titlebar } from '../Titlebar'
import { ShellToaster } from '../ShellToaster'
import { CallDock } from './CallDock'
import { ConversationSidebar } from './ConversationSidebar'
import { ConversationView } from './ConversationView'
import { CreateSpaceDialog } from './CreateSpaceDialog'
import { GlobalSearchDialog } from './GlobalSearchDialog'
import { MemberSidebar } from './MemberSidebar'
import { ServerRail } from './ServerRail'
import { SettingsDialog } from './SettingsDialog'
import { getChannelType } from '../../lib/appShellStorage'

type MediaSessionController = {
  state: MediaSessionState
  joinVoiceRoom: (roomId: string, withScreenShare: boolean) => Promise<void>
  leaveVoiceRoom: () => Promise<void>
  toggleMicrophone: () => void
  startScreenShare: () => Promise<void>
  stopScreenShare: () => Promise<void>
}

type MainSurfaceProps = {
  data: DesktopSnapshot
  runtimeDraft: UpdateRuntimeSettingsInput
  preferences: {
    theme: ThemeId
    languagePreference: LanguagePreference
    selectedDock: 'home' | 'group'
    selectedGroupId: string
    selectedRoomId: string
  }
  reconciledGroups: RoomGroup[]
  visibleRooms: RoomSummary[]
  activeRoom: RoomSummary
  visiblePeers: PeerSummary[]
  mentionablePeerNames: string[]
  createDialogOpen: boolean
  settingsOpen: boolean
  archiveState: {
    archive: VerifiedArchive | null
    mergedMessages: DesktopSnapshot['messages']
  }
  archiveRefreshToken: number
  identityFingerprint: string
  mediaLabel: string
  activeVoiceRoom: VoiceRoom | null
  mediaSession: MediaSessionController
  messageDraft: string
  roomTypes: Record<string, ChannelType>
  unreadCounts: Record<string, number>
  mutedRoomIds: string[]
  pinnedMessages: Message[]
  pinnedMessageIds: string[]
  publishPending: boolean
  publishError?: string
  runtimeTogglePending: boolean
  runtimeToggleError?: string
  runtimeSettingsPending: boolean
  runtimeSettingsError?: string
  onToggleRuntime: () => void
  onSelectHome: () => void
  onSelectGroup: (groupId: string) => void
  onOpenCreate: () => void
  onCloseCreate: (open: boolean) => void
  onOpenSettings: (open: boolean) => void
  onSelectRoom: (roomId: string) => void
  onOpenDirectRoom: (target: string) => void
  onCreateChannel: (room: string, channelType: ChannelType) => void
  onCreateGroup: (group: Omit<RoomGroup, 'id'>) => void
  onDraftChange: (value: string) => void
  onSendMessage: () => void
  onTogglePinMessage: (messageId: string) => void
  onToggleMuteRoom: (roomId: string) => void
  onThemeChange: (theme: ThemeId) => void
  onLanguagePreferenceChange: (value: 'system' | 'en' | 'ru') => void
  onRuntimeDraftChange: (draft: UpdateRuntimeSettingsInput) => void
  onSaveRuntime: () => void
  onSaveWorkspace: (
    groups: RoomGroup[],
    roomTypes: Record<string, ChannelType>,
    selectedGroupId: string,
  ) => void
  onRestoreStorage: () => void
  onResetOnboarding: () => void
}

export function MainSurface({
  data,
  runtimeDraft,
  preferences,
  reconciledGroups,
  visibleRooms,
  activeRoom,
  visiblePeers,
  mentionablePeerNames,
  createDialogOpen,
  settingsOpen,
  archiveState,
  archiveRefreshToken,
  identityFingerprint,
  mediaLabel,
  activeVoiceRoom,
  mediaSession,
  messageDraft,
  roomTypes,
  unreadCounts,
  mutedRoomIds,
  pinnedMessages,
  pinnedMessageIds,
  publishPending,
  publishError,
  runtimeTogglePending,
  runtimeToggleError,
  runtimeSettingsPending,
  runtimeSettingsError,
  onToggleRuntime,
  onSelectHome,
  onSelectGroup,
  onOpenCreate,
  onCloseCreate,
  onOpenSettings,
  onSelectRoom,
  onOpenDirectRoom,
  onCreateChannel,
  onCreateGroup,
  onDraftChange,
  onSendMessage,
  onTogglePinMessage,
  onToggleMuteRoom,
  onThemeChange,
  onLanguagePreferenceChange,
  onRuntimeDraftChange,
  onSaveRuntime,
  onSaveWorkspace,
  onRestoreStorage,
  onResetOnboarding,
}: MainSurfaceProps) {
  const { copy } = useI18n()
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{ roomId: string; messageId: string } | null>(null)
  const globalArchives = useGlobalSearchArchives(archiveRefreshToken)
  const archiveLabel = describeArchiveStateLabel(
    copy,
    archiveState.archive?.signerFingerprint ?? identityFingerprint,
    archiveState.archive?.verified,
  )
  const globalSearchEntries = useMemo(
    () => buildGlobalSearchEntries(data.messages, globalArchives.data ?? [], data.rooms),
    [data.messages, data.rooms, globalArchives.data],
  )

  useEffect(() => {
    function handleGlobalSearchHotkey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
        return
      }

      event.preventDefault()
      setGlobalSearchOpen(true)
    }

    window.addEventListener('keydown', handleGlobalSearchHotkey)
    return () => window.removeEventListener('keydown', handleGlobalSearchHotkey)
  }, [])

  function handleGlobalSearchResult(result: GlobalSearchResult) {
    setGlobalSearchOpen(false)
    setFocusTarget({
      roomId: result.roomId,
      messageId: result.messageId,
    })
    onSelectRoom(result.roomId)
  }

  return (
    <main className="flex h-screen flex-col bg-[var(--app)] text-foreground">
      <ShellToaster />
      <Titlebar
        runtime={data.runtime}
        onOpenGlobalSearch={() => setGlobalSearchOpen(true)}
        onToggleRuntime={onToggleRuntime}
        isBusy={runtimeTogglePending}
        errorNote={runtimeToggleError}
      />
      <section className="flex min-h-0 flex-1">
        <ServerRail
          groups={reconciledGroups}
          selectedDock={preferences.selectedDock}
          selectedGroupId={preferences.selectedGroupId}
          onSelectHome={onSelectHome}
          onSelectGroup={onSelectGroup}
          onOpenCreate={onOpenCreate}
        />
        <ConversationSidebar
          runtime={data.runtime}
          currentUser={runtimeDraft.nickname}
          selectedDock={preferences.selectedDock}
          activeGroup={reconciledGroups.find((group) => group.id === preferences.selectedGroupId)}
          rooms={visibleRooms}
          peers={data.peers}
          selectedRoomId={activeRoom.id}
          unreadCounts={unreadCounts}
          mutedRoomIds={mutedRoomIds}
          mediaLabel={mediaLabel}
          roomTypes={roomTypes}
          activeVoiceRoom={activeVoiceRoom}
          onSelectRoom={onSelectRoom}
          onOpenSettings={() => onOpenSettings(true)}
          onOpenCreate={onOpenCreate}
          onOpenDirectRoom={onOpenDirectRoom}
        />
        <ConversationView
          room={activeRoom}
          peers={visiblePeers}
          messages={archiveState.mergedMessages}
          archiveFingerprint={archiveState.archive?.signerFingerprint}
          archiveVerified={archiveState.archive?.verified}
          externalFocusMessageId={
            focusTarget?.roomId === activeRoom.id ? focusTarget.messageId : undefined
          }
          muted={mutedRoomIds.includes(activeRoom.id)}
          draft={messageDraft}
          isSending={publishPending}
          mediaLive={mediaSession.state.status === 'live'}
          mediaRoomId={mediaSession.state.activeRoomId}
          channelType={getChannelType(activeRoom, roomTypes)}
          peerNames={mentionablePeerNames}
          pinnedMessages={pinnedMessages}
          pinnedMessageIds={pinnedMessageIds}
          errorNote={publishError}
          onDraftChange={onDraftChange}
          onSend={onSendMessage}
          onTogglePinMessage={onTogglePinMessage}
          onToggleMute={() => onToggleMuteRoom(activeRoom.id)}
          onResolveExternalFocus={() => setFocusTarget(null)}
          onOpenSettings={() => onOpenSettings(true)}
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
          onOpenDirectRoom={onOpenDirectRoom}
        />
      </section>
      <CreateSpaceDialog
        open={createDialogOpen}
        availableChannels={visibleRooms.filter((room) => room.kind === 'channel')}
        peers={data.peers}
        onOpenChange={onCloseCreate}
        onCreateChannel={onCreateChannel}
        onCreateGroup={onCreateGroup}
        onCreateDirect={onOpenDirectRoom}
      />
      <SettingsDialog
        open={settingsOpen}
        theme={preferences.theme}
        languagePreference={preferences.languagePreference}
        runtimeDraft={runtimeDraft}
        groups={reconciledGroups}
        rooms={visibleRooms}
        roomTypes={roomTypes}
        selectedGroupId={preferences.selectedGroupId}
        runtimeError={runtimeSettingsError}
        archiveLabel={archiveLabel}
        archiveFingerprint={archiveState.archive?.signerFingerprint ?? identityFingerprint}
        archiveVerified={archiveState.archive?.verified}
        saving={runtimeSettingsPending}
        onOpenChange={onOpenSettings}
        onThemeChange={onThemeChange}
        onLanguagePreferenceChange={onLanguagePreferenceChange}
        onRuntimeDraftChange={onRuntimeDraftChange}
        onSaveRuntime={onSaveRuntime}
        onSaveWorkspace={onSaveWorkspace}
        onRestoreStorage={onRestoreStorage}
        onResetOnboarding={onResetOnboarding}
      />
      <GlobalSearchDialog
        open={globalSearchOpen}
        entries={globalSearchEntries}
        onOpenChange={setGlobalSearchOpen}
        onSelectResult={handleGlobalSearchResult}
      />
      <CallDock
        roomLabel={formatRoomTitle(activeRoom, copy.common.unknownRoom)}
        memberCount={visiblePeers.length}
        mediaState={mediaSession.state}
        onToggleMicrophone={mediaSession.toggleMicrophone}
        onStopScreenShare={mediaSession.stopScreenShare}
        onLeaveVoice={mediaSession.leaveVoiceRoom}
      />
    </main>
  )
}
