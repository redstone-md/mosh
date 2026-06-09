import { IconActivity, IconPlugConnected, IconRefresh, IconX } from "@tabler/icons-react";
import { stateLabels } from "./private-dm.content";
import type {
  ChannelSnapshot,
  GroupSnapshot,
  MeshInfo,
  SessionSnapshot,
  SnapshotEvent,
} from "./native/native-messaging-gateway";
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
          {session ? (
            <SessionDiagnostics session={session} />
          ) : channel ? (
            <ChannelDiagnostics channel={channel} />
          ) : group ? (
            <GroupDiagnostics group={group} />
          ) : (
            <div className="diagnostic-group">
              <div className="diagnostic-group-label">Session</div>
              <div className="diagnostic-row">
                <span>State</span>
                <strong>No active session</strong>
              </div>
            </div>
          )}

          {error ? (
            <div className="diagnostic-row diagnostic-error">
              <span>Runtime error</span>
              <strong>{error}</strong>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function SessionDiagnostics({ session }: { session: SessionSnapshot }) {
  return (
    <>
      <div className="diagnostic-group">
        <div className="diagnostic-group-label">Session</div>
        <Row k="MLS state" v={stateLabels[session.state] ?? session.state} />
        <Row k="Role" v={session.role} />
        <Row k="Display" v={session.display_name} />
        <Row k="Session" v={shorten(session.session_id, 14)} />
      </div>
      <MeshDiagnostics mesh={session.mesh} />
      <EventLog events={session.events} />
    </>
  );
}

function ChannelDiagnostics({ channel }: { channel: ChannelSnapshot }) {
  return (
    <>
      <div className="diagnostic-group">
        <div className="diagnostic-group-label">Channel</div>
        <Row k="Name" v={`#${channel.name}`} />
        <Row k="Display" v={channel.display_name} />
        <Row k="Device" v={shorten(channel.device_fingerprint, 10)} />
        <Row k="Topic" v={channel.topic} />
      </div>
      <MeshDiagnostics mesh={channel.mesh} />
      <EventLog events={channel.events} />
    </>
  );
}

function GroupDiagnostics({ group }: { group: GroupSnapshot }) {
  return (
    <>
      <div className="diagnostic-group">
        <div className="diagnostic-group-label">Group</div>
        <Row k="Label" v={group.label ?? "-"} />
        <Row k="Members" v={String(group.member_count)} />
        <Row k="Role" v={group.is_admin ? "admin" : "member"} />
        <Row k="MLS state" v={stateLabels[group.state] ?? group.state} />
        <Row k="Group id" v={shorten(group.group_id, 12)} />
        <Row k="Creator" v={shorten(group.creator_fingerprint, 8)} />
        <Row k="Display" v={group.display_name} />
        <Row k="Device" v={shorten(group.device_fingerprint, 10)} />
      </div>
      <MeshDiagnostics mesh={group.mesh} />
      <EventLog events={group.events} />
    </>
  );
}

function MeshDiagnostics({ mesh }: { mesh: MeshInfo | null }) {
  if (!mesh) {
    return (
      <div className="diagnostic-group">
        <div className="diagnostic-group-label">Moss network</div>
        <div className="diagnostic-row">
          <span>Status</span>
          <strong>booting...</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="diagnostic-group">
      <div className="diagnostic-group-label">Moss network</div>
      <Row k="NAT type" v={mesh.nat_type || "unknown"} />
      <Row k="Advertised" v={mesh.advertised_addr || "-"} />
      <Row k="Listen port" v={String(mesh.listen_port)} />
      <Row
        k="Peers"
        v={`${mesh.peer_count} (${mesh.direct_peer_count}d / ${mesh.relayed_peer_count}r)`}
      />
      <Row k="Known" v={String(mesh.known_peer_count)} />
      <Row k="Relay" v={String(mesh.relay_session_count)} />
      <Row k="Supernode" v={mesh.supernode_ready ? "ready" : "no"} />
      <Row k="Mesh id" v={shorten(mesh.mesh_id, 14)} />
    </div>
  );
}

function EventLog({ events }: { events: readonly SnapshotEvent[] }) {
  const slice = events.slice(-40).reverse();
  return (
    <div className="diagnostic-group">
      <div className="diagnostic-group-label">
        <IconActivity size={11} style={{ marginRight: 6, verticalAlign: "-1px" }} />
        Moss events
      </div>
      <div className="diagnostic-scroll">
        {slice.length === 0 ? (
          <div className="diagnostic-row event-empty">
            <span>-</span>
            <strong>no events yet</strong>
          </div>
        ) : (
          slice.map((event, index) => {
            const detail = compactDetail(event.detail_json);
            const time = formatTime(event.epoch_millis);
            return (
              <div className={`diagnostic-row event-row event-${event.event_name}`} key={index}>
                <span>{time}</span>
                <strong>
                  <span className="event-name">{event.event_name}</span>
                  {detail ? <span className="event-detail">{detail}</span> : null}
                </strong>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function compactDetail(raw: string): string {
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
    }
    return String(parsed);
  } catch {
    return raw;
  }
}

function formatTime(epoch: number): string {
  if (!epoch) {
    return "-";
  }
  const date = new Date(epoch);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="diagnostic-row">
      <span>{k}</span>
      <strong>{v}</strong>
    </div>
  );
}

function shorten(value: string, head: number): string {
  if (!value) {
    return "-";
  }
  if (value.length <= head * 2 + 1) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-head)}`;
}
