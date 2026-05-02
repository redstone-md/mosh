import type { RoomSummary } from '../lib/schemas'

type RoomListProps = {
  rooms: RoomSummary[]
  selectedRoomId: string
  onSelect: (roomId: string) => void
}

export function RoomList({ rooms, selectedRoomId, onSelect }: RoomListProps) {
  return (
    <aside className="bg-muted/30 border border-border/20 rounded-3xl p-6 shadow-xl space-y-4">
      <header className="border-b border-border/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">Rooms</p>
          <h2 className="text-xl font-bold">Desktop shell</h2>
        </div>
      </header>
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
        {rooms.map((room) => {
          const selected = room.id === selectedRoomId
          return (
            <button
              className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${selected ? 'bg-primary/10 border border-primary/30' : 'bg-background/40 border border-border/20 hover:bg-background/60 hover:border-border/40'}`}
              key={room.id}
              onClick={() => onSelect(room.id)}
            >
              <div className="text-left flex flex-col gap-0.5">
                <strong className={`text-sm ${selected ? 'text-primary' : 'text-foreground'}`}>{room.label}</strong>
                <span className="text-[10px] text-foreground/50 uppercase tracking-wider">
                  {room.participants} participants
                </span>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-1 rounded-md ${room.unread > 0 ? 'bg-primary text-background' : 'bg-muted border border-border/50 text-foreground/60'}`}
              >
                {room.unread > 0 ? room.unread : room.kind}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
