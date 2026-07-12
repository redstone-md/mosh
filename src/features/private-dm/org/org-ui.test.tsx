import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { detectInvite } from "../invite/invite-detection";
import { ORG_PUBKEY, orgSnapshot } from "../private-dm-test-utils";
import { OrgSection } from "./OrgSection";
import { computeMissingRosterMembers, computeRevokedDmBadges } from "./use-orgs";

const ORG_BUNDLE = `mosh://org?mesh=orgmesh-1&name=acme#org=${"a".repeat(64)}`;

function noopHandlers() {
  return {
    onMember: vi.fn(),
    onAcceptDmOffer: vi.fn(),
    onDismissDmOffer: vi.fn(),
    onAcceptGroupOffer: vi.fn(),
    onDismissGroupOffer: vi.fn(),
    onCreateGroup: vi.fn(),
    onLeave: vi.fn(),
  };
}

describe("org bundle detection", () => {
  it("detects a valid bundle", () => {
    expect(detectInvite(ORG_BUNDLE).kind).toBe("org");
  });

  it("rejects bundles missing routing or a malformed key", () => {
    expect(detectInvite("mosh://org?name=acme#org=" + "a".repeat(64)).kind).toBe(
      "unknown",
    );
    expect(detectInvite("mosh://org?mesh=m&name=acme#org=zz").kind).toBe("unknown");
    expect(detectInvite("mosh://org?mesh=m&name=acme").kind).toBe("unknown");
  });
});

describe("OrgSection", () => {
  it("shows the confirmation code while waiting for the roster", () => {
    render(
      <OrgSection
        org={orgSnapshot({ in_roster: false, members: [] })}
        busy={false}
        {...noopHandlers()}
      />,
    );
    expect(screen.getByText("ffff-ffff-ffff")).toBeInTheDocument();
  });

  it("hides the code once rostered and lists members; clicking one starts a DM", async () => {
    const handlers = noopHandlers();
    const org = orgSnapshot();
    render(<OrgSection org={org} busy={false} {...handlers} />);
    expect(screen.queryByText("ffff-ffff-ffff")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Message bob" }));
    expect(handlers.onMember).toHaveBeenCalledWith(
      org,
      expect.objectContaining({ name: "bob" }),
    );
    // Own row never starts a DM.
    expect(screen.getByRole("button", { name: "you (you)" })).toBeDisabled();
  });

  it("surfaces org DM offers with accept and dismiss", async () => {
    const handlers = noopHandlers();
    const org = orgSnapshot({
      dm_offers: [
        {
          offer_id: "offer-1",
          from_peer_id: "b".repeat(64),
          from_name: "bob",
          invite_uri: "mosh://invite?mesh=m&session=s#fp=AABBCCDD",
        },
      ],
    });
    render(<OrgSection org={org} busy={false} {...handlers} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Accept chat invite from bob" }),
    );
    expect(handlers.onAcceptDmOffer).toHaveBeenCalledWith(ORG_PUBKEY, "offer-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss invite from bob" }),
    );
    expect(handlers.onDismissDmOffer).toHaveBeenCalledWith(ORG_PUBKEY, "offer-1");
  });
});

describe("computeMissingRosterMembers", () => {
  it("lists roster members without a group leaf, never self", () => {
    const org = orgSnapshot();
    const bob = "b".repeat(64);
    expect(computeMissingRosterMembers(org, [])).toEqual([bob]);
    expect(computeMissingRosterMembers(org, [bob])).toEqual([]);
  });
});

describe("computeRevokedDmBadges", () => {
  it("badges linked sessions whose peer left the roster and only those", () => {
    const org = orgSnapshot({
      members: [
        {
          moss_peer_id: "b".repeat(64),
          name: "bob",
          role: "member",
          is_self: false,
        },
      ],
      dm_links: [
        { peer_id: "b".repeat(64), session_id: "dm-bob" },
        { peer_id: "c".repeat(64), session_id: "dm-carol" },
        { peer_id: "d".repeat(64), session_id: null },
      ],
    });
    const badges = computeRevokedDmBadges([org]);
    expect(badges.get("dm-carol")).toBe("acme");
    expect(badges.has("dm-bob")).toBe(false);
    expect(badges.size).toBe(1);
  });
});
