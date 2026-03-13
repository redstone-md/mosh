import { useEffect, useRef } from 'react'
import type { Message, RoomSummary } from '../lib/schemas'
import { Send, MessageSquareOff } from 'lucide-react'
import { cn } from '../lib/utils'

type MessagePanelProps = {
  room: RoomSummary | undefined
  messages: Message[]
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  isSending: boolean
  errorNote?: string
}

export function MessagePanel({
  room,
  messages,
  draft,
  onDraftChange,
  onSend,
  isSending,
  errorNote,
}: MessagePanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) {
      return
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages.length, room?.id])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <section className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="flex-1 overflow-y-auto scroll-smooth px-6" ref={scrollRef}>
        <div className="max-w-4xl mx-auto py-8 space-y-8">
          {messages.length > 0 ? (
            messages.map((message) => (
              <article className="flex gap-4 group" key={message.id}>
                <div className={cn(
                  "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm",
                  message.emphasis === 'system' ? "bg-primary/20 text-primary border border-primary/20" : "bg-secondary text-foreground/80 border border-border/20"
                )} aria-hidden="true">
                  {avatarLabel(message.author)}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-sm tracking-tight text-foreground/90">
                      {message.author}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest font-bold text-foreground/30">
                      {message.timestamp}
                    </span>
                  </div>
                  <div className={cn(
                    "text-[15px] leading-relaxed text-foreground/80 whitespace-pre-wrap",
                    message.emphasis === 'system' && "font-mono text-sm text-primary/80 bg-primary/5 p-4 rounded-xl border border-primary/10"
                  )}>
                    {message.body}
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-24 opacity-40">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <MessageSquareOff size={32} />
              </div>
              <div className="space-y-1">
                <p className="font-bold text-lg">No messages yet</p>
                <p className="text-sm max-w-xs mx-auto">
                  {room?.kind === 'system'
                    ? 'System updates will appear here as soon as the runtime has something to report.'
                    : `Start the conversation in ${room?.label ?? '#room'} and new messages will stream in here.`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 pt-0">
        <div className="max-w-4xl mx-auto">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-accent/20 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition duration-1000 group-focus-within:duration-200"></div>
            <div className="relative bg-muted/80 backdrop-blur-xl border border-border/50 rounded-2xl p-2 flex items-end gap-2 shadow-2xl">
              <textarea
                className="flex-1 bg-transparent border-0 px-4 py-3 text-[15px] focus:ring-0 resize-none max-h-48 min-h-[52px] placeholder:text-foreground/30"
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${room?.label ?? '#room'}...`}
                rows={1}
              />
              <button
                className={cn(
                  "p-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50",
                  draft.trim() ? "bg-primary text-background hover:scale-105 active:scale-95" : "bg-foreground/5 text-foreground/20"
                )}
                onClick={onSend}
                disabled={isSending || !draft.trim()}
                type="button"
              >
                {isSending ? (
                  <div className="w-5 h-5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                ) : (
                  <Send size={20} />
                )}
              </button>
            </div>
          </div>
          {errorNote ? (
            <p className="mt-2 text-xs text-red-400 font-medium px-4">{errorNote}</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function avatarLabel(author: string): string {
  const trimmed = author.trim()
  if (!trimmed) {
    return 'MC'
  }
  return trimmed
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() ?? '')
    .join('')
}
