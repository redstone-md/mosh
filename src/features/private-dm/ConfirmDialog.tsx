import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import { useModalFocus } from "./use-modal-focus";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const modalRef = useModalFocus(onCancel);

  return (
    <div className="confirm-dialog-backdrop" role="presentation">
      <div
        ref={modalRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        tabIndex={-1}
      >
        <button
          type="button"
          className="confirm-dialog-close"
          aria-label={cancelLabel}
          onClick={onCancel}
        >
          <IconX size={16} />
        </button>
        <div className="confirm-dialog-icon" aria-hidden="true">
          <IconAlertTriangle size={18} />
        </div>
        <div className="confirm-dialog-copy">
          <h2 id="confirm-dialog-title">{title}</h2>
          <p id="confirm-dialog-body">{body}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
