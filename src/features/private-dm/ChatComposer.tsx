import { IconLoader2, IconSend } from "@tabler/icons-react";
import {
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
  useState,
} from "react";
import { AttachmentPicker } from "./attachments";
import { chatText } from "./private-dm.content";
import { VoiceComposer, type VoiceSend } from "./voice/VoiceComposer";

export function ChatDropZone({
  disabled,
  onAttach,
  children,
}: {
  disabled: boolean;
  onAttach: (file: File) => void;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`chat-scroll scroll${dragging ? " chat-scroll-dragging" : ""}`}
      onDragOver={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (disabled) {
          return;
        }
        const file = event.dataTransfer.files?.[0];
        if (file) {
          onAttach(file);
        }
      }}
    >
      {children}
      {dragging ? <div className="chat-drop-overlay">{chatText.dropHint}</div> : null}
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSend,
  onAttach,
  onSendVoice,
  onVoiceError,
  disabled,
  sending = false,
}: {
  value: string;
  disabled: boolean;
  sending?: boolean;
  onChange: (value: string) => void;
  onSend: (event: FormEvent) => void;
  onAttach?: (file: File) => void;
  onSendVoice?: (voice: VoiceSend) => void;
  onVoiceError?: (message: string) => void;
}) {
  const sendLabel = sending ? "Sending" : chatText.sendLabel;
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (disabled || !onAttach) {
      return;
    }
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file")
      ?.getAsFile();
    if (file) {
      event.preventDefault();
      onAttach(file);
    }
  };
  return (
    <form className="composer" onSubmit={onSend}>
      <div className="composer-box">
        {onAttach ? (
          <AttachmentPicker
            disabled={disabled}
            onPick={onAttach}
            ariaLabel={chatText.attachLabel}
          />
        ) : null}
        {onSendVoice ? (
          <VoiceComposer
            disabled={disabled}
            onSend={onSendVoice}
            onError={onVoiceError ?? (() => {})}
          />
        ) : null}
        <input
          aria-label="Message"
          placeholder={chatText.composerPlaceholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={handlePaste}
          disabled={disabled}
        />
        <button
          className={`send-button${sending ? " send-button-busy" : ""}`}
          type="submit"
          aria-label={sendLabel}
          title={sendLabel}
          disabled={disabled || !value.trim()}
        >
          {sending ? <IconLoader2 size={14} /> : <IconSend size={14} />}
        </button>
      </div>
    </form>
  );
}
