import { IconCheck, IconPlugConnected, IconShieldLock } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  NativeMessagingGateway,
  NetworkInterfaceInfo,
} from "../native/native-messaging-gateway";
import { adapterLabel, bypassCandidates, defaultBypassAdapter } from "./bypass-adapter";

interface Props {
  readonly gateway: NativeMessagingGateway;
}

/**
 * Changes the VPN-bypass answer after the fact, for the Advanced section.
 *
 * Writes the same stored answer the startup question does, so the two cannot
 * disagree, and relaunches: a node's bind is fixed when the node is built, so
 * nothing already running would pick the change up otherwise.
 */
export function BindInterfaceField({ gateway }: Props) {
  const [interfaces, setInterfaces] = useState<readonly NetworkInterfaceInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, bind] = await Promise.all([
        gateway.listNetworkInterfaces(),
        gateway.getBindInterface(),
      ]);
      setInterfaces(list);
      setCurrent(bind);
      setPicked((existing) => existing || bind || defaultBypassAdapter(list));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read network state");
    }
  }, [gateway]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const physicalInterfaces = useMemo(() => bypassCandidates(interfaces), [interfaces]);

  const enabled = current !== null && current !== "";

  const apply = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await gateway.setVpnBypassConsent(value);
      await gateway.restartApp();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply override");
      setBusy(false);
    }
  };

  return (
    <div className={`bind-interface-field${enabled ? " bind-interface-on" : ""}`}>
      <div className="bind-interface-head">
        <span className="bind-interface-icon" aria-hidden="true">
          {enabled ? <IconShieldLock size={15} /> : <IconPlugConnected size={15} />}
        </span>
        <div>
          <strong>Network adapter</strong>
          <p>
            {enabled
              ? `Moss is bound to ${current}.`
              : "Use a physical NIC when a VPN blocks peer discovery."}
          </p>
        </div>
      </div>
      {physicalInterfaces.length === 0 ? (
        <p className="bind-interface-hint">No connected physical NIC detected.</p>
      ) : (
        <div className="bind-interface-controls">
          <select
            className="bind-interface-select"
            aria-label="Physical network adapter"
            value={picked}
            disabled={busy}
            onChange={(event) => setPicked(event.target.value)}
          >
            {physicalInterfaces.map((iface) => (
              <option key={iface.name} value={iface.name}>
                {adapterLabel(iface)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={enabled ? "btn btn-ghost" : "btn btn-primary"}
            disabled={busy || (!enabled && !picked)}
            onClick={() => void apply(enabled ? null : picked || null)}
          >
            {busy ? "Restarting..." : enabled ? "Release" : "Bind"}
          </button>
        </div>
      )}
      {enabled ? (
        <p className="bind-interface-active">
          <IconCheck size={13} /> Every conversation uses {current}.
        </p>
      ) : null}
      <p className="bind-interface-hint">
        Binding can expose your LAN IP to peers, trackers, and STUN. Mosh
        restarts to apply either choice.
      </p>
      {error ? <p className="bind-interface-error">{error}</p> : null}
    </div>
  );
}
