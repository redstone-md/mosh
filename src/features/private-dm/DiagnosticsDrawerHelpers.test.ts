import { describe, expect, it } from "vitest";
import { compactDetail, pathLabel } from "./DiagnosticsDrawerHelpers";

describe("pathLabel", () => {
  it("labels relayed with the via-supernode suffix", () => {
    expect(pathLabel("relayed")).toBe("relayed via supernode");
  });

  it("marks a relayed path whose relay has not converged as warming up", () => {
    expect(pathLabel("relayed", false)).toBe("relayed via supernode (warming up)");
    expect(pathLabel("relayed", true)).toBe("relayed via supernode");
    // Missing readiness (relay down / older backend) keeps the plain label.
    expect(pathLabel("relayed", undefined)).toBe("relayed via supernode");
  });

  it("passes direct and connecting through as-is", () => {
    expect(pathLabel("direct")).toBe("direct");
    expect(pathLabel("connecting")).toBe("connecting");
  });

  it("falls back to unknown for empty, passes unrecognized paths through", () => {
    expect(pathLabel("")).toBe("unknown");
    expect(pathLabel("weird")).toBe("weird");
  });
});

describe("compactDetail", () => {
  it("renders flat key=value pairs", () => {
    expect(compactDetail(JSON.stringify({ a: 1, b: "x" }))).toBe("a=1 b=x");
  });

  it("serializes nested objects instead of [object Object]", () => {
    expect(compactDetail(JSON.stringify({ peer: { id: 7 } }))).toBe('peer={"id":7}');
  });

  it("serializes array values", () => {
    expect(compactDetail(JSON.stringify({ ports: [1, 2] }))).toBe("ports=[1,2]");
  });

  it("returns the raw string when the detail is not JSON", () => {
    expect(compactDetail("plain text")).toBe("plain text");
  });

  it("returns empty for empty input", () => {
    expect(compactDetail("")).toBe("");
  });
});
