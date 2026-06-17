import { describe, expect, it } from "vitest";
import { compactDetail } from "./DiagnosticsDrawerHelpers";

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
