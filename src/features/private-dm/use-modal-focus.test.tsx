import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useModalFocus } from "./use-modal-focus";

function TestDialog({ onEscape }: { onEscape: () => void }) {
  const ref = useModalFocus(onEscape);
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <button type="button">First</button>
      <button type="button">Last</button>
    </div>
  );
}

describe("useModalFocus", () => {
  it("focuses the dialog controls, traps tab, and restores previous focus", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(opener);
    opener.focus();

    const onEscape = vi.fn();
    const { unmount } = render(<TestDialog onEscape={onEscape} />);

    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
