import { IconAlertTriangle } from "@tabler/icons-react";
import type {
  ChannelSnapshot,
  GroupSnapshot,
  MeshInfo,
  SessionSnapshot,
} from "./native/native-messaging-gateway";
import { natType, peerCount, relayStatus } from "./DiagnosticsDrawerHelpers";
import { stateLabels } from "./private-dm.content";

type SummaryTone = "ready" | "waiting" | "idle" | "error";

export interface DiagnosticSummary {
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

export function SummaryCard({ summary }: { summary: DiagnosticSummary }) {
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

export function RuntimeError({ message }: { message: string }) {
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

export function diagnosticsSummary(
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
