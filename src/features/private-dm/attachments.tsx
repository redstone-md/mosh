import {
  IconDownload,
  IconFile,
  IconFileAlert,
  IconExternalLink,
  IconPaperclip,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useRef } from "react";
import type {
  AttachmentDescriptor,
  AttachmentView,
} from "./native/native-messaging-gateway";

const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

/** Reads a File into the base64 string the Tauri attachment commands expect. */
export async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  }
  return btoa(binary);
}

export function isAttachmentTooLarge(file: File): boolean {
  return file.size > ATTACHMENT_MAX_BYTES;
}

export function formatBytes(total: number): string {
  if (total < 1024) {
    return `${total} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = total / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Paperclip button plus a hidden file input wired to a single picked file. */
export function AttachmentPicker({
  disabled,
  onPick,
  ariaLabel,
}: {
  disabled: boolean;
  onPick: (file: File) => void;
  ariaLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="attachment-file-input"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onPick(file);
          }
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className="composer-attach"
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <IconPaperclip size={16} />
      </button>
    </>
  );
}

function progressPercent(view: AttachmentView | undefined): number {
  if (!view || view.chunk_count === 0) {
    return 0;
  }
  return Math.min(100, Math.round((view.completed_chunks / view.chunk_count) * 100));
}

/** Renders one attachment inside a message bubble with transfer controls. */
export function AttachmentCard({
  descriptor,
  view,
  busy,
  onDownload,
  onCancel,
}: {
  descriptor: AttachmentDescriptor;
  view: AttachmentView | undefined;
  busy: boolean;
  onDownload: (attachmentId: string) => void;
  onCancel: (attachmentId: string) => void;
}) {
  const id = descriptor.attachment_id;
  const outgoing = view?.direction === "outgoing";
  const state = view?.state ?? (outgoing ? "available" : "offered");
  const isImage = descriptor.mime.startsWith("image/");
  const percent = progressPercent(view);

  const open = () => {
    if (view?.local_path) {
      void openPath(view.local_path);
    }
  };

  return (
    <div className={`attachment-card attachment-card-${state}`}>
      <div className="attachment-thumb">
        {descriptor.thumbnail_b64 && isImage ? (
          <img
            src={`data:${descriptor.mime};base64,${descriptor.thumbnail_b64}`}
            alt={descriptor.file_name}
          />
        ) : state === "failed" ? (
          <IconFileAlert size={22} />
        ) : (
          <IconFile size={22} />
        )}
      </div>
      <div className="attachment-info">
        <strong className="attachment-name" title={descriptor.file_name}>
          {descriptor.file_name}
        </strong>
        <span className="attachment-meta">
          {formatBytes(descriptor.total_size)}
          {state === "downloading" ? ` · ${percent}%` : ""}
          {state === "failed" ? " · transfer failed" : ""}
        </span>
        {state === "downloading" ? (
          <div className="attachment-progress" aria-hidden="true">
            <div className="attachment-progress-fill" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
      <div className="attachment-actions">
        {state === "available" ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={`Open ${descriptor.file_name}`}
            title="Open"
            disabled={!view?.local_path}
            onClick={open}
          >
            <IconExternalLink size={15} />
          </button>
        ) : null}
        {!outgoing && (state === "offered" || state === "cancelled") ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={`Download ${descriptor.file_name}`}
            title="Download"
            disabled={busy}
            onClick={() => onDownload(id)}
          >
            <IconDownload size={15} />
          </button>
        ) : null}
        {!outgoing && state === "failed" ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={`Retry ${descriptor.file_name}`}
            title="Retry"
            disabled={busy}
            onClick={() => onDownload(id)}
          >
            <IconRefresh size={15} />
          </button>
        ) : null}
        {!outgoing && state === "downloading" ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={`Cancel ${descriptor.file_name}`}
            title="Cancel"
            onClick={() => onCancel(id)}
          >
            <IconX size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
