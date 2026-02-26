/**
 * Excel Parser Service — Parses uploaded .xlsx files into game input rows.
 * Expected columns: Game URL, Game Name, Features (comma-separated).
 */

import * as XLSX from 'xlsx';
import { ExcelGameRow } from '../types/dashboard-types';

function extractNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const slug = pathname.split('/').filter(Boolean).pop() || 'unknown-game';
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch {
    return 'Unknown Game';
  }
}

function extractIdFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').filter(Boolean).pop() || 'unknown-game';
  } catch {
    return 'unknown-game';
  }
}

export function parseExcelFile(filePath: string): ExcelGameRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sheet);

  return rows
    .map((row: any) => {
      const keys = Object.keys(row);
      const url = (row['Game URL'] || row['URL'] || row['url'] || row[keys[0]] || '').toString().trim();
      if (!url) return null;

      const name = (row['Game Name'] || row['Name'] || row['name'] || row[keys[1]] || '').toString().trim()
        || extractNameFromUrl(url);
      const featuresRaw = (row['Features'] || row['features'] || row[keys[2]] || '').toString().trim();

      const ALL_FEATURES = ['login', 'lobbyNavigation', 'gameLaunch', 'betAdjustment', 'spin'];
      let features: string[];

      if (!featuresRaw || featuresRaw.toLowerCase() === 'all') {
        features = ALL_FEATURES;
      } else {
        features = featuresRaw.split(',').map((f: string) => f.trim().toLowerCase()).filter(Boolean);
      }

      return { url, name, features };
    })
    .filter(Boolean) as ExcelGameRow[];
}

export function excelRowToGameInput(row: ExcelGameRow) {
  const id = row.url ? extractIdFromUrl(row.url) : row.name.toLowerCase().replace(/\s+/g, '-');
  const featureMap: Record<string, boolean> = {
    login: row.features.includes('login'),
    lobbyNavigation: row.features.includes('lobbynavigation') || row.features.includes('lobby'),
    gameLaunch: row.features.includes('gamelaunch') || row.features.includes('launch'),
    betAdjustment: row.features.includes('betadjustment') || row.features.includes('bet'),
    spin: row.features.includes('spin'),
  };

  return {
    url: row.url,
    name: row.name,
    id,
    category: 'slots',
    provider: 'Unknown',
    features: featureMap as any,
  };
}
