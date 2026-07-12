import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ChatTarget } from "../chat-actions";
import type {
  NativeMessagingGateway,
  OrgMemberView,
  OrgSnapshot,
} from "../native/native-messaging-gateway";
import type { PrivateDmRequestBase } from "../private-dm-setup.types";
import type { OperationKind } from "../use-operation-busy";

const ORG_POLL_MS = 4000;

type RunOrgOperation = (
  kind: OperationKind,
  action: () => Promise<void>,
  onError?: (message: string) => void,
) => Promise<void>;

export function useOrgs({
  gateway,
  requestBase,
  refresh,
  run,
  setActive,
  setShowSetup,
}: {
  gateway: NativeMessagingGateway;
  requestBase: PrivateDmRequestBase;
  refresh: (quiet?: boolean) => Promise<void>;
  run: RunOrgOperation;
  setActive: Dispatch<SetStateAction<ChatTarget | null>>;
  setShowSetup: Dispatch<SetStateAction<boolean>>;
}) {
  const [orgs, setOrgs] = useState<readonly OrgSnapshot[]>([]);

  const refreshOrgs = useCallback(async () => {
    try {
      const listed = await gateway.listOrgs();
      // Poll each org: the backend drains roster gossip and re-publishes the
      // join hello on this cadence.
      const polled = await Promise.all(
        listed.map((org) => gateway.pollOrg(org.org_pubkey).catch(() => org)),
      );
      setOrgs(polled);
    } catch {
      // Runtime unavailable (demo/startup): keep the previous snapshot.
    }
  }, [gateway]);

  useEffect(() => {
    void refreshOrgs();
    const intervalId = window.setInterval(() => void refreshOrgs(), ORG_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshOrgs]);

  const joinOrg = (bundleUri: string) =>
    run("setup", async () => {
      const trimmed = bundleUri.trim();
      if (!trimmed) {
        return;
      }
      await gateway.joinOrg({ ...requestBase, bundle_uri: trimmed });
      setShowSetup(false);
      await refreshOrgs();
    });

  const leaveOrg = (orgPubkey: string) =>
    run("setup", async () => {
      await gateway.leaveOrg(orgPubkey);
      await refreshOrgs();
      await refresh(true);
    });

  // Click on a roster member: open the linked DM if one exists, otherwise
  // send an org DM offer and land in the freshly created session.
  const openMemberDm = (org: OrgSnapshot, member: OrgMemberView) =>
    run("offer", async () => {
      if (member.is_self) {
        return;
      }
      const link = org.dm_links.find((l) => l.peer_id === member.moss_peer_id);
      if (link?.session_id) {
        setActive({ type: "dm", id: link.session_id });
        setShowSetup(false);
        return;
      }
      const invite = await gateway.orgSendDmOffer(
        org.org_pubkey,
        member.moss_peer_id,
        requestBase.display_name,
        requestBase.listen_port,
        requestBase.static_peer,
      );
      setActive({ type: "dm", id: invite.session_id });
      setShowSetup(false);
      await refresh(true);
      await refreshOrgs();
    });

  const acceptDmOffer = (orgPubkey: string, offerId: string) =>
    run("offer", async () => {
      const session = await gateway.orgAcceptDmOffer(
        orgPubkey,
        offerId,
        requestBase.display_name,
        requestBase.listen_port,
        requestBase.static_peer,
      );
      setActive({ type: "dm", id: session.session_id });
      setShowSetup(false);
      await refresh(true);
      await refreshOrgs();
    });

  const dismissDmOffer = (orgPubkey: string, offerId: string) =>
    run("offer", async () => {
      await gateway.orgDismissDmOffer(orgPubkey, offerId);
      await refreshOrgs();
    });

  const acceptGroupOffer = (orgPubkey: string, offerId: string) =>
    run("offer", async () => {
      const group = await gateway.orgAcceptGroupOffer(
        orgPubkey,
        offerId,
        requestBase.display_name,
        requestBase.listen_port,
        requestBase.static_peer,
      );
      setActive({ type: "group", id: group.group_id });
      setShowSetup(false);
      await refresh(true);
      await refreshOrgs();
    });

  const dismissGroupOffer = (orgPubkey: string, offerId: string) =>
    run("offer", async () => {
      await gateway.orgDismissGroupOffer(orgPubkey, offerId);
      await refreshOrgs();
    });

  // Create an org-bound group and offer it to every other roster member
  // (spec §5: a default #general is just the first ad-hoc group).
  const createOrgGroup = (org: OrgSnapshot, label: string) =>
    run("setup", async () => {
      const created = await gateway.orgCreateGroup({
        org_pubkey: org.org_pubkey,
        label: label.trim() || null,
        member_peer_ids: org.members
          .filter((member) => !member.is_self)
          .map((member) => member.moss_peer_id),
        display_name: requestBase.display_name,
        listen_port: requestBase.listen_port,
        static_peer: requestBase.static_peer,
      });
      setActive({ type: "group", id: created.group_id });
      setShowSetup(false);
      await refresh(true);
    });

  const inviteMembersToGroup = (
    orgPubkey: string,
    groupId: string,
    memberPeerIds: readonly string[],
  ) =>
    run("offer", async () => {
      await gateway.orgGroupInviteMembers(orgPubkey, groupId, memberPeerIds);
    });

  // DM sessions whose org link points at a peer no longer in that org's
  // roster: session_id -> org name, for the "no longer in <org>" badge.
  const revokedDmBadges = useMemo(() => computeRevokedDmBadges(orgs), [orgs]);

  return {
    orgs,
    refreshOrgs,
    joinOrg,
    leaveOrg,
    openMemberDm,
    acceptDmOffer,
    dismissDmOffer,
    acceptGroupOffer,
    dismissGroupOffer,
    createOrgGroup,
    inviteMembersToGroup,
    revokedDmBadges,
  };
}

export function computeRevokedDmBadges(
  orgs: readonly OrgSnapshot[],
): ReadonlyMap<string, string> {
  const badges = new Map<string, string>();
  for (const org of orgs) {
    for (const link of org.dm_links) {
      if (!link.session_id) {
        continue;
      }
      const stillMember = org.members.some(
        (member) => member.moss_peer_id === link.peer_id,
      );
      if (!stillMember) {
        badges.set(link.session_id, org.org_name);
      }
    }
  }
  return badges;
}

// Roster members (other than self) that hold no leaf in the group — the
// admin's "+N not in group" one-click add (spec §5).
export function computeMissingRosterMembers(
  org: OrgSnapshot,
  groupMemberPeerIds: readonly string[],
): string[] {
  return org.members
    .filter((member) => !member.is_self)
    .filter((member) => !groupMemberPeerIds.includes(member.moss_peer_id))
    .map((member) => member.moss_peer_id);
}
