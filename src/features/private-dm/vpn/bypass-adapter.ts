import type { NetworkInterfaceInfo } from "../native/native-messaging-gateway";

/**
 * Link-local IPv4. Windows hands these out when DHCP never answered, so the
 * NIC is "up" and has an address while being connected to nothing — exactly
 * the adapter that must not win the bypass.
 */
const APIPA_PREFIX = "169.254.";

/** Adapters that can carry Moss around a tunnel. */
export function bypassCandidates(
  list: readonly NetworkInterfaceInfo[],
): readonly NetworkInterfaceInfo[] {
  return list.filter(
    (iface) =>
      iface.is_up &&
      !iface.is_loopback &&
      !iface.is_virtual &&
      !!iface.ipv4 &&
      !iface.ipv4.startsWith(APIPA_PREFIX),
  );
}

/**
 * The adapter to bind to when nobody has chosen one.
 *
 * Any candidate leaves the tunnel, so the first is as good as the last —
 * there is nothing here for the user to get right, which is the point.
 */
export function defaultBypassAdapter(list: readonly NetworkInterfaceInfo[]): string {
  return bypassCandidates(list)[0]?.name ?? "";
}

export function adapterLabel(iface: NetworkInterfaceInfo): string {
  return iface.ipv4 ? `${iface.name} - ${iface.ipv4}` : iface.name;
}
