#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { google } = require('googleapis');
const {
    extractSourceEntriesFromGrid,
    getHeaderIndex,
    syncTagCatalog,
    TARGET_COLUMNS
} = require('../lib/junior-ranger-tag-sync');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SOURCE_SPREADSHEET_ID = '1Twoq7MNwqGn49d9t2phdDThB5ufT1H2PqY9fmcZrs_8';
const DEFAULT_SOURCE_SHEET_GID = '';
const DEFAULT_TARGET_CSV = path.join(REPO_ROOT, '01-code', 'app', 'assets', 'data', 'jr-fallback.csv');

function parseArgs(argv) {
    const args = {
        apply: false,
        appendNew: true,
        sourceSpreadsheetId: process.env.JR_TAG_SOURCE_SPREADSHEET_ID || DEFAULT_SOURCE_SPREADSHEET_ID,
        sourceSheetGid: process.env.JR_TAG_SOURCE_SHEET_GID || DEFAULT_SOURCE_SHEET_GID,
        targetCsv: process.env.JR_TAG_TARGET_CSV || DEFAULT_TARGET_CSV,
        targetSpreadsheetId: process.env.JR_TAG_TARGET_SPREADSHEET_ID || '',
        targetSheetGid: process.env.JR_TAG_TARGET_SHEET_GID || '',
        targetSheetName: process.env.JR_TAG_TARGET_SHEET_NAME || '',
        json: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => argv[++i];
        if (arg === '--apply') args.apply = true;
        else if (arg === '--no-append-new') args.appendNew = false;
        else if (arg === '--json') args.json = true;
        else if (arg === '--source-spreadsheet-id') args.sourceSpreadsheetId = next();
        else if (arg === '--source-sheet-gid') args.sourceSheetGid = next();
        else if (arg === '--target-csv') {
            args.targetCsv = path.resolve(next());
            args.targetSpreadsheetId = '';
        } else if (arg === '--target-spreadsheet-id') {
            args.targetSpreadsheetId = next();
            args.targetCsv = '';
        } else if (arg === '--target-sheet-gid') args.targetSheetGid = next();
        else if (arg === '--target-sheet-name') args.targetSheetName = next();
        else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function printHelp() {
    console.log(`Usage: node 05-tools/scripts/sync-junior-ranger-tags.js [options]

Reads the Junior Ranger planning spreadsheet and syncs only tag/book columns.

Defaults:
  source spreadsheet: ${DEFAULT_SOURCE_SPREADSHEET_ID}
  source tabs:        all tabs
  target CSV:         ${path.relative(REPO_ROOT, DEFAULT_TARGET_CSV)}

Options:
  --apply                         Write changes. Without this, runs dry.
  --no-append-new                 Do not append source places missing from target.
  --source-spreadsheet-id <id>    Google Sheet to read rich tag/book cells from.
  --source-sheet-gid <gid>        Limit the source read to one tab gid.
  --target-csv <path>             Local target CSV to update.
  --target-spreadsheet-id <id>    Google Sheet target instead of CSV.
  --target-sheet-gid <gid>        Target tab gid.
  --target-sheet-name <name>      Target tab name.
  --json                          Print machine-readable summary.

Auth for Google Sheets uses Application Default Credentials or
GOOGLE_APPLICATION_CREDENTIALS with Sheets read/write access.`);
}

function csvEscape(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function rowsToCsv(headers, rows) {
    return [headers, ...rows]
        .map(row => row.map(csvEscape).join(','))
        .join('\n') + '\n';
}

function readTargetCsv(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const records = parse(raw, {
        bom: true,
        relax_column_count: true,
        skip_empty_lines: false
    }).filter(row => row.some(cell => String(cell || '').trim() !== ''));
    const headers = records[0].map(value => String(value || '').trim());
    const rows = records.slice(1).map(row => headers.map((_, index) => row[index] || ''));
    return { headers, rows };
}

async function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return google.sheets({ version: 'v4', auth });
}

async function getSheetTitleByGid(sheets, spreadsheetId, gid) {
    if (!gid) return '';
    const response = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)'
    });
    const sheet = response.data.sheets.find(item => String(item.properties.sheetId) === String(gid));
    if (!sheet) throw new Error(`Could not find sheet gid ${gid} in ${spreadsheetId}.`);
    return sheet.properties.title;
}

async function readSourceSpreadsheet(sheets, spreadsheetId, gid) {
    const title = await getSheetTitleByGid(sheets, spreadsheetId, gid);
    const response = await sheets.spreadsheets.get({
        spreadsheetId,
        includeGridData: true,
        ranges: title ? [`'${title.replace(/'/g, "''")}'`] : undefined,
        fields: [
            'sheets.properties(sheetId,title)',
            'sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue,effectiveValue,textFormatRuns,userEnteredFormat(textFormat,backgroundColor),effectiveFormat(backgroundColor))'
        ].join(',')
    });
    return response.data;
}

async function readTargetSpreadsheet(sheets, spreadsheetId, { sheetGid, sheetName }) {
    const title = sheetName || await getSheetTitleByGid(sheets, spreadsheetId, sheetGid);
    if (!title) throw new Error('Target spreadsheet needs --target-sheet-name or --target-sheet-gid.');
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title.replace(/'/g, "''")}'`
    });
    const values = response.data.values || [];
    if (!values.length) throw new Error(`Target sheet ${title} has no header row.`);
    const headers = values[0].map(value => String(value || '').trim());
    const rows = values.slice(1).map(row => headers.map((_, index) => row[index] || ''));
    return { title, headers, rows };
}

function columnLetter(index) {
    let value = index + 1;
    let letter = '';
    while (value > 0) {
        const remainder = (value - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        value = Math.floor((value - remainder - 1) / 26);
    }
    return letter;
}

async function writeTargetSpreadsheet(sheets, spreadsheetId, title, syncResult) {
    const jrBooksIndex = getHeaderIndex(syncResult.headers, TARGET_COLUMNS.jrBooks);
    const specialProgramsIndex = getHeaderIndex(syncResult.headers, TARGET_COLUMNS.specialPrograms);
    const data = [];

    syncResult.updates.forEach(update => {
        const sheetRowNumber = update.rowIndex + 2;
        data.push({
            range: `'${title.replace(/'/g, "''")}'!${columnLetter(jrBooksIndex)}${sheetRowNumber}`,
            values: [[syncResult.rows[update.rowIndex][jrBooksIndex]]]
        });
        data.push({
            range: `'${title.replace(/'/g, "''")}'!${columnLetter(specialProgramsIndex)}${sheetRowNumber}`,
            values: [[syncResult.rows[update.rowIndex][specialProgramsIndex]]]
        });
    });

    if (data.length) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data
            }
        });
    }

    if (syncResult.appends.length) {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `'${title.replace(/'/g, "''")}'`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: syncResult.appends.map(append => append.row)
            }
        });
    }
}

function buildSummary(syncResult) {
    return {
        updated: syncResult.updates.length,
        appended: syncResult.appends.length,
        unchanged: syncResult.unchanged.length,
        skipped: syncResult.skipped.length,
        updates: syncResult.updates.map(update => ({
            name: update.sourceEntry.name,
            state: update.sourceEntry.state,
            targetRow: update.rowIndex + 2,
            reason: update.match.reason,
            changedColumns: Object.keys(update.changes)
        })),
        appends: syncResult.appends.map(append => ({
            name: append.sourceEntry.name,
            state: append.sourceEntry.state,
            siteID: append.row[getHeaderIndex(syncResult.headers, TARGET_COLUMNS.siteId)] || ''
        })),
        skipped: syncResult.skipped.map(skip => ({
            name: skip.sourceEntry.name,
            state: skip.sourceEntry.state,
            reason: skip.reason
        }))
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const sheets = await getSheetsClient();
    const sourceSpreadsheet = await readSourceSpreadsheet(sheets, args.sourceSpreadsheetId, args.sourceSheetGid);
    const sourceEntries = extractSourceEntriesFromGrid(sourceSpreadsheet);

    let target;
    if (args.targetSpreadsheetId) {
        target = await readTargetSpreadsheet(sheets, args.targetSpreadsheetId, {
            sheetGid: args.targetSheetGid,
            sheetName: args.targetSheetName
        });
    } else {
        target = readTargetCsv(args.targetCsv);
    }

    const syncResult = syncTagCatalog({
        sourceEntries,
        targetHeaders: target.headers,
        targetRows: target.rows,
        appendNew: args.appendNew
    });
    const summary = buildSummary(syncResult);

    if (args.apply) {
        if (args.targetSpreadsheetId) {
            await writeTargetSpreadsheet(sheets, args.targetSpreadsheetId, target.title, syncResult);
        } else {
            fs.writeFileSync(args.targetCsv, rowsToCsv(syncResult.headers, syncResult.rows), 'utf8');
        }
    }

    if (args.json) {
        console.log(JSON.stringify({ dryRun: !args.apply, ...summary }, null, 2));
    } else {
        console.log(`${args.apply ? 'Applied' : 'Dry run'} Junior Ranger tag sync.`);
        console.log(`Source entries: ${sourceEntries.length}`);
        console.log(`Updated: ${summary.updated}`);
        console.log(`Appended: ${summary.appended}`);
        console.log(`Unchanged: ${summary.unchanged}`);
        console.log(`Skipped: ${summary.skipped}`);
        if (!args.apply) console.log('Run again with --apply to write these changes.');
    }
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exit(1);
});
