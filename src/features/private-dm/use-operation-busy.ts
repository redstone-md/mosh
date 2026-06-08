import { useCallback, useState } from "react";

export type OperationKind =
  | "refresh"
  | "setup"
  | "message"
  | "transfer"
  | "session"
  | "offer";

export type OperationCounts = Readonly<Record<OperationKind, number>>;

const emptyCounts: OperationCounts = {
  refresh: 0,
  setup: 0,
  message: 0,
  transfer: 0,
  session: 0,
  offer: 0,
};

export function useOperationBusy() {
  const [counts, setCounts] = useState<OperationCounts>(emptyCounts);

  const increment = useCallback((kind: OperationKind) => {
    setCounts((current) => ({
      ...current,
      [kind]: current[kind] + 1,
    }));
  }, []);

  const decrement = useCallback((kind: OperationKind) => {
    setCounts((current) => ({
      ...current,
      [kind]: Math.max(0, current[kind] - 1),
    }));
  }, []);

  const runOperation = useCallback(
    async <T>(kind: OperationKind, action: () => Promise<T>): Promise<T> => {
      increment(kind);
      try {
        return await action();
      } finally {
        decrement(kind);
      }
    },
    [decrement, increment],
  );

  return { counts, runOperation };
}
