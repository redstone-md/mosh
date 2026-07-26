//! Cross-platform NIC enumeration with VPN-tunnel classification.
//!
//! On Windows we call `GetAdaptersAddresses` and read the IANA `ifType`
//! field, which is filled in by the driver and survives renaming the
//! adapter — far more reliable than name heuristics (Tailscale, ClearVPN,
//! corporate VPNs all show up as `IF_TYPE_TUNNEL` regardless of label).
//!
//! On non-Windows we fall back to `if-addrs` plus a name-pattern guess so
//! the rest of the app keeps compiling, even if the VPN detection there is
//! less precise.

#[derive(Debug, Clone, serde::Serialize)]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub description: String,
    pub index: u32,
    pub ipv4: Option<String>,
    pub is_loopback: bool,
    pub is_up: bool,
    /// True when the OS classifies this NIC as a tunnel / virtual / VPN
    /// device, regardless of its display name.
    pub is_virtual: bool,
    /// True when this virtual NIC looks like a privacy/corporate VPN tunnel.
    /// Overlay meshes and VM host adapters stay virtual, but do not trigger
    /// the VPN warning by themselves.
    pub is_vpn: bool,
    /// True when the system's IPv4 default route points through this NIC.
    /// Combined with `is_virtual = true` this is the single best signal
    /// that "an active VPN owns this user's traffic right now".
    pub is_default_route: bool,
}

/// Catch-all needles used as a *secondary* signal on Windows and the
/// *only* signal on Linux/macOS. Keep liberal — false positives are
/// recoverable (the user picks a different NIC); false negatives leave
/// them stuck inside a VPN tunnel with no warning.
const VIRTUAL_NAME_NEEDLES: &[&str] = &[
    "tun",
    "tap",
    "wintun",
    "wireguard",
    "wg",
    "openvpn",
    "anyconnect",
    "globalprotect",
    "nordlynx",
    "mullvad",
    "proton",
    "zerotier",
    "tailscale",
    "clearvpn",
    "expressvpn",
    "surfshark",
    "sing-tun",
    "singbox",
    "sing-box",
    "clash",
    "mihomo",
    "vethernet",
    "hyper-v",
    "virtual",
    "vmware",
    "vbox",
    "virtualbox",
    "loopback",
    "pseudo",
    "vpn",
];

const VPN_NAME_NEEDLES: &[&str] = &[
    "tun",
    "tap",
    "wintun",
    "wireguard",
    "wg",
    "openvpn",
    "anyconnect",
    "globalprotect",
    "nordlynx",
    "mullvad",
    "proton",
    "clearvpn",
    "expressvpn",
    "surfshark",
    "hotspotshield",
    "sing-tun",
    "singbox",
    "sing-box",
    "clash",
    "mihomo",
    "vpn",
];

pub fn name_looks_virtual(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    VIRTUAL_NAME_NEEDLES
        .iter()
        .any(|needle| lower.contains(needle))
}

pub fn name_looks_vpn(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    VPN_NAME_NEEDLES.iter().any(|needle| lower.contains(needle))
}

#[cfg(windows)]
pub fn list_interfaces() -> Result<Vec<NetworkInterfaceInfo>, String> {
    windows_impl::enumerate()
}

#[cfg(not(windows))]
pub fn list_interfaces() -> Result<Vec<NetworkInterfaceInfo>, String> {
    fallback_impl::enumerate()
}

#[cfg(windows)]
mod windows_impl {
    use super::{name_looks_virtual, name_looks_vpn, NetworkInterfaceInfo};
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetAdaptersAddresses, GetIpForwardTable2, GAA_FLAG_INCLUDE_PREFIX,
        GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
        IP_ADAPTER_ADDRESSES_LH, MIB_IPFORWARD_TABLE2,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;

    // IANA-registered ifType values, hard-coded because windows-sys 0.61
    // doesn't re-export the IF_TYPE_* constants. See
    // https://www.iana.org/assignments/ianaiftype-mib/ianaiftype-mib for
    // the authoritative list.
    const IF_TYPE_ETHERNET_CSMACD: u32 = 6;
    const IF_TYPE_PPP: u32 = 23;
    const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
    const IF_TYPE_PROP_VIRTUAL: u32 = 53;
    const IF_TYPE_IEEE80211: u32 = 71;
    const IF_TYPE_TUNNEL: u32 = 131;

    const AF_UNSPEC: u32 = 0;
    const AF_INET: u16 = 2;
    const BUFFER_OVERFLOW: u32 = 111;
    const NO_ERROR: u32 = 0;

    pub fn enumerate() -> Result<Vec<NetworkInterfaceInfo>, String> {
        let raw = unsafe { fetch_adapters()? };
        let default_route_indices = unsafe { collect_default_route_indices() };

        let mut out = Vec::with_capacity(raw.len());
        for adapter in &raw {
            let name = adapter.friendly_name.clone();
            let description = adapter.description.clone();
            let ipv4 = adapter.ipv4.clone();
            let if_type = adapter.if_type;
            let is_up = adapter.oper_status == IfOperStatusUp;
            let index = adapter.ipv4_if_index.max(adapter.ipv6_if_index);
            let is_loopback = if_type == IF_TYPE_SOFTWARE_LOOPBACK;
            let is_physical = if_type == IF_TYPE_ETHERNET_CSMACD || if_type == IF_TYPE_IEEE80211;
            let searchable_name = format!("{name} {description}");
            let mut is_virtual = if_type == IF_TYPE_TUNNEL
                || if_type == IF_TYPE_PROP_VIRTUAL
                || if_type == IF_TYPE_PPP;
            // Many drivers (e.g. WireGuard via wintun) report
            // IF_TYPE_ETHERNET_CSMACD. Use the name pattern as a tie-breaker
            // so we still flag them.
            if !is_virtual && !is_physical && name_looks_virtual(&searchable_name) {
                is_virtual = true;
            }
            if !is_virtual && is_physical && name_looks_virtual(&searchable_name) {
                // Physical-looking IfType but a virtual-sounding name —
                // surface it so the user can confirm. Bias toward the
                // safer "treat as virtual" choice.
                is_virtual = true;
            }
            let is_vpn = is_up
                && !is_loopback
                && (name_looks_vpn(&searchable_name)
                    || if_type == IF_TYPE_TUNNEL
                    || if_type == IF_TYPE_PPP);
            let is_default_route = default_route_indices.contains(&index);
            out.push(NetworkInterfaceInfo {
                name,
                description,
                index,
                ipv4,
                is_loopback,
                is_up,
                is_virtual,
                is_vpn,
                is_default_route,
            });
        }
        Ok(out)
    }

    struct AdapterSnapshot {
        friendly_name: String,
        description: String,
        ipv4: Option<String>,
        if_type: u32,
        oper_status: i32,
        ipv4_if_index: u32,
        ipv6_if_index: u32,
    }

    unsafe fn fetch_adapters() -> Result<Vec<AdapterSnapshot>, String> {
        let flags = GAA_FLAG_SKIP_ANYCAST
            | GAA_FLAG_SKIP_MULTICAST
            | GAA_FLAG_SKIP_DNS_SERVER
            | GAA_FLAG_INCLUDE_PREFIX;
        let mut size: u32 = 16 * 1024;
        let mut buffer = vec![0u8; size as usize];
        for _ in 0..3 {
            let ret = GetAdaptersAddresses(
                AF_UNSPEC,
                flags,
                std::ptr::null_mut(),
                buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            );
            if ret == NO_ERROR {
                break;
            }
            if ret == BUFFER_OVERFLOW {
                buffer.resize(size as usize, 0);
                continue;
            }
            return Err(format!("GetAdaptersAddresses failed: {ret}"));
        }
        let mut snapshots = Vec::new();
        let mut cursor = buffer.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
        while !cursor.is_null() {
            let adapter = &*cursor;
            let friendly_name = read_wide_string(adapter.FriendlyName);
            let description = read_wide_string(adapter.Description);
            let ipv4 = collect_first_ipv4(adapter);
            snapshots.push(AdapterSnapshot {
                friendly_name,
                description,
                ipv4,
                if_type: adapter.IfType,
                oper_status: adapter.OperStatus,
                ipv4_if_index: adapter.Anonymous1.Anonymous.IfIndex,
                ipv6_if_index: adapter.Ipv6IfIndex,
            });
            cursor = adapter.Next;
        }
        Ok(snapshots)
    }

    unsafe fn collect_first_ipv4(adapter: &IP_ADAPTER_ADDRESSES_LH) -> Option<String> {
        let mut unicast = adapter.FirstUnicastAddress;
        while !unicast.is_null() {
            let entry = &*unicast;
            let socket_addr = entry.Address.lpSockaddr;
            if !socket_addr.is_null() {
                let family = (*socket_addr).sa_family;
                if family == AF_INET {
                    let raw =
                        socket_addr as *const windows_sys::Win32::Networking::WinSock::SOCKADDR_IN;
                    let octets = (*raw).sin_addr.S_un.S_un_b;
                    return Some(format!(
                        "{}.{}.{}.{}",
                        octets.s_b1, octets.s_b2, octets.s_b3, octets.s_b4
                    ));
                }
            }
            unicast = entry.Next;
        }
        None
    }

    unsafe fn read_wide_string(ptr: *const u16) -> String {
        if ptr.is_null() {
            return String::new();
        }
        let mut len = 0usize;
        while *ptr.add(len) != 0 {
            len += 1;
            if len > 1024 {
                break;
            }
        }
        let slice = std::slice::from_raw_parts(ptr, len);
        OsString::from_wide(slice).to_string_lossy().into_owned()
    }

    /// Returns interface indices that carry the IPv4 default route.
    unsafe fn collect_default_route_indices() -> Vec<u32> {
        let mut table: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
        if GetIpForwardTable2(AF_INET, &mut table) != NO_ERROR || table.is_null() {
            return Vec::new();
        }
        let mut out = Vec::new();
        let count = (*table).NumEntries as usize;
        let base = (*table).Table.as_ptr();
        for i in 0..count {
            let row = &*base.add(i);
            let prefix_len = row.DestinationPrefix.PrefixLength;
            if prefix_len != 0 {
                continue;
            }
            let family = row.DestinationPrefix.Prefix.si_family;
            if family != AF_INET {
                continue;
            }
            out.push(row.InterfaceIndex);
        }
        FreeMibTable(table as *mut _);
        out
    }
}

#[cfg(not(windows))]
mod fallback_impl {
    use super::{name_looks_virtual, name_looks_vpn, NetworkInterfaceInfo};
    use std::collections::BTreeMap;

    pub fn enumerate() -> Result<Vec<NetworkInterfaceInfo>, String> {
        let raw = if_addrs::get_if_addrs().map_err(|e| e.to_string())?;
        let mut by_name: BTreeMap<String, NetworkInterfaceInfo> = BTreeMap::new();
        for iface in raw {
            let entry = by_name
                .entry(iface.name.clone())
                .or_insert_with(|| NetworkInterfaceInfo {
                    name: iface.name.clone(),
                    description: String::new(),
                    index: iface.index.unwrap_or(0),
                    ipv4: None,
                    is_loopback: iface.is_loopback(),
                    is_up: true,
                    is_virtual: name_looks_virtual(&iface.name),
                    is_vpn: !iface.is_loopback() && name_looks_vpn(&iface.name),
                    is_default_route: false,
                });
            if entry.ipv4.is_none() {
                if let std::net::IpAddr::V4(v4) = iface.ip() {
                    entry.ipv4 = Some(v4.to_string());
                }
            }
            if let Some(idx) = iface.index {
                if entry.index == 0 {
                    entry.index = idx;
                }
            }
        }
        Ok(by_name.into_values().collect())
    }
}
