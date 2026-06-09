import { useEffect, useState } from "react";
import type { NativeMessagingGateway } from "./native/native-messaging-gateway";

export interface PersistenceWarning {
  readonly title: string;
  readonly body: string;
}

export function useRuntimePersistenceStatus(
  gateway: NativeMessagingGateway,
): PersistenceWarning | null {
  const [warning, setWarning] = useState<PersistenceWarning | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const status = await gateway.getNativeRuntimeStatus();
        if (cancelled || !status || status.moss.link_mode === "browser-demo") {
          if (!cancelled) {
            setWarning(null);
          }
          return;
        }
        if (status.persistence.available && status.persistence.encrypted_at_rest) {
          setWarning(null);
          return;
        }
        const reason = status.persistence.error
          ? ` Reason: ${status.persistence.error}`
          : "";
        setWarning({
          title: "Encrypted history unavailable",
          body: `Messages still send, but private DM history and session continuity may be lost after restart.${reason}`,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        const reason = error instanceof Error ? error.message : String(error);
        setWarning({
          title: "History status unavailable",
          body: `Mosh could not confirm encrypted local history status. Reason: ${reason}`,
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [gateway]);

  return warning;
}
