import { IconAlertTriangle, IconCheck, IconShieldLock } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  NativeMessagingGateway,
  NetworkInterfaceInfo,
  VpnDetection,
} from "../native/native-messaging-gateway";

interface Props {
  readonly gateway: NativeMessagingGateway;
}

type Phase = "loading" | "ready" | "applying";

export function VpnBanner({ gateway }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [detection, setDetection] = useState<VpnDetection | null>(null);
  const [interfaces, setInterfaces] = useState<readonly NetworkInterfaceInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [picked, setPicked] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [det, list, bind] = await Promise.all([
        gateway.detectVpn(),
        gateway.listNetworkInterfaces(),
        gateway.getBindInterface(),
      ]);
      setDetection(det);
      setInterfaces(list);
      setCurrent(bind);
      setPicked((existing) => (existing ? existing : bind ?? defaultPick(list)));
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read network state");
      setPhase("ready");
    }
  }, [gateway]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const physicalInterfaces = useMemo(
    () =>
      interfaces.filter(
        (iface) => !iface.is_loopback && !iface.is_virtual_guess,
      ),
    [interfaces],
  );

  if (phase === "loading") {
    return null;
  }
  if (dismissed) {
    return null;
  }
  // No VPN detected and no override active — nothing to surface.
  if (!detection?.vpn_likely && !current) {
    return null;
  }

  const apply = async (value: string | null) => {
    setPhase("applying");
    setError(null);
    try {
      await gateway.setBindInterface(value);
      const next = await gateway.getBindInterface();
      setCurrent(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply override");
    } finally {
      setPhase("ready");
    }
  };

  return (
    <div className="vpn-banner" role="status" aria-live="polite">
      <div className="vpn-banner-icon">
        {current ? <IconShieldLock size={22} /> : <IconAlertTriangle size={22} />}
      </div>
      <div className="vpn-banner-body">
        <strong>
          {current
            ? "Direct interface bypass active"
            : "VPN tunnel may interfere with peer discovery"}
        </strong>
        {detection?.vpn_likely ? (
          <p className="vpn-banner-detail">
            Detected virtual adapter(s): {detection.suspect_interfaces.join(", ") || "—"}.
            Outgoing peer traffic might be tunneled and broken at NAT.
          </p>
        ) : null}
        {current ? (
          <p className="vpn-banner-detail vpn-banner-warning">
            ⚠ Real LAN IP is now exposed to peers, trackers, and STUN. Turn this
            off if you rely on the VPN for anonymity.
          </p>
        ) : (
          <p className="vpn-banner-detail vpn-banner-warning">
            Bypassing the VPN exposes your real IP to peers, trackers, and
            STUN — choose this only if the VPN is corporate / split-tunnel,
            not a privacy VPN.
          </p>
        )}

        <div className="vpn-banner-actions">
          {physicalInterfaces.length > 0 ? (
            <select
              className="vpn-banner-select"
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
              disabled={phase === "applying"}
            >
              {physicalInterfaces.map((iface) => (
                <option key={iface.name} value={iface.name}>
                  {iface.name}
                  {iface.ipv4 ? ` (${iface.ipv4})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="vpn-banner-detail">
              No physical NIC discovered.
            </span>
          )}
          {current ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void apply(null)}
              disabled={phase === "applying"}
            >
              Turn off bypass
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void apply(picked || null)}
              disabled={phase === "applying" || !picked}
            >
              {phase === "applying" ? "Applying…" : "Bypass VPN"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
        {current ? (
          <p className="vpn-banner-detail vpn-banner-active">
            <IconCheck size={14} /> Bound to <code>{current}</code>. Restart
            existing sessions to apply.
          </p>
        ) : null}
        {error ? <p className="vpn-banner-error">{error}</p> : null}
      </div>
    </div>
  );
}

function defaultPick(list: readonly NetworkInterfaceInfo[]): string {
  const candidate = list.find(
    (iface) => !iface.is_loopback && !iface.is_virtual_guess && !!iface.ipv4,
  );
  return candidate?.name ?? "";
}
