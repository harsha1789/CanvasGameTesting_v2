/**
 * HAR File Service — Lists and inspects HAR files on disk.
 */

import * as fs from 'fs';
import * as path from 'path';
import { HarFileInfo } from '../types/dashboard-types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function listHarFiles(harDir: string, gameNameMap?: Record<string, string>): HarFileInfo[] {
  if (!fs.existsSync(harDir)) return [];

  const files = fs.readdirSync(harDir).filter(f => f.endsWith('.har'));
  return files.map(f => {
    const fullPath = path.join(harDir, f);
    const stats = fs.statSync(fullPath);
    const gameId = f.replace('.har', '');
    const displayName = gameNameMap?.[gameId]
      || gameId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    let entryCount = 0;
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const har = JSON.parse(content);
      entryCount = har.log?.entries?.length || 0;
    } catch { /* ignore */ }

    return {
      gameId,
      gameName: displayName,
      filePath: fullPath,
      fileSizeBytes: stats.size,
      fileSizeFormatted: formatBytes(stats.size),
      entryCount,
      recordedAt: stats.mtime.toISOString(),
    };
  }).sort((a, b) => a.gameName.localeCompare(b.gameName));
}
