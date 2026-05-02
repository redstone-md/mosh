import { Search, Compass, User, Hash, Settings, Users, LogOut } from 'lucide-react'
import type { RoomSummary } from '../lib/schemas'
import { cn } from '../lib/utils'

type SidebarProps = {
  channels: RoomSummary[]
  utilityRooms: RoomSummary[]
  selectedRoomId: string
  roomSearch: string
  onRoomSearchChange: (value: string) => void
  onOpenCreateChannel: () => void
  onSelectRoom: (roomId: string) => void
  onLeaveRoom: (roomId: string) => void
  onOpenProfile: () => void
}

export function Sidebar({
  channels,
  utilityRooms,
  selectedRoomId,
  roomSearch,
  onRoomSearchChange,
  onOpenCreateChannel,
  onSelectRoom,
  onLeaveRoom,
  onOpenProfile,
}: SidebarProps) {
  return (
    <aside className="h-full flex flex-col bg-muted/50 border-r border-border/20">
      <header className="p-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary/60 mb-1">Workspace</p>
          <h2 className="text-xl font-bold tracking-tight">MOSH</h2>
        </div>
        <button
          className="p-2 rounded-lg hover:bg-white/5 text-foreground/60 hover:text-primary transition-colors"
          type="button"
          onClick={onOpenProfile}
          title="Edit Profile"
        >
          <User size={20} />
        </button>
      </header>

      <div className="px-4 mb-6">
        <div className="relative group">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40 group-focus-within:text-primary transition-colors"
            size={16}
          />
          <input
            className="w-full bg-background/50 border border-border/50 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
            value={roomSearch}
            onChange={(event) => onRoomSearchChange(event.target.value)}
            placeholder="Search joined channels..."
          />
        </div>
      </div>

      <div className="px-6 flex items-center justify-between mb-4">
        <p className="text-xs font-bold uppercase tracking-widest text-foreground/40">Joined Channels</p>
        <button
          className="p-1 rounded-md hover:bg-primary/20 text-primary transition-colors"
          type="button"
          onClick={onOpenCreateChannel}
          title="Discover Channels"
        >
          <Compass size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 space-y-1 pb-6 custom-scrollbar">
        {channels.length > 0 ? (
          channels.map((room) => renderRoom(room, selectedRoomId, onSelectRoom, onLeaveRoom))
        ) : (
          <div className="px-4 py-8 text-center border border-dashed border-border/20 rounded-xl mx-3 mt-2">
            <p className="text-sm font-medium text-foreground/60 mb-2">No channels joined</p>
            <button
              onClick={onOpenCreateChannel}
              className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-bold hover:bg-primary/20 transition-colors"
            >
              Discover Channels
            </button>
          </div>
        )}

        {utilityRooms.length > 0 ? (
          <div className="pt-6 mt-4 border-t border-border/10">
            <p className="px-3 text-xs font-bold uppercase tracking-widest text-foreground/40 mb-3">System</p>
            <div className="space-y-1">
              {utilityRooms.map((room) => renderRoom(room, selectedRoomId, onSelectRoom))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function renderRoom(
  room: RoomSummary,
  selectedRoomId: string,
  onSelectRoom: (roomId: string) => void,
  onLeaveRoom?: (roomId: string) => void
) {
  const selected = room.id === selectedRoomId
  return (
    <div className="group relative flex items-center" key={room.id}>
      <button
        className={cn(
          'w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all',
          selected
            ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
            : 'hover:bg-white/5 text-foreground/60 hover:text-foreground'
        )}
        type="button"
        onClick={() => onSelectRoom(room.id)}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
              selected
                ? 'bg-primary/20 text-primary'
                : 'bg-muted text-foreground/40 group-hover:bg-muted/80 group-hover:text-foreground/60'
            )}
          >
            {room.kind === 'system' ? <Settings size={16} /> : <Hash size={16} />}
          </div>
          <div className="flex flex-col">
            <strong className="text-sm font-semibold truncate max-w-[120px]">{room.label}</strong>
            <span className="text-[10px] opacity-60 flex items-center gap-1">
              <Users size={10} />
              {room.participants}
            </span>
          </div>
        </div>

        {room.unread > 0 && (
          <span className="bg-accent text-background text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center">
            {room.unread}
          </span>
        )}
      </button>

      {onLeaveRoom && room.kind !== 'system' && (
        <button
          className="absolute right-2 opacity-0 group-hover:opacity-100 p-1.5 bg-background border border-border/50 text-foreground/70 hover:text-red-400 rounded-lg shadow-sm transition-all"
          title="Leave Channel"
          onClick={(e) => {
            e.stopPropagation()
            onLeaveRoom(room.id)
          }}
        >
          <LogOut size={14} />
        </button>
      )}
    </div>
  )
}
