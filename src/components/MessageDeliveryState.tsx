import { RotateCcw, X } from 'lucide-react'

import type { DisplayMessage } from '../lib/messageDelivery'
import type { useI18n } from './I18nProvider'

type MessageDeliveryStateProps = {
  message: DisplayMessage
  currentUser: string
  copy: ReturnType<typeof useI18n>['copy']
  onRetryMessage: (clientId: string) => void
  onDismissMessage: (clientId: string) => void
}

export function MessageDeliveryState({
  message,
  currentUser,
  copy,
  onRetryMessage,
  onDismissMessage,
}: MessageDeliveryStateProps) {
  if (message.author.trim().toLowerCase() !== currentUser.trim().toLowerCase() || !message.deliveryState) {
    return null
  }

  const label =
    message.deliveryState === 'sending'
      ? copy.messages.sending
      : message.deliveryState === 'archived'
        ? copy.messages.archived
        : message.deliveryState === 'failed'
          ? copy.messages.failed
          : copy.messages.delivered

  return (
    <div className="flex items-center gap-2 pt-1 text-[11px] text-[var(--muted-foreground)]">
      <span>{label}</span>
      {message.overlayState === 'edited' ? <span>{copy.messages.editedLocally}</span> : null}
      {message.overlayState === 'hidden' ? <span>{copy.messages.hiddenLocally}</span> : null}
      {message.deliveryState === 'failed' && message.pendingClientId ? (
        <>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-muted"
            onClick={() => onRetryMessage(message.pendingClientId!)}
          >
            <RotateCcw size={12} />
            {copy.messages.retrySend}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-muted"
            onClick={() => onDismissMessage(message.pendingClientId!)}
          >
            <X size={12} />
            {copy.messages.dismissFailed}
          </button>
        </>
      ) : null}
    </div>
  )
}
