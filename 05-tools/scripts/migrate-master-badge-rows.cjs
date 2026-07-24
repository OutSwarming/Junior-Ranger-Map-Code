#!/usr/bin/env node
'use strict';

/*
 * Adds human-editable badge rows to the Junior Ranger Master Spreadsheet.
 *
 * Default mode is dry-run. Write mode requires either GOOGLE_SHEETS_ACCESS_TOKEN
 * or Google Application Default Credentials / GOOGLE_APPLICATION_CREDENTIALS
 * with Sheets edit access to the target spreadsheet.
 *
 * The script does not delete rows. It inserts new badge rows beneath each
 * coordinate-backed park row and reuses existing "Badges:" blocks when present.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SPREADSHEET_ID = '1Twoq7MNwqGn49d9t2phdDThB5ufT1H2PqY9fmcZrs_8';
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, '01-code/app/assets/data/badge-manifest.json');
const DEFAULT_DRIVE_FILES_PATH = path.join(REPO_ROOT, '05-tools/reports/jr-rewards-drive-files.json');
const HOSTED_BADGE_BASE_URL = 'https://junior-ranger-map-auth.web.app/';

const US_STATE_SHEETS = [
  { title: 'Alabama', sheetId: 1709057022 },
  { title: 'Alaska', sheetId: 1569651317 },
  { title: 'Arizona', sheetId: 1584799557 },
  { title: 'Arkansas', sheetId: 274969284 },
  { title: 'California', sheetId: 1989920118 },
  { title: 'Colorado', sheetId: 1793623063 },
  { title: 'Connecticut', sheetId: 239039583 },
  { title: 'Delaware', sheetId: 545147740 },
  { title: 'Florida', sheetId: 198722329 },
  { title: 'Georgia', sheetId: 1301356157 },
  { title: 'Hawaii', sheetId: 2107313638 },
  { title: 'Idaho', sheetId: 128542920 },
  { title: 'Illinois', sheetId: 1089263012 },
  { title: 'Indiana', sheetId: 1172583568 },
  { title: 'Iowa', sheetId: 249885131 },
  { title: 'Kansas', sheetId: 1167309788 },
  { title: 'Kentucky', sheetId: 2077663334 },
  { title: 'Louisiana', sheetId: 209658896 },
  { title: 'Maine', sheetId: 868267600 },
  { title: 'Maryland', sheetId: 1185725347 },
  { title: 'Massachusetts', sheetId: 371804125 },
  { title: 'Michigan', sheetId: 25314295 },
  { title: 'Minnesota', sheetId: 1057407769 },
  { title: 'Mississippi', sheetId: 609679070 },
  { title: 'Missouri', sheetId: 1430753391 },
  { title: 'Montana', sheetId: 537388606 },
  { title: 'Nebraska', sheetId: 848134020 },
  { title: 'Nevada', sheetId: 382044178 },
  { title: 'New Hampshire', sheetId: 891101089 },
  { title: 'New Jersey', sheetId: 776060538 },
  { title: 'New Mexico', sheetId: 482267978 },
  { title: 'New York', sheetId: 667420887 },
  { title: 'North Carolina', sheetId: 1005419548 },
  { title: 'North Dakota', sheetId: 539265742 },
  { title: 'Ohio', sheetId: 1114231799 },
  { title: 'Oklahoma', sheetId: 197408452 },
  { title: 'Oregon', sheetId: 2081342437 },
  { title: 'Pennsylvania', sheetId: 184298442 },
  { title: 'Rhode Island', sheetId: 265784729 },
  { title: 'South Carolina', sheetId: 1633534857 },
  { title: 'South Dakota', sheetId: 1430521190 },
  { title: 'Tennessee', sheetId: 241689207 },
  { title: 'Texas', sheetId: 1138194344 },
  { title: 'Utah', sheetId: 1089526942 },
  { title: 'Vermont', sheetId: 2010359409 },
  { title: 'Virginia', sheetId: 2076300975 },
  { title: 'Washington', sheetId: 1170493812 },
  { title: 'West Virginia', sheetId: 1833067973 },
  { title: 'Wisconsin', sheetId: 1793092989 },
  { title: 'Wyoming', sheetId: 0 }
];

function parseArgs(argv) {
  const options = {
    spreadsheetId: DEFAULT_SPREADSHEET_ID,
    manifestPath: DEFAULT_MANIFEST_PATH,
    driveFilesPath: '',
    requestsOutPath: '',
    write: false,
    states: null,
    chunkSize: 450,
    limitStates: 0
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      options.write = true;
    } else if (arg === '--spreadsheet-id') {
      options.spreadsheetId = argv[++index];
    } else if (arg === '--manifest') {
      options.manifestPath = path.resolve(argv[++index]);
    } else if (arg === '--drive-files') {
      options.driveFilesPath = path.resolve(argv[++index]);
    } else if (arg === '--requests-out') {
      options.requestsOutPath = path.resolve(argv[++index]);
    } else if (arg === '--states') {
      options.states = argv[++index].split(',').map(value => value.trim()).filter(Boolean);
    } else if (arg === '--chunk-size') {
      options.chunkSize = Number(argv[++index]);
    } else if (arg === '--limit-states') {
      options.limitStates = Number(argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.chunkSize) || options.chunkSize < 1) {
    throw new Error('--chunk-size must be a positive number');
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node 05-tools/scripts/migrate-master-badge-rows.cjs [options]

Options:
  --write                 Apply the generated Sheets batchUpdate requests.
  --spreadsheet-id ID     Override the Master spreadsheet ID.
  --manifest PATH         Override badge-manifest.json path.
  --drive-files PATH      Use an individual Drive upload manifest for badge links.
  --requests-out PATH     Write generated Sheets API requests to a JSON file.
  --states A,B,C          Limit to comma-separated state tab names.
  --limit-states N        Dry-run or write only the first N selected states.
  --chunk-size N          Max Sheets API requests per batchUpdate call.
  -h, --help              Show this help.
`);
}

function getCell(row, index) {
  return row && row[index] !== undefined && row[index] !== null ? String(row[index]).trim() : '';
}

function isFiniteCoordinate(value) {
  if (!String(value || '').trim()) return false;
  return Number.isFinite(Number(value));
}

function normalizeBadgeHeader(value) {
  return String(value || '').trim().replace(/:\s*$/, '').toLowerCase();
}

function isBadgeHeader(value) {
  return normalizeBadgeHeader(value) === 'badges';
}

function isBadgeItem(value) {
  const text = String(value || '').trim();
  return /^\([^)]+\)$/.test(text) || /^\s+\([^)]+\)$/.test(String(value || ''));
}

function escapeFormulaText(value) {
  return String(value || '').replace(/"/g, '""');
}

function cleanBadgeLabel(value, fallback) {
  const cleaned = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*\(|\)\s*$/g, '')
    .trim();
  return cleaned || fallback;
}

function getBadgeAssetHash(rawUrl) {
  const match = String(rawUrl || '').match(/\/?assets\/badges\/jr-rewards\/([a-f0-9]{10})\.webp(?:[?#].*)?$/i);
  return match ? match[1].toLowerCase() : '';
}

function hostedBadgeUrl(rawUrl, driveFilesByHash) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  const assetHash = getBadgeAssetHash(url);
  if (assetHash && driveFilesByHash && driveFilesByHash[assetHash] && driveFilesByHash[assetHash].viewUrl) {
    return driveFilesByHash[assetHash].viewUrl;
  }
  if (/^https?:\/\//i.test(url)) return url;
  return `${HOSTED_BADGE_BASE_URL}${url.replace(/^\/+/, '')}`;
}

function badgeFormula(label, url) {
  return `=HYPERLINK("${escapeFormulaText(url)}","     (${escapeFormulaText(label)})")`;
}

function getBadgeRowsForSite(siteId, badgesByPinId, driveFilesByHash) {
  const seenUrls = new Set();
  const rows = ['Badges:'];
  const badges = Array.isArray(badgesByPinId[siteId]) ? badgesByPinId[siteId] : [];

  badges.forEach((badge, index) => {
    const rawUrl = badge.imageUrl || badge.url || badge.thumbnailUrl || '';
    const url = hostedBadgeUrl(rawUrl, driveFilesByHash);
    if (!url || seenUrls.has(url.toLowerCase())) return;

    seenUrls.add(url.toLowerCase());
    const label = cleanBadgeLabel(badge.title, `Badge ${index + 1}`);
    rows.push(badgeFormula(label, url));
  });

  if (rows.length === 1) rows.push('     (no reward)');
  return rows;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (char !== '\r') {
      value += char;
    }
  }

  row.push(value);
  rows.push(row);
  while (rows.length && rows[rows.length - 1].every(cell => !String(cell || '').trim())) rows.pop();
  return rows;
}

async function fetchSheetRows(spreadsheetId, title) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(title)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${title}: ${response.status} ${response.statusText}`);
  }
  return parseCsv(await response.text());
}

function findParkRows(rows) {
  const parks = [];
  rows.forEach((row, index) => {
    const siteName = getCell(row, 2);
    const latitude = getCell(row, 5);
    const longitude = getCell(row, 6);
    const siteId = getCell(row, 7);

    if (siteName && siteId && isFiniteCoordinate(latitude) && isFiniteCoordinate(longitude)) {
      parks.push({ rowIndex: index, siteName, siteId });
    }
  });
  return parks;
}

function getExistingBadgeBlock(rows, park, nextParkRowIndex) {
  let badgeHeaderIndex = -1;
  for (let index = park.rowIndex + 1; index < nextParkRowIndex; index += 1) {
    if (isBadgeHeader(getCell(rows[index], 3))) {
      badgeHeaderIndex = index;
      break;
    }
  }

  if (badgeHeaderIndex < 0) return null;

  let endIndex = badgeHeaderIndex + 1;
  while (endIndex < nextParkRowIndex && isBadgeItem(getCell(rows[endIndex], 3))) {
    endIndex += 1;
  }

  return {
    headerRowIndex: badgeHeaderIndex,
    itemStartIndex: badgeHeaderIndex + 1,
    endIndex
  };
}

function tsvForColumnD(lines) {
  return lines.map(value => `\t\t\t${value}`).join('\n');
}

function makeInsertAndPasteRequests(sheetId, startIndex, lines) {
  return [
    {
      insertDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex,
          endIndex: startIndex + lines.length
        },
        inheritFromBefore: startIndex > 0
      }
    },
    {
      pasteData: {
        coordinate: {
          sheetId,
          rowIndex: startIndex,
          columnIndex: 0
        },
        data: tsvForColumnD(lines),
        type: 'PASTE_NORMAL',
        delimiter: '\t'
      }
    }
  ];
}

function makeOverwriteColumnDRequest(sheetId, rowIndex, value) {
  return {
    pasteData: {
      coordinate: {
        sheetId,
        rowIndex,
        columnIndex: 3
      },
      data: value,
      type: 'PASTE_NORMAL',
      delimiter: '\t'
    }
  };
}

function buildStateRequests(sheet, rows, badgesByPinId, driveFilesByHash) {
  const parks = findParkRows(rows);
  const requests = [];
  const stats = {
    sheet: sheet.title,
    parks: parks.length,
    matchedParks: 0,
    existingBlocks: 0,
    insertedRows: 0,
    updatedExistingCells: 0,
    preservedExtraExistingRows: 0
  };

  for (let parkIndex = parks.length - 1; parkIndex >= 0; parkIndex -= 1) {
    const park = parks[parkIndex];
    const nextParkRowIndex = parkIndex + 1 < parks.length ? parks[parkIndex + 1].rowIndex : rows.length;
    const badgeRows = getBadgeRowsForSite(park.siteId, badgesByPinId, driveFilesByHash);
    if (badgeRows.length > 2 || badgeRows[1] !== '     (no reward)') stats.matchedParks += 1;

    const existingBlock = getExistingBadgeBlock(rows, park, nextParkRowIndex);
    if (!existingBlock) {
      stats.insertedRows += badgeRows.length;
      requests.push(...makeInsertAndPasteRequests(sheet.sheetId, nextParkRowIndex, badgeRows));
      continue;
    }

    stats.existingBlocks += 1;
    const existingItemRows = Math.max(0, existingBlock.endIndex - existingBlock.itemStartIndex);
    const desiredItems = badgeRows.slice(1);
    requests.push(makeOverwriteColumnDRequest(sheet.sheetId, existingBlock.headerRowIndex, 'Badges:'));

    desiredItems.slice(0, existingItemRows).forEach((value, offset) => {
      stats.updatedExistingCells += 1;
      requests.push(makeOverwriteColumnDRequest(sheet.sheetId, existingBlock.itemStartIndex + offset, value));
    });

    if (desiredItems.length > existingItemRows) {
      const missingItems = desiredItems.slice(existingItemRows);
      stats.insertedRows += missingItems.length;
      requests.push(...makeInsertAndPasteRequests(sheet.sheetId, existingBlock.endIndex, missingItems));
    } else if (existingItemRows > desiredItems.length) {
      stats.preservedExtraExistingRows += existingItemRows - desiredItems.length;
    }
  }

  return { requests, stats };
}

async function getAuthHeaders() {
  if (process.env.GOOGLE_SHEETS_ACCESS_TOKEN) {
    return {
      Authorization: `Bearer ${process.env.GOOGLE_SHEETS_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    };
  }

  let googleapis;
  try {
    googleapis = require('googleapis');
  } catch (_error) {
    const functionsNodeModules = path.join(REPO_ROOT, '01-code/functions/node_modules');
    require('module').Module._initPaths();
    process.env.NODE_PATH = process.env.NODE_PATH
      ? `${process.env.NODE_PATH}${path.delimiter}${functionsNodeModules}`
      : functionsNodeModules;
    require('module').Module._initPaths();
    googleapis = require('googleapis');
  }

  const auth = new googleapis.google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();
  return {
    ...headers,
    'Content-Type': 'application/json'
  };
}

function loadDriveFilesByHash(driveFilesPath) {
  const selectedPath = driveFilesPath || (fs.existsSync(DEFAULT_DRIVE_FILES_PATH) ? DEFAULT_DRIVE_FILES_PATH : '');
  if (!selectedPath) return {};
  const payload = JSON.parse(fs.readFileSync(selectedPath, 'utf8'));
  const files = Array.isArray(payload.files) ? payload.files : [];
  const byHash = {};
  files.forEach(file => {
    const hash = String(file.hash || '').toLowerCase();
    if (!hash || !file.viewUrl) return;
    byHash[hash] = file;
  });
  return byHash;
}

async function applyRequests(spreadsheetId, requests, chunkSize) {
  const headers = await getAuthHeaders();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;

  for (let start = 0; start < requests.length; start += chunkSize) {
    const chunk = requests.slice(start, start + chunkSize);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requests: chunk,
        includeSpreadsheetInResponse: false
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Sheets batchUpdate failed at request ${start + 1}: ${response.status} ${body}`);
    }
    console.log(`Applied requests ${start + 1}-${start + chunk.length} of ${requests.length}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const selectedStateNames = new Set(options.states || US_STATE_SHEETS.map(sheet => sheet.title));
  let selectedSheets = US_STATE_SHEETS.filter(sheet => selectedStateNames.has(sheet.title));
  if (options.limitStates > 0) selectedSheets = selectedSheets.slice(0, options.limitStates);

  if (!selectedSheets.length) {
    throw new Error('No matching state sheets selected.');
  }

  const manifest = JSON.parse(fs.readFileSync(options.manifestPath, 'utf8'));
  const badgesByPinId = manifest.badgesByPinId || {};
  const driveFilesByHash = loadDriveFilesByHash(options.driveFilesPath);
  if (Object.keys(driveFilesByHash).length) {
    console.log(`Using ${Object.keys(driveFilesByHash).length} individual Drive image links.`);
  }
  const allRequests = [];
  const allStats = [];

  for (const sheet of selectedSheets) {
    const rows = await fetchSheetRows(options.spreadsheetId, sheet.title);
    const { requests, stats } = buildStateRequests(sheet, rows, badgesByPinId, driveFilesByHash);
    allRequests.push(...requests);
    allStats.push(stats);
    console.log(`${sheet.title}: ${stats.parks} parks, ${stats.matchedParks} matched, ${stats.insertedRows} insert row(s), ${stats.existingBlocks} existing block(s)`);
  }

  const totals = allStats.reduce((acc, stats) => {
    Object.keys(acc).forEach(key => { acc[key] += stats[key] || 0; });
    return acc;
  }, {
    parks: 0,
    matchedParks: 0,
    existingBlocks: 0,
    insertedRows: 0,
    updatedExistingCells: 0,
    preservedExtraExistingRows: 0
  });

  console.log('\nTotals:', JSON.stringify(totals, null, 2));
  console.log(`Generated ${allRequests.length} Sheets API request(s).`);

  if (options.requestsOutPath) {
    fs.mkdirSync(path.dirname(options.requestsOutPath), { recursive: true });
    fs.writeFileSync(options.requestsOutPath, JSON.stringify(allRequests, null, 2) + '\n', 'utf8');
    console.log(`Wrote generated requests to ${options.requestsOutPath}`);
  }

  if (!options.write) {
    console.log('\nDry run only. Re-run with --write after confirming Sheets edit credentials.');
    return;
  }

  await applyRequests(options.spreadsheetId, allRequests, options.chunkSize);
  console.log('Badge row migration complete.');
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
