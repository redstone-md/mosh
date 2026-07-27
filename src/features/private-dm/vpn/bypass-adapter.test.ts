import { describe, expect, it } from "vitest";
import type { NetworkInterfaceInfo } from "../native/native-messaging-gateway";
import { bypassCandidates, defaultBypassAdapter } from "./bypass-adapter";

function iface(over: Partial<NetworkInterfaceInfo>): NetworkInterfaceInfo {
  return {
    name: "iface",
    description: "",
    index: 1,
    ipv4: "192.168.1.5",
    is_loopback: false,
    is_up: true,
    is_virtual: false,
    is_vpn: false,
    is_default_route: false,
    ...over,
  };
}

/**
 * A real reading from a Windows laptop on a VPN, taken from `mosh-probe doctor`
 * on 2026-07-27. Kept verbatim because the interesting cases here are the ones
 * nobody invents: two adapters holding APIPA addresses, and a tunnel that owns
 * the default route while the NIC that should win does not.
 */
const REAL_MACHINE: readonly NetworkInterfaceInfo[] = [
  iface({
    name: "ipv4-tun",
    description: "sing-tun Tunnel",
    index: 49,
    ipv4: "172.18.0.1",
    is_virtual: true,
    is_vpn: true,
    is_default_route: true,
  }),
  iface({
    name: "Tailscale",
    description: "Tailscale Tunnel",
    index: 8,
    ipv4: "169.254.83.107",
    is_virtual: true,
    is_vpn: true,
  }),
  iface({
    name: "Ethernet 3",
    description: "VirtualBox Host-Only Ethernet Adapter",
    index: 4,
    ipv4: "169.254.39.210",
    is_virtual: true,
  }),
  iface({
    name: "Wi-Fi",
    description: "MediaTek MT7921 Wi-Fi 6 802.11ax PCIe Adapter",
    index: 24,
    ipv4: "192.168.18.53",
  }),
  iface({
    name: "ZeroTier One [12ac4a1e7173d247]",
    description: "ZeroTier Virtual Port",
    index: 18,
    ipv4: "172.30.1.2",
    is_virtual: true,
  }),
  iface({
    name: "vEthernet (WSL (Hyper-V firewall))",
    description: "Hyper-V Virtual Ethernet Adapter",
    index: 59,
    ipv4: "172.26.192.1",
    is_virtual: true,
  }),
];

describe("defaultBypassAdapter", () => {
  it("picks the physical NIC out of a machine full of tunnels", () => {
    expect(defaultBypassAdapter(REAL_MACHINE)).toBe("Wi-Fi");
    expect(bypassCandidates(REAL_MACHINE).map((i) => i.name)).toEqual(["Wi-Fi"]);
  });

  it("never picks the tunnel it exists to route around", () => {
    const names = bypassCandidates(REAL_MACHINE).map((i) => i.name);
    expect(names).not.toContain("ipv4-tun");
  });

  it("rejects an APIPA address, which means no address was issued", () => {
    // An unplugged NIC is up and has an ipv4, so a plain truthiness check
    // hands the user an adapter connected to nothing.
    const unplugged = iface({ name: "Ethernet", ipv4: "169.254.10.4" });
    const live = iface({ name: "Wi-Fi", index: 24 });
    expect(defaultBypassAdapter([unplugged, live])).toBe("Wi-Fi");
    expect(defaultBypassAdapter([unplugged])).toBe("");
  });

  it("skips loopback, down and address-less adapters", () => {
    expect(
      defaultBypassAdapter([
        iface({ name: "Loopback", is_loopback: true }),
        iface({ name: "Ethernet 2", is_up: false }),
        iface({ name: "Bluetooth", ipv4: null }),
      ]),
    ).toBe("");
  });

  it("returns empty rather than guessing when nothing qualifies", () => {
    expect(defaultBypassAdapter([])).toBe("");
  });
});
