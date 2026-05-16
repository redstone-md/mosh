import {
  IconDownload,
  IconFile,
  IconFileAlert,
  IconExternalLink,
  IconPaperclip,
  IconPlayerPlayFilled,
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
const THUMBNAIL_MAX_EDGE = 320;

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

function canvasToBase64(canvas: HTMLCanvasElement): string | undefined {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : undefined;
}

function scaledSize(width: number, height: number): { w: number; h: number } {
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(width, height, 1));
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

async function imageThumbnail(file: File): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const { w, h } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }
    context.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvasToBase64(canvas);
  } catch {
    return undefined;
  }
}

function videoThumbnail(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    let settled = false;
    const finish = (result?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onerror = () => finish(undefined);
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(1, (video.duration || 2) * 0.1);
      } catch {
        finish(undefined);
      }
    };
    video.onseeked = () => {
      try {
        const { w, h } = scaledSize(video.videoWidth, video.videoHeight);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d");
        if (!context) {
          finish(undefined);
          return;
        }
        context.drawImage(video, 0, 0, w, h);
        finish(canvasToBase64(canvas));
      } catch {
        finish(undefined);
      }
    };
    video.src = url;
    window.setTimeout(() => finish(undefined), 6000);
  });
}

/**
 * Renders a JPEG preview frame for an image or video file and returns it as
 * base64 (no data: prefix). Resolves to undefined for other file types or on
 * any decode failure — a missing thumbnail is never fatal.
 */
export async function createThumbnail(file: File): Promise<string | undefined> {
  if (file.type.startsWith("image/")) {
    return imageThumbnail(file);
  }
  if (file.type.startsWith("video/")) {
    return videoThumbnail(file);
  }
  return undefined;
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
  const isVideo = descriptor.mime.startsWith("video/");
  const hasPreview = Boolean(descriptor.thumbnail_b64) && (isImage || isVideo);
  const percent = progressPercent(view);

  const open = () => {
    if (view?.local_path) {
      void openPath(view.local_path);
    }
  };

  const actions = (
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
  );

  const meta = (
    <span className="attachment-meta">
      {formatBytes(descriptor.total_size)}
      {state === "downloading" ? ` · ${percent}%` : ""}
      {state === "failed" ? " · transfer failed" : ""}
    </span>
  );

  const progressBar =
    state === "downloading" ? (
      <div className="attachment-progress" aria-hidden="true">
        <div className="attachment-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    ) : null;

  if (hasPreview) {
    return (
      <div className={`attachment-card attachment-card-media attachment-card-${state}`}>
        <div className="attachment-preview">
          <img
            src={`data:image/jpeg;base64,${descriptor.thumbnail_b64}`}
            alt={descriptor.file_name}
          />
          {isVideo ? (
            <span className="attachment-play" aria-hidden="true">
              <IconPlayerPlayFilled size={20} />
            </span>
          ) : null}
        </div>
        <div className="attachment-bar">
          <div className="attachment-info">
            <strong className="attachment-name" title={descriptor.file_name}>
              {descriptor.file_name}
            </strong>
            {meta}
            {progressBar}
          </div>
          {actions}
        </div>
      </div>
    );
  }

  return (
    <div className={`attachment-card attachment-card-${state}`}>
      <div className="attachment-thumb">
        {state === "failed" ? <IconFileAlert size={22} /> : <IconFile size={22} />}
      </div>
      <div className="attachment-info">
        <strong className="attachment-name" title={descriptor.file_name}>
          {descriptor.file_name}
        </strong>
        {meta}
        {progressBar}
      </div>
      {actions}
    </div>
  );
}
