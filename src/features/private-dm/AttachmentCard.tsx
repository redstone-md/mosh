import {
  IconDownload,
  IconExternalLink,
  IconFile,
  IconFileAlert,
  IconPlayerPlayFilled,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { formatBytes } from "./attachment-utils";
import type {
  AttachmentDescriptor,
  AttachmentView,
} from "./native/native-messaging-gateway";
import { VoiceMessage } from "./voice/VoiceMessage";

type TransferState = AttachmentView["state"] | "available" | "offered";

function progressPercent(view: AttachmentView | undefined): number {
  if (!view || view.chunk_count === 0) {
    return 0;
  }
  return Math.min(100, Math.round((view.completed_chunks / view.chunk_count) * 100));
}

function transferStateLabel(state: TransferState, percent: number): string {
  switch (state) {
    case "available":
      return "Available";
    case "downloading":
      return `Downloading ${percent}%`;
    case "failed":
      return "Transfer failed";
    case "cancelled":
      return "Transfer cancelled";
    case "offered":
    default:
      return "Ready to download";
  }
}

/** Renders one attachment inside a message bubble with transfer controls. */
export function AttachmentCard({
  descriptor,
  view,
  busy,
  onDownload,
  onCancel,
  onOpen,
}: {
  descriptor: AttachmentDescriptor;
  view: AttachmentView | undefined;
  busy: boolean;
  onDownload: (attachmentId: string) => void;
  onCancel: (attachmentId: string) => void;
  onOpen: (descriptor: AttachmentDescriptor) => void;
}) {
  if (descriptor.voice) {
    return (
      <VoiceMessage
        descriptor={descriptor}
        view={view}
        busy={busy}
        onDownload={onDownload}
      />
    );
  }

  const id = descriptor.attachment_id;
  const outgoing = view?.direction === "outgoing";
  const state = view?.state ?? (outgoing ? "available" : "offered");
  const isImage = descriptor.mime.startsWith("image/");
  const isVideo = descriptor.mime.startsWith("video/");
  const isAudio = descriptor.mime.startsWith("audio/");
  const viewable = isImage || isVideo || isAudio;
  const hasPreview = Boolean(descriptor.thumbnail_b64) && (isImage || isVideo);
  const percent = progressPercent(view);
  const stateLabel = transferStateLabel(state, percent);

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
          aria-label={`${state === "cancelled" ? "Retry download" : "Download"} ${
            descriptor.file_name
          }`}
          title={state === "cancelled" ? "Retry download" : "Download"}
          disabled={busy}
          aria-busy={busy || undefined}
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
          aria-busy={busy || undefined}
          onClick={() => onDownload(id)}
        >
          <IconRefresh size={15} />
        </button>
      ) : null}
      {!outgoing && state === "downloading" ? (
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={`Cancel download for ${descriptor.file_name}`}
          title="Cancel download"
          onClick={() => onCancel(id)}
        >
          <IconX size={15} />
        </button>
      ) : null}
    </div>
  );

  const meta = (
    <span
      className="attachment-meta"
      role="status"
      aria-label={`${stateLabel} for ${descriptor.file_name}`}
    >
      {formatBytes(descriptor.total_size)}
      {state !== "available" ? ` · ${stateLabel}` : ""}
    </span>
  );

  const progressBar =
    state === "downloading" ? (
      <div
        className="attachment-progress"
        role="progressbar"
        aria-label={`Download progress for ${descriptor.file_name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="attachment-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    ) : null;

  if (hasPreview) {
    return (
      <div className={`attachment-card attachment-card-media attachment-card-${state}`}>
        <button
          type="button"
          className="attachment-preview"
          aria-label={`Open ${descriptor.file_name}`}
          onClick={() => onOpen(descriptor)}
        >
          <img
            src={`data:image/jpeg;base64,${descriptor.thumbnail_b64}`}
            alt={descriptor.file_name}
          />
          {isVideo ? (
            <span className="attachment-play" aria-hidden="true">
              <IconPlayerPlayFilled size={20} />
            </span>
          ) : null}
        </button>
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
      {viewable ? (
        <button
          type="button"
          className="attachment-thumb attachment-thumb-button"
          aria-label={`Open ${descriptor.file_name}`}
          onClick={() => onOpen(descriptor)}
        >
          <IconPlayerPlayFilled size={20} />
        </button>
      ) : (
        <div className="attachment-thumb" aria-hidden="true">
          {state === "failed" ? <IconFileAlert size={22} /> : <IconFile size={22} />}
        </div>
      )}
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
