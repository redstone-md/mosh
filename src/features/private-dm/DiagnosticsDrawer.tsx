import {
  IconActivity,
  IconAlertTriangle,
  IconPlugConnected,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
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

function SessionDiagnostics({ session }: { session: SessionSnapshot }) {
  return (
    <>
      <div className="diagnostic-group">
        <div className="diagnostic-group-label">Conversation details</div>
        <Row k="Peer" v={session.peer_display_name || "unknown"} />
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
        <div className="diagnostic-group-label">Channel details</div>
        <Row k="Name" v={`#${channel.name}`} />
        <Row k="Display" v={channel.display_name} />
        <Row k="Topic" v={channel.topic} />
        <Row k="Device" v={shorten(channel.device_fingerprint, 10)} />
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
        <div className="diagnostic-group-label">Group details</div>
        <Row k="Label" v={group.label ?? "-"} />
        <Row k="Members" v={String(group.member_count)} />
        <Row k="Role" v={group.is_admin ? "admin" : "member"} />
        <Row k="MLS state" v={stateLabels[group.state] ?? group.state} />
        <Row k="Display" v={group.display_name} />
        <Row k="Group id" v={shorten(group.group_id, 12)} />
        <Row k="Creator" v={shorten(group.creator_fingerprint, 8)} />
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
        <div className="diagnostic-empty-state">
          <strong>Mesh booting</strong>
          <span>Network facts appear after Moss binds a port and receives its first runtime poll.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="diagnostic-group">
      <div className="diagnostic-group-label">Moss network</div>
      <div className="diagnostic-mesh-grid">
        <Metric label="Peers" value={String(mesh.peer_count)} detail={peerBreakdown(mesh)} />
        <Metric label="NAT" value={mesh.nat_type || "unknown"} detail="reported type" />
        <Metric label="Relay" value={relayStatus(mesh)} detail={relayBreakdown(mesh)} />
        <Metric
          label="Supernode"
          value={mesh.supernode_ready ? "ready" : "standby"}
          detail={mesh.supernode_ready ? "can assist peers" : "not promoted"}
        />
      </div>
      <Row k="Advertised" v={mesh.advertised_addr || "-"} />
      <Row k="Listen port" v={String(mesh.listen_port)} />
      <Row k="Known peers" v={String(mesh.known_peer_count)} />
      <Row k="Relay routes" v={String(mesh.relay_route_count)} />
      <Row k="Channels" v={mesh.channels.length ? String(mesh.channels.length) : "-"} />
      <Row k="Mesh id" v={shorten(mesh.mesh_id, 14)} />
      <Row k="Public key" v={shorten(mesh.public_key, 12)} />
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
          <div className="diagnostic-empty-state event-empty">
            <strong>No events yet</strong>
            <span>Moss will list peer joins, tracker updates, and relay changes here as they happen.</span>
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

type SummaryTone = "ready" | "waiting" | "idle" | "error";

interface DiagnosticSummary {
  readonly tone: SummaryTone;
  readonly kicker: string;
  readonly title: string;
  readonly state: string;
  readonly description: string;
  readonly facts: readonly SummaryFact[];
}

interface SummaryFact {
  readonly label: string;
  readonly value: string;
}

function SummaryCard({ summary }: { summary: DiagnosticSummary }) {
  return (
    <section className={`diagnostic-summary diagnostic-summary-${summary.tone}`}>
      <div className="diagnostic-summary-heading">
        <div>
          <span className="diagnostic-kicker">{summary.kicker}</span>
          <strong>{summary.title}</strong>
        </div>
        <span className="diagnostic-status-badge">
          <span className="diagnostic-status-dot" />
          {summary.state}
        </span>
      </div>
      <p>{summary.description}</p>
      <div className="diagnostic-summary-facts">
        {summary.facts.map((fact) => (
          <div className="diagnostic-summary-fact" key={fact.label}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function RuntimeError({ message }: { message: string }) {
  return (
    <div className="diagnostic-runtime-error" role="alert">
      <IconAlertTriangle size={15} />
      <div>
        <span>Runtime error</span>
        <strong>{message}</strong>
      </div>
    </div>
  );
}

function NoActiveSession() {
  return (
    <div className="diagnostic-group">
      <div className="diagnostic-group-label">Session</div>
      <div className="diagnostic-empty-state">
        <strong>No active session</strong>
        <span>Select a DM, channel, or group to inspect its Moss network and recent events.</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="diagnostic-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function diagnosticsSummary(
  session: SessionSnapshot | null,
  channel: ChannelSnapshot | null,
  group: GroupSnapshot | null,
  error?: string,
): DiagnosticSummary {
  if (session) {
    const mesh = session.mesh;
    const state = stateLabels[session.state] ?? session.state;
    return {
      tone: error ? "error" : summaryTone(session.state),
      kicker: "Private DM",
      title: session.peer_display_name || session.display_name || "Private session",
      state,
      description: sessionDescription(session.state, mesh),
      facts: [
        { label: "Peers", value: peerCount(mesh) },
        { label: "NAT", value: natType(mesh) },
        { label: "Relay", value: mesh ? relayStatus(mesh) : "booting" },
      ],
    };
  }

  if (channel) {
    const mesh = channel.mesh;
    return {
      tone: error ? "error" : "ready",
      kicker: "Public channel",
      title: `#${channel.name}`,
      state: "Broadcast",
      description: "Plaintext channel traffic is riding over the current Moss mesh.",
      facts: [
        { label: "Peers", value: peerCount(mesh) },
        { label: "NAT", value: natType(mesh) },
        { label: "Relay", value: mesh ? relayStatus(mesh) : "booting" },
      ],
    };
  }

  if (group) {
    const mesh = group.mesh;
    const state = stateLabels[group.state] ?? group.state;
    return {
      tone: error ? "error" : summaryTone(group.state),
      kicker: "Private group",
      title: group.label || "Encrypted group",
      state,
      description: `${group.member_count} member${group.member_count === 1 ? "" : "s"} on an MLS-protected group mesh.`,
      facts: [
        { label: "Members", value: String(group.member_count) },
        { label: "Peers", value: peerCount(mesh) },
        { label: "Relay", value: mesh ? relayStatus(mesh) : "booting" },
      ],
    };
  }

  return {
    tone: error ? "error" : "idle",
    kicker: "Diagnostics idle",
    title: "No active session",
    state: error ? "Error" : "Waiting",
    description: "Open a conversation to inspect connection state, peer count, NAT, relay, and events.",
    facts: [
      { label: "Session", value: "none" },
      { label: "Mesh", value: "paused" },
      { label: "Events", value: "none" },
    ],
  };
}

function summaryTone(state: string): SummaryTone {
  if (state === "ready") {
    return "ready";
  }
  if (state === "waiting") {
    return "waiting";
  }
  return "idle";
}

function sessionDescription(state: string, mesh: MeshInfo | null): string {
  if (state === "ready") {
    return mesh && mesh.peer_count > 0
      ? "MLS is ready and Moss sees at least one peer on this mesh."
      : "MLS is ready; Moss peer telemetry is still catching up.";
  }
  if (state === "waiting") {
    return "Invite created. Waiting for the peer and Moss mesh to complete discovery.";
  }
  return "Session exists, but the secure conversation is not connected yet.";
}

function peerCount(mesh: MeshInfo | null): string {
  return mesh ? String(mesh.peer_count) : "booting";
}

function natType(mesh: MeshInfo | null): string {
  return mesh?.nat_type || "unknown";
}

function peerBreakdown(mesh: MeshInfo): string {
  return `${mesh.direct_peer_count} direct / ${mesh.relayed_peer_count} relayed`;
}

function relayStatus(mesh: MeshInfo): string {
  if (mesh.relay_session_count > 0) {
    return `${mesh.relay_session_count} active`;
  }
  if (mesh.relayed_peer_count > 0) {
    return `${mesh.relayed_peer_count} relayed`;
  }
  if (mesh.relay_capable_peer_count > 0) {
    return `${mesh.relay_capable_peer_count} capable`;
  }
  return "none";
}

function relayBreakdown(mesh: MeshInfo): string {
  return `${mesh.relay_capable_peer_count} capable / ${mesh.relay_route_count} routes`;
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
