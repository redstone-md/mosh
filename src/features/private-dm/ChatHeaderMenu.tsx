import { IconDotsVertical } from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface ChatHeaderMenuAction {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly tone?: "danger";
}

export function ChatHeaderMenu({
  actions,
}: {
  actions: readonly ChatHeaderMenuAction[];
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [open]);

  return (
    <div className="chat-more chat-mobile-only" ref={menuRef}>
      <button
        className="btn btn-ghost btn-icon"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More chat actions"
        title="More chat actions"
        onClick={() => setOpen((current) => !current)}
      >
        <IconDotsVertical size={17} />
      </button>
      {open ? (
        <div className="chat-more-menu" role="menu">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={`chat-more-item${
                action.tone === "danger" ? " chat-more-item-danger" : ""
              }`}
              onClick={() => {
                if (action.disabled) {
                  return;
                }
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
