import { useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { DisplayMessage } from '../lib/messageDelivery'
import type { MessageOverlay, ShellPreferences } from '../lib/appShellSchemas'
import { applyMessageOverlays, toggleHiddenMessageOverlay, upsertEditedMessageOverlay } from '../lib/messageOverlays'

type UseMessageOverlayStateOptions = {
  messageOverlays: Record<string, MessageOverlay>
  setPreferences: Dispatch<SetStateAction<ShellPreferences>>
  hiddenLabel: string
}

export function useMessageOverlayState({
  messageOverlays,
  setPreferences,
  hiddenLabel,
}: UseMessageOverlayStateOptions) {
  const applyOverlays = useCallback(
    (messages: DisplayMessage[]) => applyMessageOverlays(messages, messageOverlays, hiddenLabel),
    [hiddenLabel, messageOverlays]
  )

  return {
    messageOverlays,
    applyOverlays,
    editMessage: useCallback(
      (messageId: string, roomId: string, body: string) =>
        setPreferences((current) => ({
          ...current,
          messageOverlays: upsertEditedMessageOverlay(current.messageOverlays, messageId, roomId, body),
        })),
      [setPreferences]
    ),
    toggleMessageHidden: useCallback(
      (messageId: string, roomId: string) =>
        setPreferences((current) => ({
          ...current,
          messageOverlays: toggleHiddenMessageOverlay(current.messageOverlays, messageId, roomId),
        })),
      [setPreferences]
    ),
    hiddenMessageIds: useMemo(
      () =>
        Object.entries(messageOverlays)
          .filter(([, overlay]) => overlay.hidden)
          .map(([messageId]) => messageId),
      [messageOverlays]
    ),
  }
}
