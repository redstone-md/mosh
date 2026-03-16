import type { RoomGroup } from './appShellSchemas'
import type { DesktopSnapshot, PeerSummary, RoomSummary, UpdateRuntimeSettingsInput } from './schemas'

export type DockMode = 'home' | 'group'

export function sameRuntimeDraft(
  snapshot: DesktopSnapshot['settings'],
  draft: UpdateRuntimeSettingsInput,
) {
  return (
    snapshot.nickname === draft.nickname &&
    snapshot.meshId === draft.meshId &&
    snapshot.listenPort === draft.listenPort &&
    snapshot.initialRoom === draft.initialRoom &&
    snapshot.startupPeer === draft.startupPeer &&
    snapshot.trackerMode === draft.trackerMode &&
    snapshot.lanDiscoveryEnabled === draft.lanDiscoveryEnabled
  )
}

export function toRuntimeDraft(settings: DesktopSnapshot['settings']): UpdateRuntimeSettingsInput {
  return {
    nickname: settings.nickname,
    meshId: settings.meshId,
    listenPort: settings.listenPort,
    initialRoom: settings.initialRoom,
    startupPeer: settings.startupPeer,
    trackerMode: settings.trackerMode === 'disabled' ? 'disabled' : 'default',
    lanDiscoveryEnabled: settings.lanDiscoveryEnabled,
  }
}

export function findRoomById(rooms: RoomSummary[], roomId: string): RoomSummary | undefined {
  return rooms.find((room) => room.id === roomId)
}

export function selectRoomFallback(
  rooms: RoomSummary[],
  selectedDock: DockMode,
  groups: RoomGroup[],
  selectedGroupId: string,
  selectedRoomId: string,
  initialRoomId: string,
) {
  const activeGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0]
  const homeRooms = rooms.filter((room) => room.kind === 'dm')
  const groupRooms =
    selectedDock === 'group'
      ? rooms.filter((room) => room.kind === 'system' || activeGroup?.roomIds.includes(room.id))
      : homeRooms
  const preferredPool = groupRooms.length > 0 ? groupRooms : rooms

  return (
    preferredPool.find((room) => room.id === selectedRoomId) ??
    rooms.find((room) => room.id === initialRoomId) ??
    preferredPool[0] ??
    rooms[0]
  )
}

export function getVisiblePeers(activeRoom: RoomSummary | undefined, peers: PeerSummary[]) {
  if (!activeRoom || activeRoom.kind === 'system') {
    return peers
  }

  return peers.filter((peer) => {
    const labels = new Set(peer.rooms.map((room) => room.toLowerCase()))
    return labels.has(activeRoom.label.toLowerCase()) || labels.has(`#${activeRoom.id}`)
  })
}
