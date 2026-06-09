import {
  IconChevronRight,
  IconHash,
  IconLink,
  IconMessageCircle,
  IconPencil,
  IconSettings,
  IconShieldCheck,
  IconUsers,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { Avatar } from "./Avatar";
import { Disclosure, Field } from "./NewSessionPanel.parts";
import type { OnboardStep } from "./NewSessionPanel.types";
import type { NativeMessagingGateway } from "./native/native-messaging-gateway";
import { cryptoNotice, onboardText, setupText } from "./private-dm.content";
import { BindInterfaceField } from "./vpn/BindInterfaceField";

export function OnboardMenu(props: {
  displayName: string;
  staticPeer: string;
  listenPort: number;
  gateway: NativeMessagingGateway;
  onDisplayName: (value: string) => void;
  onStaticPeer: (value: string) => void;
  onListenPort: (value: number) => void;
  onPick: (step: OnboardStep) => void;
}) {
  return (
    <div className="onboard-menu">
      <IdentityChip name={props.displayName} onRename={props.onDisplayName} />

      <header className="onboard-head">
        <h1>{onboardText.title}</h1>
        <p>{onboardText.subtitle}</p>
      </header>

      <div className="onboard-section-label">{onboardText.startLabel}</div>
      <div className="onboard-tiles">
        <OnboardTile
          icon={<IconMessageCircle size={20} />}
          title={onboardText.tileChatTitle}
          desc={onboardText.tileChatDesc}
          onClick={() => props.onPick("chat")}
        />
        <OnboardTile
          icon={<IconUsers size={20} />}
          title={onboardText.tileGroupTitle}
          desc={onboardText.tileGroupDesc}
          onClick={() => props.onPick("group")}
        />
      </div>

      <div className="onboard-section-label">{onboardText.joinLabel}</div>
      <div className="onboard-tiles">
        <OnboardTile
          icon={<IconLink size={20} />}
          title={onboardText.tileJoinTitle}
          desc={onboardText.tileJoinDesc}
          onClick={() => props.onPick("join")}
        />
        <OnboardTile
          icon={<IconHash size={20} />}
          title={onboardText.tileChannelTitle}
          desc={onboardText.tileChannelDesc}
          onClick={() => props.onPick("channel")}
        />
      </div>

      <div className="onboard-foot">
        <Disclosure
          icon={<IconSettings size={14} />}
          label={onboardText.advancedToggle}
        >
          <Field label={setupText.staticPeerLabel} hint={setupText.staticPeerHint}>
            <input
              aria-label="Static peer"
              placeholder={setupText.staticPeerPlaceholder}
              value={props.staticPeer}
              onChange={(event) => props.onStaticPeer(event.target.value)}
            />
          </Field>
          <Field label={setupText.listenPortLabel} hint={setupText.listenPortHint}>
            <input
              type="number"
              min={0}
              max={65535}
              aria-label="Listen port"
              value={props.listenPort}
              onChange={(event) => props.onListenPort(Number(event.target.value) || 0)}
            />
          </Field>
          <BindInterfaceField gateway={props.gateway} />
        </Disclosure>
        <Disclosure icon={<IconShieldCheck size={14} />} label={onboardText.aboutToggle}>
          <p className="disclosure-text">{cryptoNotice.body}</p>
        </Disclosure>
      </div>
    </div>
  );
}

function IdentityChip({
  name,
  onRename,
}: {
  name: string;
  onRename: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="onboard-identity">
      <Avatar name={name} />
      {editing ? (
        <input
          className="identity-input"
          aria-label="Display name"
          autoFocus
          value={name}
          onChange={(event) => onRename(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="identity-text">
          <strong>{name}</strong>
          <span>{onboardText.identityHint}</span>
        </div>
      )}
      {editing ? null : (
        <button
          type="button"
          className="identity-edit"
          aria-label="Edit display name"
          title="Edit display name"
          onClick={() => setEditing(true)}
        >
          <IconPencil size={13} />
        </button>
      )}
    </div>
  );
}

function OnboardTile({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="onboard-tile" onClick={onClick}>
      <span className="tile-icon">{icon}</span>
      <span className="tile-text">
        <strong>{title}</strong>
        <span>{desc}</span>
      </span>
      <IconChevronRight size={16} className="tile-chevron" />
    </button>
  );
}
