import {
  IconCrown,
  IconHash,
  IconMessageCircle,
  IconPlus,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { Avatar } from "./Avatar";
import { type ChatTarget } from "./chat-actions";
import { shorten } from "./format";
import type {
  ChannelSnapshot,
  DmOffer,
  GroupSnapshot,
  OrgMemberView,
  OrgSnapshot,
  SessionSnapshot,
} from "./native/native-messaging-gateway";
import { OrgSection } from "./org/OrgSection";
import { groupText, orgText, shellText, stateLabels } from "./private-dm.content";

export type PendingDmOffer = DmOffer & {
  readonly kind: "channel" | "group";
  readonly host: string;
};

export interface OrgRailApi {
  readonly orgs: readonly OrgSnapshot[];
  readonly busy: boolean;
  readonly revokedDmBadges: ReadonlyMap<string, string>;
  readonly onMember: (org: OrgSnapshot, member: OrgMemberView) => void;
  readonly onAcceptDmOffer: (orgPubkey: string, offerId: string) => void;
  readonly onDismissDmOffer: (orgPubkey: string, offerId: string) => void;
  readonly onAcceptGroupOffer: (orgPubkey: string, offerId: string) => void;
  readonly onDismissGroupOffer: (orgPubkey: string, offerId: string) => void;
  readonly onLeave: (org: OrgSnapshot) => void;
}

export function SessionRail({
  expanded,
  sessions,
  channels,
  groups,
  offers,
  org,
  active,
  unread,
  sessionLabel,
  onSelect,
  onAcceptOffer,
  onDismissOffer,
  onNew,
  onToggle,
}: {
  expanded: boolean;
  sessions: readonly SessionSnapshot[];
  channels: readonly ChannelSnapshot[];
  groups: readonly GroupSnapshot[];
  offers: readonly PendingDmOffer[];
  org: OrgRailApi;
  active: ChatTarget | null;
  unread: ReadonlyMap<string, number>;
  sessionLabel: (session: SessionSnapshot) => string;
  onSelect: (item: ChatTarget) => void;
  onAcceptOffer: (offer: PendingDmOffer) => void;
  onDismissOffer: (offer: PendingDmOffer) => void;
  onNew: () => void;
  onToggle: () => void;
}) {
  return (
    <>
      {expanded ? (
        <button
          className="rail-backdrop"
          type="button"
          aria-label="Close conversations"
          onClick={onToggle}
        />
      ) : null}
      <aside
        id="conversation-rail"
        className={`session-rail${expanded ? " session-rail-expanded" : ""}`}
        aria-label="Active sessions"
      >
        <button className="rail-new" type="button" onClick={onNew} aria-label={shellText.newSession}>
          <IconPlus size={18} />
          <span className="rail-new-label">New chat</span>
        </button>
        <div className="rail-divider" />
        <div className="rail-list">
          {offers.map((offer) => (
            <OfferRailItem
              key={`offer-${offer.offer_id}`}
              offer={offer}
              onAccept={() => onAcceptOffer(offer)}
              onDismiss={() => onDismissOffer(offer)}
            />
          ))}
          {offers.length > 0 ? <div className="rail-divider" /> : null}
          {sessions.map((session) => (
            <SessionRailItem
              key={`dm-${session.session_id}`}
              session={session}
              label={sessionLabel(session)}
              revokedOrgName={org.revokedDmBadges.get(session.session_id)}
              active={active?.type === "dm" && active.id === session.session_id}
              unreadCount={unread.get(`dm:${session.session_id}`) ?? 0}
              onClick={() => onSelect({ type: "dm", id: session.session_id })}
            />
          ))}
          {groups.length > 0 && sessions.length > 0 ? <div className="rail-divider" /> : null}
          {groups.map((group) => (
            <GroupRailItem
              key={`gr-${group.group_id}`}
              group={group}
              active={active?.type === "group" && active.id === group.group_id}
              unreadCount={unread.get(`group:${group.group_id}`) ?? 0}
              onClick={() => onSelect({ type: "group", id: group.group_id })}
            />
          ))}
          {channels.length > 0 && (sessions.length > 0 || groups.length > 0) ? (
            <div className="rail-divider" />
          ) : null}
          {channels.map((channel) => (
            <ChannelRailItem
              key={`ch-${channel.name}`}
              channel={channel}
              active={active?.type === "channel" && active.name === channel.name}
              unreadCount={unread.get(`channel:${channel.name}`) ?? 0}
              onClick={() => onSelect({ type: "channel", name: channel.name })}
            />
          ))}
          {org.orgs.map((snapshot) => (
            <div key={`org-${snapshot.org_pubkey}`}>
              <div className="rail-divider" />
              <OrgSection
                org={snapshot}
                busy={org.busy}
                onMember={org.onMember}
                onAcceptDmOffer={org.onAcceptDmOffer}
                onDismissDmOffer={org.onDismissDmOffer}
                onAcceptGroupOffer={org.onAcceptGroupOffer}
                onDismissGroupOffer={org.onDismissGroupOffer}
                onLeave={org.onLeave}
              />
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

function OfferRailItem({
  offer,
  onAccept,
  onDismiss,
}: {
  offer: PendingDmOffer;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rail-offer">
      <button
        type="button"
        className="rail-item rail-offer-accept"
        onClick={onAccept}
        title={`${offer.from_device} wants to chat · accept`}
        aria-label={`Accept chat invite from ${offer.from_device}`}
      >
        <Avatar name={offer.from_device} />
        <span className="rail-text">
          <strong>{offer.from_device}</strong>
          <small>{offer.kind === "channel" ? `#${offer.host}` : "group invite"}</small>
        </span>
        <span className="rail-offer-badge" aria-hidden="true">
          <IconMessageCircle size={10} />
        </span>
      </button>
      <button
        type="button"
        className="rail-offer-dismiss"
        onClick={onDismiss}
        title="Dismiss invite"
        aria-label={`Dismiss invite from ${offer.from_device}`}
      >
        <IconX size={10} />
      </button>
    </div>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <span className="unread-badge" aria-label={`${count} unread`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SessionRailItem({
  session,
  label,
  revokedOrgName,
  active,
  unreadCount,
  onClick,
}: {
  session: SessionSnapshot;
  label: string;
  revokedOrgName?: string;
  active: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rail-item ${active ? "rail-item-active" : ""}`}
      onClick={onClick}
      title={`${label} · ${stateLabels[session.state] ?? session.state}`}
      aria-label={`Open session with ${label}`}
    >
      <Avatar name={label} />
      <span className="rail-text">
        <strong>{label}</strong>
        <small>
          {revokedOrgName
            ? `${orgText.revokedBadge} ${revokedOrgName}`
            : stateLabels[session.state] ?? session.state}
        </small>
      </span>
      <span className={`rail-dot rail-dot-${session.state}`} />
      <UnreadBadge count={unreadCount} />
    </button>
  );
}

function ChannelRailItem({
  channel,
  active,
  unreadCount,
  onClick,
}: {
  channel: ChannelSnapshot;
  active: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rail-item rail-channel ${active ? "rail-item-active" : ""}`}
      onClick={onClick}
      title={`#${channel.name}`}
      aria-label={`Open channel ${channel.name}`}
    >
      <IconHash size={18} />
      <span className="rail-text">
        <strong>#{channel.name}</strong>
        <small>{channel.topic}</small>
      </span>
      <UnreadBadge count={unreadCount} />
    </button>
  );
}

function GroupRailItem({
  group,
  active,
  unreadCount,
  onClick,
}: {
  group: GroupSnapshot;
  active: boolean;
  unreadCount: number;
  onClick: () => void;
}) {
  const label = group.label ?? shorten(group.group_id, 6);
  return (
    <button
      type="button"
      className={`rail-item rail-group ${active ? "rail-item-active" : ""}`}
      onClick={onClick}
      title={`${label} · ${group.member_count} members${group.is_admin ? " · admin" : ""}`}
      aria-label={`Open group ${label}`}
    >
      <IconUsers size={18} />
      <span className="rail-text">
        <strong>{label}</strong>
        <small>{group.member_count} members</small>
      </span>
      {group.is_admin ? (
        <span className="rail-admin-crown" title={groupText.adminBadge}>
          <IconCrown size={11} />
        </span>
      ) : null}
      <span className={`rail-dot rail-dot-${group.state}`} />
      <UnreadBadge count={unreadCount} />
    </button>
  );
}
