import {
  IconBuilding,
  IconCrown,
  IconMessageCircle,
  IconPlus,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { Avatar } from "../Avatar";
import { shorten } from "../format";
import type {
  OrgMemberView,
  OrgSnapshot,
} from "../native/native-messaging-gateway";
import { orgText } from "../private-dm.content";

export function OrgSection({
  org,
  busy,
  onMember,
  onAcceptDmOffer,
  onDismissDmOffer,
  onAcceptGroupOffer,
  onDismissGroupOffer,
  onCreateGroup,
  onLeave,
}: {
  org: OrgSnapshot;
  busy: boolean;
  onMember: (org: OrgSnapshot, member: OrgMemberView) => void;
  onAcceptDmOffer: (orgPubkey: string, offerId: string) => void;
  onDismissDmOffer: (orgPubkey: string, offerId: string) => void;
  onAcceptGroupOffer: (orgPubkey: string, offerId: string) => void;
  onDismissGroupOffer: (orgPubkey: string, offerId: string) => void;
  onCreateGroup: (org: OrgSnapshot, label: string) => void;
  onLeave: (org: OrgSnapshot) => void;
}) {
  const [groupLabel, setGroupLabel] = useState("");
  const selfIsAdmin = org.members.some(
    (member) => member.is_self && member.role === "admin",
  );
  return (
    <section className="rail-org" aria-label={`Organization ${org.org_name}`}>
      <div className="rail-org-header">
        <IconBuilding size={14} />
        <strong className="rail-org-name">{org.org_name}</strong>
        <button
          type="button"
          className="rail-offer-dismiss"
          onClick={() => onLeave(org)}
          disabled={busy}
          title={orgText.leave}
          aria-label={`${orgText.leave} ${org.org_name}`}
        >
          <IconX size={10} />
        </button>
      </div>

      {!org.in_roster ? (
        <output className="rail-org-pending">
          <strong>{org.confirmation_code}</strong>
          <small>{orgText.pendingHint}</small>
        </output>
      ) : null}

      {org.dm_offers.map((offer) => (
        <div className="rail-offer" key={`org-dm-${offer.offer_id}`}>
          <button
            type="button"
            className="rail-item rail-offer-accept"
            onClick={() => onAcceptDmOffer(org.org_pubkey, offer.offer_id)}
            disabled={busy}
            title={`${offer.from_name} · ${orgText.dmOffer}`}
            aria-label={`Accept chat invite from ${offer.from_name}`}
          >
            <Avatar name={offer.from_name} />
            <span className="rail-text">
              <strong>{offer.from_name}</strong>
              <small>{orgText.dmOffer}</small>
            </span>
            <span className="rail-offer-badge" aria-hidden="true">
              <IconMessageCircle size={10} />
            </span>
          </button>
          <button
            type="button"
            className="rail-offer-dismiss"
            onClick={() => onDismissDmOffer(org.org_pubkey, offer.offer_id)}
            title="Dismiss invite"
            aria-label={`Dismiss invite from ${offer.from_name}`}
          >
            <IconX size={10} />
          </button>
        </div>
      ))}

      {org.group_offers.map((offer) => (
        <div className="rail-offer" key={`org-group-${offer.offer_id}`}>
          <button
            type="button"
            className="rail-item rail-offer-accept"
            onClick={() => onAcceptGroupOffer(org.org_pubkey, offer.offer_id)}
            disabled={busy}
            title={`${offer.group_label ?? orgText.groupOffer} · accept`}
            aria-label={`Accept group invite from ${offer.from_name}`}
          >
            <IconUsers size={18} />
            <span className="rail-text">
              <strong>{offer.group_label ?? orgText.groupOffer}</strong>
              <small>
                {orgText.groupOfferFrom} {offer.from_name}
              </small>
            </span>
          </button>
          <button
            type="button"
            className="rail-offer-dismiss"
            onClick={() => onDismissGroupOffer(org.org_pubkey, offer.offer_id)}
            title="Dismiss group invite"
            aria-label={`Dismiss group invite from ${offer.from_name}`}
          >
            <IconX size={10} />
          </button>
        </div>
      ))}

      {org.in_roster && selfIsAdmin ? (
        <form
          className="rail-org-newgroup"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) {
              onCreateGroup(org, groupLabel);
              setGroupLabel("");
            }
          }}
        >
          <input
            type="text"
            value={groupLabel}
            placeholder={orgText.newGroupPlaceholder}
            aria-label={`New group in ${org.org_name}`}
            disabled={busy}
            onChange={(event) => setGroupLabel(event.target.value)}
          />
          <button
            type="submit"
            className="btn btn-ghost btn-icon"
            disabled={busy}
            title={orgText.newGroup}
            aria-label={`${orgText.newGroup} in ${org.org_name}`}
          >
            <IconPlus size={13} />
          </button>
        </form>
      ) : null}

      {org.members.map((member) => (
        <button
          key={`org-member-${member.moss_peer_id}`}
          type="button"
          className="rail-item rail-org-member"
          onClick={() => onMember(org, member)}
          disabled={busy || member.is_self}
          title={
            member.is_self
              ? `${member.name} (${orgText.youBadge})`
              : `${orgText.memberDmHint} ${member.name}`
          }
          aria-label={
            member.is_self
              ? `${member.name} (you)`
              : `Message ${member.name}`
          }
        >
          <Avatar name={member.name} />
          <span className="rail-text">
            <strong>
              {member.name}
              {member.is_self ? ` (${orgText.youBadge})` : ""}
            </strong>
            <small>{shorten(member.moss_peer_id, 6)}</small>
          </span>
          {member.role === "admin" ? (
            <span className="rail-admin-crown" title={orgText.adminBadge}>
              <IconCrown size={11} />
            </span>
          ) : null}
        </button>
      ))}
    </section>
  );
}
