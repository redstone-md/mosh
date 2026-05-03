const CONFIG_PATH = "moss.config.json";
const LATEST_FLAG = "--latest";
const GITHUB_API_BASE = "https://api.github.com/repos";

export interface MossConfig {
  readonly moss: {
    readonly repository: string;
    readonly version: string;
  };
}

export interface MossVersionResult {
  readonly version: string;
  readonly changed: boolean;
}

export async function readMossConfig(
  readText: (path: string) => Promise<string>,
): Promise<MossConfig> {
  return JSON.parse(await readText(CONFIG_PATH)) as MossConfig;
}

export function pinnedVersion(config: MossConfig): string {
  return config.moss.version;
}

export async function resolveMossVersion(
  args: readonly string[],
  config: MossConfig,
  fetchLatest: (repository: string) => Promise<string>,
): Promise<MossVersionResult> {
  if (!args.includes(LATEST_FLAG)) {
    return { version: pinnedVersion(config), changed: false };
  }

  const version = await fetchLatest(config.moss.repository);
  return { version, changed: version !== pinnedVersion(config) };
}

export async function fetchLatestReleaseVersion(
  repository: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${GITHUB_API_BASE}/${repository}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    throw new Error(`GitHub release lookup failed: ${response.status}`);
  }

  const release = (await response.json()) as { tag_name?: string };
  if (!release.tag_name) {
    throw new Error("GitHub release response missing tag_name");
  }

  return release.tag_name;
}

export function writePinnedVersion(config: MossConfig, version: string): string {
  const nextConfig: MossConfig = {
    ...config,
    moss: { ...config.moss, version },
  };

  return `${JSON.stringify(nextConfig, null, 2)}\n`;
}
