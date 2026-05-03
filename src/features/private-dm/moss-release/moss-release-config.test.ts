import { describe, expect, it } from "vitest";

import {
  fetchLatestReleaseVersion,
  pinnedVersion,
  resolveMossVersion,
  writePinnedVersion,
  type MossConfig,
} from "./moss-release-config";

const CONFIG: MossConfig = {
  moss: {
    repository: "redstone-md/moss",
    version: "v0.2.0",
  },
};

describe("Moss release pinning", () => {
  it("uses the pinned version by default", async () => {
    const result = await resolveMossVersion([], CONFIG, async () => "v9.9.9");

    expect(result).toEqual({ version: "v0.2.0", changed: false });
    expect(pinnedVersion(CONFIG)).toBe("v0.2.0");
  });

  it("only resolves latest when explicitly requested", async () => {
    const result = await resolveMossVersion(["--latest"], CONFIG, async () => "v0.3.0");

    expect(result).toEqual({ version: "v0.3.0", changed: true });
  });

  it("serializes an updated pin without changing other config", () => {
    const nextConfig = writePinnedVersion(CONFIG, "v0.3.0");

    expect(nextConfig).toContain('"version": "v0.3.0"');
    expect(nextConfig).toContain('"repository": "redstone-md/moss"');
  });

  it("extracts tag_name from GitHub latest release responses", async () => {
    const fetchLatest = async () =>
      new Response(JSON.stringify({ tag_name: "v0.3.0" }), { status: 200 });

    await expect(
      fetchLatestReleaseVersion("redstone-md/moss", fetchLatest),
    ).resolves.toBe("v0.3.0");
  });
});
