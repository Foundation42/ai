import { existsSync, unlinkSync, renameSync, chmodSync, writeFileSync } from 'fs';

/**
 * Check if running under systemd
 */
function isRunningUnderSystemd(): boolean {
  // INVOCATION_ID is set by systemd for all services
  return !!process.env.INVOCATION_ID;
}
import { join, dirname } from 'path';

const GITHUB_REPO = 'Foundation42/ai';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface ReleaseInfo {
  version: string;
  tagName: string;
  publishedAt: string;
  assets: {
    name: string;
    downloadUrl: string;
    size: number;
  }[];
  checksums: Record<string, string>;
}

export interface UpgradeResult {
  success: boolean;
  message: string;
  currentVersion?: string;
  latestVersion?: string;
  restarting?: boolean;
}

/**
 * Compare semver versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  // Strip 'v' prefix if present
  const cleanA = a.replace(/^v/, '');
  const cleanB = b.replace(/^v/, '');

  const partsA = cleanA.split(/[-.]/).map(p => parseInt(p) || 0);
  const partsB = cleanB.split(/[-.]/).map(p => parseInt(p) || 0);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

/**
 * Get the appropriate binary name for this platform
 */
export function getBinaryName(): string {
  const arch = process.arch;
  if (arch === 'x64') return 'ai-linux-x64';
  if (arch === 'arm64') return 'ai-linux-arm64';
  throw new Error(`Unsupported architecture: ${arch}`);
}

/**
 * Fetch latest release info from GitHub
 */
export async function getLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(GITHUB_API, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ai-cli-upgrade',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch release: ${response.status}`);
      return null;
    }

    const data = await response.json() as {
      tag_name: string;
      published_at: string;
      assets: Array<{
        name: string;
        browser_download_url: string;
        size: number;
      }>;
    };

    // Parse checksums from the checksums.txt asset
    let checksums: Record<string, string> = {};
    const checksumAsset = data.assets.find(a => a.name === 'checksums.txt');
    if (checksumAsset) {
      try {
        const checksumResponse = await fetch(checksumAsset.browser_download_url);
        const checksumText = await checksumResponse.text();
        for (const line of checksumText.split('\n')) {
          const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
          if (match) {
            checksums[match[2]!] = match[1]!;
          }
        }
      } catch (e) {
        console.error('Failed to fetch checksums:', e);
      }
    }

    return {
      version: data.tag_name.replace(/^v/, ''),
      tagName: data.tag_name,
      publishedAt: data.published_at,
      assets: data.assets
        .filter(a => a.name !== 'checksums.txt')
        .map(a => ({
          name: a.name,
          downloadUrl: a.browser_download_url,
          size: a.size,
        })),
      checksums,
    };
  } catch (err) {
    console.error('Failed to check for updates:', err);
    return null;
  }
}

/**
 * Download a file and return its contents as a buffer
 */
async function downloadFile(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ai-cli-upgrade' },
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Calculate SHA256 hash of a buffer
 */
async function sha256(buffer: Buffer): Promise<string> {
  // Convert Buffer to ArrayBuffer for crypto.subtle.digest compatibility
  // slice() always returns a new ArrayBuffer (not SharedArrayBuffer)
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get the path to the current executable
 */
export function getCurrentBinaryPath(): string {
  // For compiled Bun binaries, Bun.argv[0] should be the executable path
  // Fall back to common install locations
  const bunPath = typeof Bun !== 'undefined' ? Bun.argv[0] : undefined;
  if (bunPath && bunPath.includes('/ai')) {
    return bunPath;
  }
  // Default to standard install location
  return '/usr/local/bin/ai';
}

/**
 * Check if an upgrade is available
 */
export async function checkForUpgrade(currentVersion: string): Promise<{
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  release?: ReleaseInfo;
}> {
  const release = await getLatestRelease();

  if (!release) {
    return { available: false, currentVersion };
  }

  const comparison = compareVersions(currentVersion, release.version);

  return {
    available: comparison < 0,
    currentVersion,
    latestVersion: release.version,
    release: comparison < 0 ? release : undefined,
  };
}

/**
 * Perform the upgrade
 */
export async function performUpgrade(
  currentVersion: string,
  options: { restart?: boolean } = {}
): Promise<UpgradeResult> {
  const { restart = true } = options;

  // Check for upgrade
  const check = await checkForUpgrade(currentVersion);

  if (!check.available || !check.release) {
    return {
      success: true,
      message: check.latestVersion
        ? `Already at latest version (${currentVersion})`
        : 'Could not check for updates',
      currentVersion,
      latestVersion: check.latestVersion,
    };
  }

  const release = check.release;
  const binaryName = getBinaryName();
  const asset = release.assets.find(a => a.name === binaryName);

  if (!asset) {
    return {
      success: false,
      message: `No binary available for this architecture (${binaryName})`,
      currentVersion,
      latestVersion: release.version,
    };
  }

  console.log(`Downloading ${binaryName} v${release.version}...`);

  // Download the new binary
  let newBinary: Buffer;
  try {
    newBinary = await downloadFile(asset.downloadUrl);
  } catch (err) {
    return {
      success: false,
      message: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
      currentVersion,
      latestVersion: release.version,
    };
  }

  // Verify checksum
  const expectedChecksum = release.checksums[binaryName];
  if (expectedChecksum) {
    const actualChecksum = await sha256(newBinary);
    if (actualChecksum !== expectedChecksum) {
      return {
        success: false,
        message: `Checksum mismatch! Expected ${expectedChecksum}, got ${actualChecksum}`,
        currentVersion,
        latestVersion: release.version,
      };
    }
    console.log('Checksum verified.');
  } else {
    console.log('Warning: No checksum available for verification.');
  }

  // Get paths
  const currentPath = getCurrentBinaryPath();
  const backupPath = `${currentPath}.old`;
  const tempPath = `${currentPath}.new`;

  console.log(`Installing to ${currentPath}...`);

  try {
    // Write new binary to temp location
    await Bun.write(tempPath, newBinary);
    chmodSync(tempPath, 0o755);

    // Backup current binary
    if (existsSync(currentPath)) {
      if (existsSync(backupPath)) {
        unlinkSync(backupPath);
      }
      renameSync(currentPath, backupPath);
    }

    // Move new binary into place
    renameSync(tempPath, currentPath);

    console.log(`Upgraded from v${currentVersion} to v${release.version}`);

    if (restart) {
      // If running under systemd, just exit - systemd will restart us with the new binary
      if (isRunningUnderSystemd()) {
        console.log('Running under systemd, exiting for restart...');
        return {
          success: true,
          message: `Upgraded to v${release.version}, systemd will restart...`,
          currentVersion,
          latestVersion: release.version,
          restarting: true,
        };
      }

      // Not under systemd - use manual restart script
      console.log('Restarting...');

      const pid = process.pid;
      const args = process.argv.slice(1).map(a => `"${a}"`).join(' ');
      const restartScript = `/tmp/ai-restart-${pid}.sh`;

      // Script waits for old process to exit, then starts new binary with same args
      const script = `#!/bin/bash

# Wait for old process to exit (max 30 seconds)
for i in {1..30}; do
  if ! kill -0 ${pid} 2>/dev/null; then
    break
  fi
  sleep 1
done

# Small delay to ensure port is released
sleep 1

# Start new process with nohup to ensure it survives
nohup ${currentPath} ${args} > /var/log/ai.log 2>&1 &

# Clean up this script
rm -f "${restartScript}"
`;

      writeFileSync(restartScript, script, { mode: 0o755 });

      // Spawn the restart script detached
      const child = Bun.spawn(['bash', restartScript], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      });
      child.unref();

      return {
        success: true,
        message: `Upgraded to v${release.version}, restarting...`,
        currentVersion,
        latestVersion: release.version,
        restarting: true,
      };
    }

    return {
      success: true,
      message: `Upgraded from v${currentVersion} to v${release.version}`,
      currentVersion,
      latestVersion: release.version,
    };
  } catch (err) {
    // Try to restore backup on failure
    try {
      if (existsSync(backupPath) && !existsSync(currentPath)) {
        renameSync(backupPath, currentPath);
      }
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Ignore restore errors
    }

    return {
      success: false,
      message: `Installation failed: ${err instanceof Error ? err.message : String(err)}`,
      currentVersion,
      latestVersion: release.version,
    };
  }
}
