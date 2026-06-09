import { IconPlugConnected, IconRefresh, IconX } from "@tabler/icons-react";
import type {
  ChannelSnapshot,
  GroupSnapshot,
  SessionSnapshot,
} from "./native/native-messaging-gateway";
import {
  ChannelDiagnostics,
  GroupDiagnostics,
  NoActiveSession,
  SessionDiagnostics,
} from "./DiagnosticsDrawerSections";
import {
  RuntimeError,
  SummaryCard,
  diagnosticsSummary,
} from "./DiagnosticsDrawerSummary";
import { useModalFocus } from "./use-modal-focus";

export function DiagnosticsDrawer({
  session,
  channel,
  group,
  error,
  refreshing,
  onRefresh,
  onClose,
}: {
  session: SessionSnapshot | null;
  channel: ChannelSnapshot | null;
  group: GroupSnapshot | null;
  error?: string;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const drawerRef = useModalFocus(onClose);
  const summary = diagnosticsSummary(session, channel, group, error);

  return (
    <div className="diagnostics-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        ref={drawerRef}
        className="diagnostics-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostics-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <IconPlugConnected size={16} />
          <h2 id="diagnostics-title">Peer status</h2>
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            onClick={onRefresh}
            aria-label="Refresh status"
            disabled={refreshing}
          >
            <IconRefresh size={14} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            type="button"
            onClick={onClose}
            aria-label="Close peer status"
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="diagnostics-content">
          <SummaryCard summary={summary} />

          {error ? <RuntimeError message={error} /> : null}

          {session ? (
            <SessionDiagnostics session={session} />
          ) : channel ? (
            <ChannelDiagnostics channel={channel} />
          ) : group ? (
            <GroupDiagnostics group={group} />
          ) : (
            <NoActiveSession />
          )}
        </div>
      </aside>
    </div>
  );
}
