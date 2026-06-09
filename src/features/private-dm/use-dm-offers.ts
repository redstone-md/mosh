import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { type ChatTarget } from "./chat-actions";
import type {
  ChannelSnapshot,
  GroupSnapshot,
  NativeMessagingGateway,
} from "./native/native-messaging-gateway";
import type { PendingDmOffer } from "./SessionRail";
import type { PrivateDmRequestBase } from "./use-private-dm-setup";

type RunOfferOperation = (
  kind: "offer",
  action: () => Promise<void>,
) => Promise<void>;

export function useDmOffers({
  active,
  channels,
  gateway,
  groups,
  refresh,
  requestBase,
  run,
  setActive,
  setShowSetup,
}: {
  active: ChatTarget | null;
  channels: readonly ChannelSnapshot[];
  gateway: NativeMessagingGateway;
  groups: readonly GroupSnapshot[];
  refresh: (quiet?: boolean) => Promise<void>;
  requestBase: PrivateDmRequestBase;
  run: RunOfferOperation;
  setActive: Dispatch<SetStateAction<ChatTarget | null>>;
  setShowSetup: Dispatch<SetStateAction<boolean>>;
}) {
  const [offeredFingerprints, setOfferedFingerprints] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const offerDm = (targetFingerprint: string) => {
    if (!active || active.type === "dm" || offeredFingerprints.has(targetFingerprint)) {
      return;
    }
    const target = active;
    void run("offer", async () => {
      const invite = await gateway.createPrivateInvite(requestBase);
      if (target.type === "channel") {
        await gateway.sendChannelDmOffer(target.name, targetFingerprint, invite.invite_uri);
      } else {
        await gateway.sendGroupDmOffer(target.id, targetFingerprint, invite.invite_uri);
      }
      setOfferedFingerprints((prev) => new Set(prev).add(targetFingerprint));
      setActive({ type: "dm", id: invite.session_id });
      setShowSetup(false);
      await refresh(true);
    });
  };

  const acceptDmOffer = (offer: PendingDmOffer) => {
    void run("offer", async () => {
      const snapshot = await gateway.acceptPrivateInvite({
        ...requestBase,
        invite_uri: offer.invite_uri,
      });
      if (offer.kind === "channel") {
        await gateway.dismissChannelDmOffer(offer.host, offer.offer_id);
      } else {
        await gateway.dismissGroupDmOffer(offer.host, offer.offer_id);
      }
      setActive({ type: "dm", id: snapshot.session_id });
      setShowSetup(false);
      await refresh(true);
    });
  };

  const dismissDmOffer = (offer: PendingDmOffer) => {
    void run("offer", async () => {
      if (offer.kind === "channel") {
        await gateway.dismissChannelDmOffer(offer.host, offer.offer_id);
      } else {
        await gateway.dismissGroupDmOffer(offer.host, offer.offer_id);
      }
      await refresh(true);
    });
  };

  const pendingOffers = useMemo<PendingDmOffer[]>(
    () => [
      ...channels.flatMap((channel) =>
        channel.dm_offers.map((offer) => ({
          ...offer,
          kind: "channel" as const,
          host: channel.name,
        })),
      ),
      ...groups.flatMap((group) =>
        group.dm_offers.map((offer) => ({
          ...offer,
          kind: "group" as const,
          host: group.group_id,
        })),
      ),
    ],
    [channels, groups],
  );

  return {
    acceptDmOffer,
    dismissDmOffer,
    offerDm,
    offeredFingerprints,
    pendingOffers,
  };
}
