import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { RoomSummary } from '../lib/schemas'
import { Send, MessageSquareOff, Paperclip, Smile, Copy, Reply, Pin, Pencil, Trash2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { formatRoomTitle } from '../lib/chatPresentation'
import {
  createFileAttachmentMarkup,
  downloadAttachmentDataUrl,
  getEmbeddedAttachmentLimit,
  isImageAttachment,
} from '../lib/messageAttachments'
import { focusMessageElement } from '../lib/messageFocus'
import { escapeHtml, escapeHtmlAttribute } from '../lib/htmlEscape'
import type { DisplayMessage } from '../lib/messageDelivery'
import { serializeEditedMessageBody } from '../lib/messageOverlays'
import { extractPlainText } from '../lib/messageSearch'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Mention from '@tiptap/extension-mention'
import DOMPurify from 'dompurify'
import EmojiPicker, { Theme, type EmojiClickData } from 'emoji-picker-react'
import makeSuggestion from '../lib/suggestion'
import { useI18n } from './I18nProvider'
import { MessageDeliveryState } from './MessageDeliveryState'
import { MessageEditDialog } from './MessageEditDialog'

type MessagePanelProps = {
  room: RoomSummary | undefined
  messages: DisplayMessage[]
  currentUser: string
  matchedMessageIds?: string[]
  activeSearchMessageId?: string
  activeSearchPreview?: string
  externalFocusMessageId?: string
  draft: string
  peerNames: string[]
  pinnedMessageIds: string[]
  onDraftChange: (value: string) => void
  onSend: () => void
  onTogglePinMessage: (messageId: string) => void
  onRetryMessage: (clientId: string) => void
  onDismissMessage: (clientId: string) => void
  onEditMessage: (messageId: string, roomId: string, body: string) => void
  onToggleMessageHidden: (messageId: string, roomId: string) => void
  onResolveExternalFocus?: () => void
  isSending: boolean
  errorNote?: string
}

export function MessagePanel({
  room,
  messages,
  currentUser,
  matchedMessageIds = [],
  activeSearchMessageId,
  activeSearchPreview,
  externalFocusMessageId,
  draft,
  peerNames,
  pinnedMessageIds,
  onDraftChange,
  onSend,
  onTogglePinMessage,
  onRetryMessage,
  onDismissMessage,
  onEditMessage,
  onToggleMessageHidden,
  onResolveExternalFocus,
  isSending,
  errorNote,
}: MessagePanelProps) {
  const { copy } = useI18n()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [editingMessage, setEditingMessage] = useState<DisplayMessage | null>(null)
  const pinnedMessageSet = useMemo(() => new Set(pinnedMessageIds), [pinnedMessageIds])

  const handleSendRef = useRef(onSend)
  handleSendRef.current = onSend
  const isSendingRef = useRef(isSending)
  isSendingRef.current = isSending
  const draftRef = useRef(draft)
  draftRef.current = draft

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
          inline: true,
          HTMLAttributes: {
              class: 'inline-block align-middle max-h-64 rounded-lg',
          },
      }),
      Mention.configure({
        HTMLAttributes: {
          class: 'text-primary bg-primary/10 px-1 py-0.5 rounded-md font-bold cursor-pointer',
        },
        suggestion: makeSuggestion(peerNames),
      }),
      Placeholder.configure({
        placeholder: copy.messages.placeholder(formatRoomTitle(room, copy.common.unknownRoom)),
      }),
    ],
    content: draft,
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert prose-p:my-1 prose-pre:my-1 prose-blockquote:border-primary/50 prose-blockquote:bg-primary/5 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:text-foreground/80 max-w-none focus:outline-none max-h-48 overflow-y-auto px-4 py-3 min-h-[52px]',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            const currentDraft = draftRef.current;
            if (!isSendingRef.current && currentDraft.trim() !== '' && currentDraft !== '<p></p>') {
                handleSendRef.current();
            }
            return true; // Stop ProseMirror from inserting a newline
        }
        return false;
      }
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      onDraftChange(html === '<p></p>' ? '' : html)
    },
  }, []) // We MUST pass an empty dependency array or ONLY things that should recreate the editor. peerNames can cause resets if changed dynamically.

  // Sync draft to editor when cleared from outside (e.g. after send)
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      const currentHtml = editor.getHTML()
      if (draft === '' && currentHtml !== '<p></p>' && currentHtml !== '') {
         editor.commands.clearContent()
      }
    }
  }, [draft, editor])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages.length, room?.id])

  useEffect(() => {
    if (!activeSearchMessageId) {
      return
    }

    focusMessageElement(activeSearchMessageId)
  }, [activeSearchMessageId])

  useEffect(() => {
    if (!externalFocusMessageId) {
      return
    }

    if (focusMessageElement(externalFocusMessageId, true)) {
      onResolveExternalFocus?.()
    }
  }, [externalFocusMessageId, onResolveExternalFocus])

  // Removed redundant DOM event listener since we handle it in editorProps now


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > getEmbeddedAttachmentLimit()) {
      alert(copy.messages.attachmentTooLarge)
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result as string
      if (isImageAttachment(file)) {
        editor?.chain().focus().setImage({ src: base64, alt: file.name, title: file.name }).run()
      } else {
        editor?.chain().focus().insertContent(createFileAttachmentMarkup(file, base64)).run()
      }
    }
    reader.readAsDataURL(file)
    if (fileInputRef.current) {
        fileInputRef.current.value = ''
    }
  }

  const onEmojiClick = (emojiData: EmojiClickData) => {
    if (emojiData.imageUrl) {
        editor?.chain().focus().insertContent(`<img src="${emojiData.imageUrl}" alt="${emojiData.emoji}" class="w-5 h-5 inline-block align-middle m-0" />`).run()
    } else {
        editor?.chain().focus().insertContent(emojiData.emoji).run()
    }
    setShowEmojiPicker(false)
  }

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(extractPlainText(text))
  }, [])

  const handleReply = useCallback((message: DisplayMessage) => {
    const text = extractPlainText(message.body)
    const replyHtml = `<blockquote data-reply-to="${escapeHtmlAttribute(message.id)}" class="cursor-pointer hover:bg-primary/10 transition-colors" title="${escapeHtmlAttribute(copy.messages.jumpToOriginal)}"><strong>${escapeHtml(message.author)}:</strong> ${escapeHtml(text)}</blockquote><p></p>`
    editor?.chain().focus().insertContent(replyHtml).run()
  }, [copy.messages.jumpToOriginal, editor])

  const handleMessageClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!(e.target instanceof Element)) {
      return
    }

    const target = e.target
    const attachment = target.closest<HTMLAnchorElement>('a[data-attachment="file"]')
    if (attachment) {
      e.preventDefault()
      const dataUrl = attachment.getAttribute('data-file-url')
      if (dataUrl) {
        void downloadAttachmentDataUrl(dataUrl, attachment.getAttribute('data-file-name') || 'attachment')
      }
      return
    }

    const blockquote = target.closest('blockquote[data-reply-to]')
    if (blockquote) {
      const replyToId = blockquote.getAttribute('data-reply-to')
      if (replyToId) {
        focusMessageElement(replyToId, true)
      }
    }
  }, [])

  return (
    <section className="flex-1 flex flex-col min-h-0 bg-background relative">
      {activeSearchMessageId && activeSearchPreview ? (
        <div className="border-b border-border bg-[var(--panel-strong)] px-6 py-2">
          <div className="mx-auto max-w-4xl text-xs text-[var(--muted-foreground)]">
            {activeSearchPreview}
          </div>
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto scroll-smooth px-6 custom-scrollbar" ref={scrollRef}>
        <div className="max-w-4xl mx-auto py-8 space-y-8" onClick={handleMessageClick}>
          {messages.length > 0 ? (
            messages.map((message) => (
                <article
                  className={cn(
                  'flex gap-4 group relative rounded-xl px-2 py-1 transition-colors',
                  pinnedMessageSet.has(message.id) && 'bg-primary/5 ring-1 ring-primary/15',
                  matchedMessageIds.includes(message.id) && 'bg-[var(--panel-strong)]/70',
                  activeSearchMessageId === message.id && 'ring-1 ring-[var(--ring)] bg-[var(--panel-strong)]',
                )}
                key={message.id}
                id={message.id}
              >
                <div className={cn(
                  "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-sm",
                  message.emphasis === 'system' ? "bg-primary/20 text-primary border border-primary/20" : "bg-secondary text-foreground/80 border border-border/20"
                )} aria-hidden="true">
                  {avatarLabel(message.author)}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-[15px] tracking-tight text-foreground/90">
                      {message.author}
                    </span>
                    {pinnedMessageSet.has(message.id) ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/85">
                        <Pin size={10} />
                        {copy.messages.pinned}
                      </span>
                    ) : null}
                    <span className="text-[10px] uppercase tracking-widest font-bold text-foreground/30">
                      {message.timestamp}
                    </span>
                  </div>

                  <div 
                    className={cn(
                        "text-[15px] leading-relaxed text-foreground/80 prose prose-sm dark:prose-invert max-w-none break-words",
                        "prose-a:text-foreground prose-a:no-underline hover:prose-a:text-foreground",
                        "prose-img:max-h-64 prose-img:rounded-lg prose-img:border prose-img:border-border/50",
                        "prose-blockquote:border-primary/50 prose-blockquote:bg-primary/5 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:rounded-r-lg prose-blockquote:not-italic",
                        message.emphasis === 'system' && "font-mono text-sm text-primary/80 bg-primary/5 p-4 rounded-xl border border-primary/10"
                    )}
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(message.body, {
                        ADD_ATTR: [
                          'target',
                          'class',
                          'data-reply-to',
                          'data-attachment',
                          'data-file-name',
                          'data-file-size',
                          'data-file-type',
                          'data-file-url',
                          'download',
                          'href',
                          'title',
                          'alt',
                        ],
                      }),
                    }}
                  />
                  <MessageDeliveryState
                    message={message}
                    currentUser={currentUser}
                    copy={copy}
                    onRetryMessage={onRetryMessage}
                    onDismissMessage={onDismissMessage}
                  />
                </div>

                {/* Hover Actions */}
                <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-background/90 backdrop-blur-sm border border-border/50 rounded-lg shadow-sm p-1 -mt-2 z-10">
                    {canManageMessage(message, currentUser) ? (
                      <>
                        {message.overlayState !== 'hidden' ? (
                          <button
                            onClick={() => setEditingMessage(message)}
                            className="p-1.5 text-foreground/50 hover:text-foreground hover:bg-muted rounded-md transition-colors"
                            title={copy.messages.edit}
                          >
                            <Pencil size={14} />
                          </button>
                        ) : null}
                        <button
                          onClick={() => onToggleMessageHidden(message.id, message.roomId)}
                          className="p-1.5 text-foreground/50 hover:text-foreground hover:bg-muted rounded-md transition-colors"
                          title={message.overlayState === 'hidden' ? copy.messages.restoreMessage : copy.messages.hideMessage}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : null}
                    <button 
                        onClick={() => onTogglePinMessage(message.id)}
                        className={cn(
                          'p-1.5 rounded-md transition-colors',
                          pinnedMessageSet.has(message.id)
                            ? 'text-primary hover:bg-primary/10'
                            : 'text-foreground/50 hover:text-foreground hover:bg-muted',
                        )}
                        title={pinnedMessageSet.has(message.id) ? copy.messages.unpin : copy.messages.pin}
                    >
                        <Pin size={14} />
                    </button>
                    <button 
                        onClick={() => handleReply(message)}
                        className="p-1.5 text-foreground/50 hover:text-foreground hover:bg-muted rounded-md transition-colors"
                        title={copy.messages.reply}
                    >
                        <Reply size={14} />
                    </button>
                    <button 
                        onClick={() => handleCopy(message.body)}
                        className="p-1.5 text-foreground/50 hover:text-foreground hover:bg-muted rounded-md transition-colors"
                        title={copy.messages.copy}
                    >
                        <Copy size={14} />
                    </button>
                </div>
              </article>
            ))
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-24 opacity-40">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <MessageSquareOff size={32} />
              </div>
              <div className="space-y-1">
                <p className="font-bold text-lg">{copy.messages.noMessages}</p>
                <p className="text-sm max-w-xs mx-auto">
                  {room?.kind === 'system'
                    ? copy.messages.noMessagesSystem
                    : copy.messages.noMessagesRoom(formatRoomTitle(room, copy.common.unknownRoom))}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 pt-0">
        <div className="max-w-4xl mx-auto relative">
          
          {showEmojiPicker && (
              <div className="absolute bottom-full right-0 mb-4 z-50 shadow-2xl rounded-xl overflow-hidden border border-border/50">
                  <EmojiPicker 
                    theme={Theme.DARK} 
                    onEmojiClick={onEmojiClick}
                    searchDisabled={false}
                    skinTonesDisabled={true}
                  />
              </div>
          )}

          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-accent/20 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition duration-1000 group-focus-within:duration-200"></div>
            <div className="relative bg-muted/80 backdrop-blur-xl border border-border/50 rounded-2xl flex items-end gap-2 shadow-2xl pr-2 min-h-[52px]">
              
              <div className="flex-1 min-w-0 flex items-center cursor-text" onClick={() => editor?.commands.focus()}>
                  <EditorContent editor={editor} className="w-full" />
              </div>

              <div className="flex items-center gap-1 py-2">
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="*/*"
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    className="p-2.5 text-foreground/40 hover:text-foreground hover:bg-foreground/5 rounded-xl transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    title={copy.messages.attachFile}
                  >
                      <Paperclip size={18} />
                  </button>
                  <button
                    type="button"
                    className="p-2.5 text-foreground/40 hover:text-foreground hover:bg-foreground/5 rounded-xl transition-colors"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    title={copy.messages.insertEmoji}
                  >
                      <Smile size={18} />
                  </button>
                  <button
                    className={cn(
                    "p-2.5 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 ml-1",
                    draft.trim() && draft !== '<p></p>' ? "bg-primary text-background hover:scale-105 active:scale-95" : "bg-foreground/5 text-foreground/20"
                    )}
                    onClick={onSend}
                    disabled={isSending || !draft.trim() || draft === '<p></p>'}
                    type="button"
                  >
                    {isSending ? (
                    <div className="w-5 h-5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                    ) : (
                    <Send size={18} />
                    )}
                  </button>
              </div>
            </div>
          </div>
          {errorNote ? (
            <p className="mt-2 text-xs text-red-400 font-medium px-4">{errorNote}</p>
          ) : null}
        </div>
      </div>
      <MessageEditDialog
        open={Boolean(editingMessage)}
        initialValue={editingMessage ? extractPlainText(editingMessage.body) : ''}
        onOpenChange={(open) => {
          if (!open) {
            setEditingMessage(null)
          }
        }}
        onSave={(value) => {
          if (!editingMessage) {
            return
          }
          onEditMessage(editingMessage.id, editingMessage.roomId, serializeEditedMessageBody(value))
          setEditingMessage(null)
        }}
      />
    </section>
  )
}

function canManageMessage(message: DisplayMessage, currentUser: string) {
  return message.author.trim().toLowerCase() === currentUser.trim().toLowerCase() && message.emphasis !== 'system'
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
