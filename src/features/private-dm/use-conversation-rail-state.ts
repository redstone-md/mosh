import { useCallback, useEffect, useState } from "react";

const MOBILE_RAIL_QUERY = "(max-width: 580px)";

export function useConversationRailState() {
  const [expanded, setExpanded] = useState(false);
  const [overlay, setOverlay] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(MOBILE_RAIL_QUERY);
    const sync = () => {
      setOverlay(query.matches);
      if (query.matches) {
        setExpanded(false);
      }
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const toggle = useCallback(() => setExpanded((open) => !open), []);

  const closeAfterMobileAction = useCallback(() => {
    if (overlay) {
      setExpanded(false);
    }
  }, [overlay]);

  return {
    expanded,
    toggle,
    closeAfterMobileAction,
  };
}
