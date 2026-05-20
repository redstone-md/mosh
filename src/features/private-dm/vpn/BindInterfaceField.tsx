import { IconCheck, IconPlugConnected, IconShieldLock } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  NativeMessagingGateway,
  NetworkInterfaceInfo,
} from "../native/native-messaging-gateway";

interface Props {
  readonly gateway: NativeMessagingGateway;
}

/**
 * Manual VPN-bypass toggle for the Advanced section. Reads/writes the
 * app-wide bind interface via Tauri commands. Independent of the auto
 * detection banner — the user can flip this even when no VPN was flagged.
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
      setPicked((existing) => existing || bind || defaultPick(list));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read network state");
    }
  }, [gateway]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const physicalInterfaces = useMemo(
    () =>
      interfaces.filter(
        (iface) => iface.is_up && !iface.is_loopback && !iface.is_virtual,
      ),
    [interfaces],
  );

  const enabled = current !== null && current !== "";

  const apply = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await gateway.setBindInterface(value);
      const next = await gateway.getBindInterface();
      setCurrent(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply override");
    } finally {
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
            onChange={(event) => {
              const next = event.target.value;
              setPicked(next);
              if (enabled) {
                void apply(next);
              }
            }}
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
            {enabled ? "Release" : "Bind"}
          </button>
        </div>
      )}
      {enabled ? (
        <p className="bind-interface-active">
          <IconCheck size={13} /> New sessions use the selected adapter.
        </p>
      ) : null}
      <p className="bind-interface-hint">
        Binding can expose your LAN IP to peers, trackers, and STUN.
      </p>
      {error ? <p className="bind-interface-error">{error}</p> : null}
    </div>
  );
}

function defaultPick(list: readonly NetworkInterfaceInfo[]): string {
  const candidate = list.find(
    (iface) => iface.is_up && !iface.is_loopback && !iface.is_virtual && !!iface.ipv4,
  );
  return candidate?.name ?? "";
}

function adapterLabel(iface: NetworkInterfaceInfo): string {
  const address = iface.ipv4 ? ` - ${iface.ipv4}` : "";
  return `${iface.name}${address}`;
}
