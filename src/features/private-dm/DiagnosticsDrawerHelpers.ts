import type { MeshInfo } from "./native/native-messaging-gateway";

export function peerCount(mesh: MeshInfo | null): string {
  return mesh ? String(mesh.peer_count) : "booting";
}

export function natType(mesh: MeshInfo | null): string {
  return mesh?.nat_type || "unknown";
}

export function peerBreakdown(mesh: MeshInfo): string {
  return `${mesh.direct_peer_count} direct / ${mesh.relayed_peer_count} relayed`;
}

export function relayStatus(mesh: MeshInfo): string {
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

export function relayBreakdown(mesh: MeshInfo): string {
  return `${mesh.relay_capable_peer_count} capable / ${mesh.relay_route_count} routes`;
}

// Human label for a DM's transport path. "relayed" gets the "via supernode"
// suffix to make clear the path is a Mesh-TURN relay (still E2E — the supernode
// only sees ciphertext). While the shared relay node has not converged yet
// (relayReady === false) the label says so — sends are queued, not failing.
export function pathLabel(path: string, relayReady?: boolean): string {
  switch (path) {
    case "relayed":
      return relayReady === false
        ? "relayed via supernode (warming up)"
        : "relayed via supernode";
    case "direct":
      return "direct";
    case "connecting":
      return "connecting";
    default:
      return path || "unknown";
  }
}

export function compactDetail(raw: string): string {
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed)
        .map(([key, value]) =>
          value !== null && typeof value === "object"
            ? `${key}=${JSON.stringify(value)}`
            : `${key}=${value}`,
        )
        .join(" ");
    }
    return String(parsed);
  } catch {
    return raw;
  }
}

export function formatTime(epoch: number): string {
  if (!epoch) {
    return "-";
  }
  const date = new Date(epoch);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function shorten(value: string, head: number): string {
  if (!value) {
    return "-";
  }
  if (value.length <= head * 2 + 1) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-head)}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
