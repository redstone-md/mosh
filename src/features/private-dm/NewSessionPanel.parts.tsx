import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconCopy,
} from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { onboardText } from "./private-dm.content";
import type { PersistenceWarning } from "./use-runtime-persistence-status";

export function PersistenceWarningBanner({
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

export function OnboardStepFrame({
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

export function InviteResult({
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

export function Disclosure({
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

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
