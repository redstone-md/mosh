import { X } from 'lucide-react'

type CreateChannelModalProps = {
  roomDraft: string
  isCreating: boolean
  errorNote?: string
  onRoomDraftChange: (value: string) => void
  onCreate: () => void
  onClose: () => void
}

export function CreateChannelModal({
  roomDraft,
  isCreating,
  errorNote,
  onRoomDraftChange,
  onCreate,
  onClose,
}: CreateChannelModalProps) {
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
      <form
        className="bg-muted/90 border border-border/30 rounded-2xl p-6 shadow-2xl w-full max-w-md space-y-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-channel-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          onCreate()
        }}
      >
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs uppercase tracking-widest text-primary font-bold mb-1">Create channel</p>
            <h2 id="create-channel-title" className="text-xl font-bold">Open a new room</h2>
          </div>
          <button
            type="button"
            className="p-2 text-foreground/50 hover:text-foreground hover:bg-white/5 rounded-lg transition-colors"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        
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
            disabled={isCreating}
          >
            {isCreating ? 'Creating...' : 'Create channel'}
          </button>
          <button
            className="flex-1 bg-secondary text-foreground font-bold py-2.5 px-4 rounded-xl hover:bg-secondary/80 border border-border/20 transition-all disabled:opacity-50"
            type="button"
            onClick={onClose}
            disabled={isCreating}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
