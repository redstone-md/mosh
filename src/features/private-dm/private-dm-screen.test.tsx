import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PrivateDmScreen } from "./private-dm-screen";

describe("PrivateDmScreen", () => {
  it("renders the Mosh desktop DM shell from the design structure", () => {
    render(<PrivateDmScreen />);

    expect(screen.getByRole("main", { name: "MOSH" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Direct messages" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alice Park" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Peer status" })).toBeInTheDocument();
  });

  it("confirms a fingerprint through the visible invite flow", async () => {
    const user = userEvent.setup();

    render(<PrivateDmScreen />);
    await user.click(screen.getByRole("button", { name: "Confirm fingerprint" }));

    expect(screen.getByRole("button", { name: "Fingerprint confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Direct · fingerprint confirmed · MLS ready")).toBeInTheDocument();
  });

  it("does not overclaim tracker privacy", () => {
    render(<PrivateDmScreen />);

    expect(screen.getByText(/Public trackers help discovery but do not hide metadata/i)).toBeInTheDocument();
    expect(screen.getByText("OpenMLS E2EE over Moss transport")).toBeInTheDocument();
  });
});
