import { IconActivity } from "@tabler/icons-react";
import type {
  ChannelSnapshot,
  GroupSnapshot,
  MeshInfo,
  SessionSnapshot,
  SnapshotEvent,
} from "./native/native-messaging-gateway";
import {
  compactDetail,
  formatTime,
  peerBreakdown,
  relayBreakdown,
  relayStatus,
  shorten,
} from "./DiagnosticsDrawerHelpers";
import { stateLabels } from "./private-dm.content";

export function SessionDiagnostics({ session }: { session: SessionSnapshot }) {
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

export function ChannelDiagnostics({ channel }: { channel: ChannelSnapshot }) {
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

export function GroupDiagnostics({ group }: { group: GroupSnapshot }) {
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

export function NoActiveSession() {
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="diagnostic-row">
      <span>{k}</span>
      <strong>{v}</strong>
    </div>
  );
}
