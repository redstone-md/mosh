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
        (iface) => !iface.is_loopback && !iface.is_virtual,
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
    <div className="bind-interface-field">
      <label className="bind-interface-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || physicalInterfaces.length === 0}
          onChange={(event) => {
            if (event.target.checked) {
              void apply(picked || null);
            } else {
              void apply(null);
            }
          }}
        />
        <span>Bypass VPN — bind outbound to a specific NIC</span>
      </label>
      <p className="bind-interface-hint">
        Forces Moss UDP traffic through the selected adapter. ⚠ Your real IP
        becomes visible to peers, trackers, and STUN — only enable if the
        VPN is corporate / split-tunnel, not a privacy VPN.
      </p>
      {physicalInterfaces.length === 0 ? (
        <p className="bind-interface-hint">No physical NIC detected.</p>
      ) : (
        <select
          className="bind-interface-select"
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
              {iface.name}
              {iface.ipv4 ? ` (${iface.ipv4})` : ""}
            </option>
          ))}
        </select>
      )}
      {error ? <p className="bind-interface-error">{error}</p> : null}
    </div>
  );
}

function defaultPick(list: readonly NetworkInterfaceInfo[]): string {
  const candidate = list.find(
    (iface) => !iface.is_loopback && !iface.is_virtual && !!iface.ipv4,
  );
  return candidate?.name ?? "";
}
