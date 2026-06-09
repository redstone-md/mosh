import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
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
import { detectInvite } from "./invite/invite-detection";
import type { NativeMessagingGateway } from "./native/native-messaging-gateway";
import {
  cryptoNotice,
  onboardText,
  setupText,
} from "./private-dm.content";
import { BindInterfaceField } from "./vpn/BindInterfaceField";
import { VpnBanner } from "./vpn/VpnBanner";
import type { PersistenceWarning } from "./use-runtime-persistence-status";

type OnboardStep = "menu" | "chat" | "group" | "join" | "channel";

interface InviteCreateState {
  readonly inviteUri?: string;
  readonly copied: boolean;
}

export function NewSessionPanel(props: {
  displayName: string;
  staticPeer: string;
  listenPort: number;
  busy: boolean;
  createState: InviteCreateState;
  groupCreateState: InviteCreateState;
  error?: string;
  persistenceWarning?: PersistenceWarning | null;
  gateway: NativeMessagingGateway;
  onDisplayName: (value: string) => void;
  onStaticPeer: (value: string) => void;
  onListenPort: (value: number) => void;
  onCreate: () => void;
  onAccept: (uri: string) => void;
  onJoinChannel: (name: string) => void;
  onCreateGroup: (label: string) => void;
  onJoinGroup: (uri: string) => void;
  onCopyInvite: () => void;
  onCopyGroupInvite: () => void;
}) {
  const [step, setStep] = useState<OnboardStep>("menu");
  const [joinValue, setJoinValue] = useState("");
  const [channelValue, setChannelValue] = useState("");
  const [groupLabelValue, setGroupLabelValue] = useState("");

  return (
    <div className="onboard scroll">
      <div className="onboard-shell">
        <VpnBanner gateway={props.gateway} />
        {props.persistenceWarning ? (
          <PersistenceWarningBanner warning={props.persistenceWarning} />
        ) : null}
        {step === "menu" ? (
          <OnboardMenu
            displayName={props.displayName}
            staticPeer={props.staticPeer}
            listenPort={props.listenPort}
            gateway={props.gateway}
            onDisplayName={props.onDisplayName}
            onStaticPeer={props.onStaticPeer}
            onListenPort={props.onListenPort}
            onPick={setStep}
          />
        ) : step === "chat" ? (
          <OnboardStepFrame title={onboardText.tileChatTitle} onBack={() => setStep("menu")}>
            <p className="step-body">{onboardText.chatStepBody}</p>
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={props.onCreate}
              disabled={props.busy}
            >
              {props.createState.inviteUri ? onboardText.chatRecreate : onboardText.chatCreate}
            </button>
            {props.createState.inviteUri ? (
              <InviteResult
                note={onboardText.inviteReady}
                uri={props.createState.inviteUri}
                copied={props.createState.copied}
                onCopy={props.onCopyInvite}
              />
            ) : null}
          </OnboardStepFrame>
        ) : step === "group" ? (
          <OnboardStepFrame title={onboardText.tileGroupTitle} onBack={() => setStep("menu")}>
            <p className="step-body">{onboardText.groupStepBody}</p>
            <input
              className="step-input"
              aria-label="Group label"
              placeholder={onboardText.groupNamePlaceholder}
              value={groupLabelValue}
              onChange={(event) => setGroupLabelValue(event.target.value)}
            />
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={() => props.onCreateGroup(groupLabelValue)}
              disabled={props.busy}
            >
              {props.groupCreateState.inviteUri
                ? onboardText.groupRecreate
                : onboardText.groupCreate}
            </button>
            {props.groupCreateState.inviteUri ? (
              <InviteResult
                note={onboardText.groupInviteReady}
                uri={props.groupCreateState.inviteUri}
                copied={props.groupCreateState.copied}
                onCopy={props.onCopyGroupInvite}
              />
            ) : null}
          </OnboardStepFrame>
        ) : step === "join" ? (
          <OnboardJoinStep
            value={joinValue}
            busy={props.busy}
            onChange={setJoinValue}
            onBack={() => setStep("menu")}
            onAccept={props.onAccept}
            onJoinGroup={props.onJoinGroup}
          />
        ) : (
          <OnboardStepFrame
            title={onboardText.tileChannelTitle}
            onBack={() => setStep("menu")}
          >
            <p className="step-body">{onboardText.channelStepBody}</p>
            <div className="step-channel-input">
              <span aria-hidden="true">#</span>
              <input
                aria-label="Channel name"
                placeholder={onboardText.channelPlaceholder}
                value={channelValue}
                onChange={(event) => setChannelValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && channelValue.trim() && !props.busy) {
                    event.preventDefault();
                    props.onJoinChannel(channelValue);
                  }
                }}
              />
            </div>
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={() => props.onJoinChannel(channelValue)}
              disabled={props.busy || !channelValue.trim()}
            >
              {onboardText.channelJoin}
            </button>
          </OnboardStepFrame>
        )}

        {props.error ? <div className="inline-error">{props.error}</div> : null}
      </div>
    </div>
  );
}

function PersistenceWarningBanner({
  warning,
}: {
  warning: PersistenceWarning;
}) {
  return (
    <div className="persistence-warning" role="status">
      <span className="persistence-warning-icon" aria-hidden="true">
        <IconAlertTriangle size={15} />
      </span>
      <div>
        <strong>{warning.title}</strong>
        <span>{warning.body}</span>
      </div>
    </div>
  );
}

function OnboardMenu(props: {
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

function OnboardStepFrame({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="step-frame">
      <button type="button" className="step-back" onClick={onBack}>
        <IconArrowLeft size={14} />
        {onboardText.back}
      </button>
      <h1 className="step-title">{title}</h1>
      {children}
    </div>
  );
}

function OnboardJoinStep(props: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onBack: () => void;
  onAccept: (uri: string) => void;
  onJoinGroup: (uri: string) => void;
}) {
  const detection = detectInvite(props.value);
  const kind = detection.kind;
  const ready = (kind === "dm" || kind === "group") && !props.busy;
  const detectClass =
    kind === "dm" || kind === "group"
      ? "detect-badge detect-badge-ok"
      : kind === "unknown"
        ? "detect-badge detect-badge-bad"
        : "detect-badge";
  const detectLabel =
    kind === "dm"
      ? onboardText.joinDetectChat
      : kind === "group"
        ? onboardText.joinDetectGroup
        : kind === "unknown"
          ? detection.errorMessage ?? onboardText.joinDetectBad
          : onboardText.joinDetectNone;
  const connect = () => {
    if (kind === "dm") {
      props.onAccept(props.value);
    } else if (kind === "group") {
      props.onJoinGroup(props.value);
    }
  };
  return (
    <OnboardStepFrame title={onboardText.tileJoinTitle} onBack={props.onBack}>
      <p className="step-body">{onboardText.joinStepBody}</p>
      <textarea
        className="step-textarea"
        aria-label="Invite link"
        placeholder={onboardText.joinPlaceholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <div className={detectClass} aria-live="polite">
        {kind === "dm" || kind === "group" ? <IconCheck size={13} /> : null}
        <span>{detectLabel}</span>
      </div>
      <button
        className="btn btn-primary btn-block"
        type="button"
        onClick={connect}
        disabled={!ready}
      >
        {onboardText.joinConnect}
      </button>
    </OnboardStepFrame>
  );
}

function InviteResult({
  note,
  uri,
  copied,
  onCopy,
}: {
  note: string;
  uri: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="invite-ready">
      <div className="invite-ready-note">
        <IconCheck size={14} />
        <span>{note}</span>
      </div>
      <code className="invite-code">{uri}</code>
      <button className="btn btn-ghost btn-block" type="button" onClick={onCopy}>
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        {copied ? onboardText.copied : onboardText.copyLink}
      </button>
    </div>
  );
}

function Disclosure({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`disclosure${open ? " disclosure-open" : ""}`}>
      <button
        type="button"
        className="disclosure-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span>{label}</span>
        <IconChevronDown size={14} className="disclosure-caret" />
      </button>
      {open ? <div className="disclosure-body">{children}</div> : null}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
