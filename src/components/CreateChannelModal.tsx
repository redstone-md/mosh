import { X, Hash, Users, Plus } from 'lucide-react'
import type { RoomSummary } from '../lib/schemas'
import { useState } from 'react'

type CreateChannelModalProps = {
  roomDraft: string
  isCreating: boolean
  errorNote?: string
  onRoomDraftChange: (value: string) => void
  onCreate: (roomToJoin?: string) => void
  onClose: () => void
  availableRooms: RoomSummary[]
}

export function CreateChannelModal({
  roomDraft,
  isCreating,
  errorNote,
  onRoomDraftChange,
  onCreate,
  onClose,
  availableRooms,
}: CreateChannelModalProps) {
  const [mode, setMode] = useState<'discover' | 'create'>(availableRooms.length > 0 ? 'discover' : 'create')

  const filteredRooms = availableRooms.filter(r => r.label.toLowerCase().includes(roomDraft.toLowerCase()))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isCreating) {
          onClose()
        }
      }}
    >
      <div
        className="bg-muted/90 border border-border/30 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-channel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-6 border-b border-border/20 flex justify-between items-start shrink-0">
          <div>
            <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">
                {mode === 'discover' ? 'Discover Channels' : 'Create Channel'}
            </p>
            <h2 id="create-channel-title" className="text-xl font-bold">
                {mode === 'discover' ? 'Join a conversation' : 'Open a new room'}
            </h2>
          </div>
          <button
            type="button"
            className="p-2 text-foreground/50 hover:text-foreground hover:bg-white/5 rounded-lg transition-colors"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
            <div className="flex bg-background/50 p-1 rounded-xl border border-border/30">
                <button
                    className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${mode === 'discover' ? 'bg-primary text-background shadow' : 'text-foreground/60 hover:text-foreground'}`}
                    onClick={() => setMode('discover')}
                >
                    Discover
                </button>
                <button
                    className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${mode === 'create' ? 'bg-primary text-background shadow' : 'text-foreground/60 hover:text-foreground'}`}
                    onClick={() => setMode('create')}
                >
                    Create New
                </button>
            </div>

            {mode === 'create' ? (
                <form 
                    className="space-y-6"
                    onSubmit={(event) => {
                        event.preventDefault()
                        onCreate()
                    }}
                >
                    <p className="text-sm text-foreground/70">
                    Use a concise room name. The channel will be created immediately and the
                    conversation will open as soon as you join it.
                    </p>

                    <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground/80">Channel name</label>
                    <input
                        autoFocus
                        className="w-full bg-background border border-border/50 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground transition-all"
                        value={roomDraft}
                        onChange={(event) => onRoomDraftChange(event.target.value)}
                        placeholder="design-reviews"
                    />
                    </div>

                    {errorNote ? (
                    <p className="bg-red-500/10 text-red-400 text-sm p-3 rounded-lg border border-red-500/20">
                        {errorNote}
                    </p>
                    ) : null}

                    <div className="flex gap-3 pt-2">
                    <button
                        className="flex-1 bg-primary text-background font-bold py-2.5 px-4 rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50"
                        type="submit"
                        disabled={isCreating || !roomDraft.trim()}
                    >
                        {isCreating ? 'Creating...' : 'Create channel'}
                    </button>
                    </div>
                </form>
            ) : (
                <div className="space-y-4">
                    <input
                        autoFocus
                        className="w-full bg-background border border-border/50 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground transition-all"
                        value={roomDraft}
                        onChange={(event) => onRoomDraftChange(event.target.value)}
                        placeholder="Search channels..."
                    />

                    {errorNote ? (
                    <p className="bg-red-500/10 text-red-400 text-sm p-3 rounded-lg border border-red-500/20">
                        {errorNote}
                    </p>
                    ) : null}

                    <div className="space-y-2">
                        {filteredRooms.length > 0 ? (
                            filteredRooms.map(room => (
                                <div key={room.id} className="flex items-center justify-between p-3 bg-background/40 border border-border/30 rounded-xl hover:bg-background/80 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-foreground/50">
                                            <Hash size={18} />
                                        </div>
                                        <div>
                                            <strong className="block text-sm">{room.label}</strong>
                                            <span className="text-xs text-foreground/50 flex items-center gap-1 mt-0.5">
                                                <Users size={12} />
                                                {room.participants} peers
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        className="px-4 py-1.5 bg-secondary text-foreground text-xs font-bold rounded-lg hover:bg-secondary/80 border border-border/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
                                        onClick={() => onCreate(room.id)}
                                        disabled={isCreating}
                                    >
                                        <Plus size={14} />
                                        Join
                                    </button>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-8">
                                <p className="text-foreground/50 text-sm mb-4">No channels found matching "{roomDraft}"</p>
                                <button
                                    className="px-4 py-2 bg-primary/10 text-primary text-sm font-bold rounded-xl hover:bg-primary/20 transition-all"
                                    onClick={() => setMode('create')}
                                >
                                    Create #{roomDraft}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  )
}
