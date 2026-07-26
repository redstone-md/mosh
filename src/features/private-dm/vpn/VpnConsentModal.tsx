import { IconAlertTriangle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { NativeMessagingGateway } from "../native/native-messaging-gateway";
import { defaultBypassAdapter } from "./bypass-adapter";

interface Props {
  readonly gateway: NativeMessagingGateway;
}

type Answer = "asking" | "saving";

/**
 * The one question Mosh asks about the VPN.
 *
 * It blocks because the answer cannot be applied later: a node's bind
 * interface is fixed when the node is built, so a setting flipped mid-session
 * changes nothing until the next launch. Saying yes therefore relaunches.
 *
 * Only "yes" is remembered. A refusal is asked again next launch — a wrong yes
 * is visible and reversible from advanced settings, a remembered no silently
 * strands someone whose network changed.
 */
export function VpnConsentModal({ gateway }: Props) {
  const [adapter, setAdapter] = useState<string | null>(null);
  const [phase, setPhase] = useState<Answer>("asking");
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [consent, detection, interfaces] = await Promise.all([
          gateway.getVpnBypassConsent(),
          gateway.detectVpn(),
          gateway.listNetworkInterfaces(),
        ]);
        // Only ask when the tunnel actually carries our traffic. A VPN adapter
        // that exists but does not own the default route is not intercepting
        // anything, and interrupting for it would be a lie.
        if (cancelled || consent || !detection.vpn_owns_default_route) {
          return;
        }
        const pick = defaultBypassAdapter(interfaces);
        if (pick) {
          setAdapter(pick);
        }
      } catch (err) {
        // A network inventory we cannot read is not grounds for a blocking
        // modal; the app opens and advanced settings still work.
        if (!cancelled) {
          console.warn("vpn consent: could not read network state", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  if (!adapter || answered) {
    return null;
  }

  const accept = async () => {
    setPhase("saving");
    setError(null);
    try {
      await gateway.setVpnBypassConsent(adapter);
      await gateway.restartApp();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your answer");
      setPhase("asking");
    }
  };

  const decline = async () => {
    setPhase("saving");
    try {
      await gateway.setVpnBypassConsent(null);
    } catch (err) {
      console.warn("vpn consent: could not clear a previous answer", err);
    } finally {
      setAnswered(true);
    }
  };

  return (
    <div className="vpn-consent-scrim" role="presentation">
      <div
        className="vpn-consent"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="vpn-consent-title"
        aria-describedby="vpn-consent-body"
      >
        <span className="vpn-consent-icon" aria-hidden="true">
          <IconAlertTriangle size={22} />
        </span>
        <h2 id="vpn-consent-title">A VPN is carrying Mosh's traffic</h2>
        <p id="vpn-consent-body">
          Everything Mosh sends goes through your VPN, which stops other people
          from finding you. Mosh can use <code>{adapter}</code> instead.
        </p>
        <p className="vpn-consent-caveat">
          Peers will see your real network address rather than the VPN's. Mosh
          restarts to apply this, and you can change it later under Advanced.
        </p>
        {error ? <p className="vpn-consent-error">{error}</p> : null}
        <div className="vpn-consent-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={phase === "saving"}
            onClick={() => void decline()}
          >
            Keep using the VPN
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={phase === "saving"}
            onClick={() => void accept()}
          >
            {phase === "saving" ? "Restarting..." : "Route around the VPN"}
          </button>
        </div>
      </div>
    </div>
  );
}
