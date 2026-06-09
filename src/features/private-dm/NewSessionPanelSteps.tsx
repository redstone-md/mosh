import { IconCheck } from "@tabler/icons-react";
import { detectInvite } from "./invite/invite-detection";
import { InviteResult, OnboardStepFrame } from "./NewSessionPanel.parts";
import type { InviteCreateState } from "./NewSessionPanel.types";
import { onboardText } from "./private-dm.content";

export function ChatCreateStep(props: {
  busy: boolean;
  createState: InviteCreateState;
  onBack: () => void;
  onCreate: () => void;
  onCopyInvite: () => void;
}) {
  return (
    <OnboardStepFrame title={onboardText.tileChatTitle} onBack={props.onBack}>
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
  );
}

export function GroupCreateStep(props: {
  value: string;
  busy: boolean;
  createState: InviteCreateState;
  onChange: (value: string) => void;
  onBack: () => void;
  onCreateGroup: (label: string) => void;
  onCopyGroupInvite: () => void;
}) {
  return (
    <OnboardStepFrame title={onboardText.tileGroupTitle} onBack={props.onBack}>
      <form
        className="onboard-menu"
        onSubmit={(event) => {
          event.preventDefault();
          if (!props.busy) {
            props.onCreateGroup(props.value.trim());
          }
        }}
      >
        <p className="step-body">{onboardText.groupStepBody}</p>
        <input
          className="step-input"
          aria-label="Group label"
          placeholder={onboardText.groupNamePlaceholder}
          value={props.value}
          disabled={props.busy}
          onChange={(event) => props.onChange(event.target.value)}
        />
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={props.busy}
        >
          {props.createState.inviteUri
            ? onboardText.groupRecreate
            : onboardText.groupCreate}
        </button>
      </form>
      {props.createState.inviteUri ? (
        <InviteResult
          note={onboardText.groupInviteReady}
          uri={props.createState.inviteUri}
          copied={props.createState.copied}
          onCopy={props.onCopyGroupInvite}
        />
      ) : null}
    </OnboardStepFrame>
  );
}

export function OnboardJoinStep(props: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onBack: () => void;
  onAccept: (uri: string) => void;
  onJoinGroup: (uri: string) => void;
}) {
  const detection = detectInvite(props.value);
  const kind = detection.kind;
  const trimmedValue = props.value.trim();
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
      props.onAccept(trimmedValue);
    } else if (kind === "group") {
      props.onJoinGroup(trimmedValue);
    }
  };
  return (
    <OnboardStepFrame title={onboardText.tileJoinTitle} onBack={props.onBack}>
      <p className="step-body">{onboardText.joinStepBody}</p>
      <textarea
        className="step-textarea"
        aria-label="Invite link"
        aria-invalid={kind === "unknown"}
        placeholder={onboardText.joinPlaceholder}
        value={props.value}
        disabled={props.busy}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <div className={detectClass} role="status" aria-live="polite">
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

export function ChannelJoinStep(props: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onBack: () => void;
  onJoinChannel: (name: string) => void;
}) {
  const trimmedValue = props.value.trim();
  return (
    <OnboardStepFrame title={onboardText.tileChannelTitle} onBack={props.onBack}>
      <form
        className="onboard-menu"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmedValue && !props.busy) {
            props.onJoinChannel(trimmedValue);
          }
        }}
      >
        <p className="step-body">{onboardText.channelStepBody}</p>
        <div className="step-channel-input">
          <span aria-hidden="true">#</span>
          <input
            aria-label="Channel name"
            placeholder={onboardText.channelPlaceholder}
            value={props.value}
            disabled={props.busy}
            onChange={(event) => props.onChange(event.target.value)}
          />
        </div>
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={props.busy || !trimmedValue}
        >
          {onboardText.channelJoin}
        </button>
      </form>
    </OnboardStepFrame>
  );
}
