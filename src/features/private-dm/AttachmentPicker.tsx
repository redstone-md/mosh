import { IconPaperclip } from "@tabler/icons-react";
import { useRef } from "react";

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
        hidden
        disabled={disabled}
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
