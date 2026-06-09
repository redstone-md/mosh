import { IconFile, IconPlayerPlayFilled, IconX } from "@tabler/icons-react";
import type { AttachmentDescriptor } from "./native/native-messaging-gateway";
import { useModalFocus } from "./use-modal-focus";

/**
 * Full-screen in-app viewer for an image, video, or audio attachment. The
 * src is a complete-file asset URL or a moshmedia:// streaming URL; the
 * viewer itself does not care which.
 */
export function MediaViewer({
  descriptor,
  src,
  onClose,
}: {
  descriptor: AttachmentDescriptor;
  src: string;
  onClose: () => void;
}) {
  const modalRef = useModalFocus(onClose);
  const mime = descriptor.mime;
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");

  return (
    <div
      ref={modalRef}
      className="media-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={descriptor.file_name}
      tabIndex={-1}
      onClick={onClose}
    >
      <button
        type="button"
        className="media-viewer-close"
        aria-label="Close viewer"
        onClick={onClose}
      >
        <IconX size={18} />
      </button>
      <div className="media-viewer-stage" onClick={(event) => event.stopPropagation()}>
        {isImage ? (
          <img className="media-viewer-image" src={src} alt={descriptor.file_name} />
        ) : isVideo ? (
          <video className="media-viewer-video" src={src} controls autoPlay />
        ) : isAudio ? (
          <div className="media-viewer-audio">
            <IconPlayerPlayFilled size={32} />
            <strong>{descriptor.file_name}</strong>
            <audio src={src} controls autoPlay />
          </div>
        ) : (
          <div className="media-viewer-audio">
            <IconFile size={32} />
            <strong>{descriptor.file_name}</strong>
          </div>
        )}
      </div>
      <div className="media-viewer-caption">{descriptor.file_name}</div>
    </div>
  );
}
