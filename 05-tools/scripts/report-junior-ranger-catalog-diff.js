#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const {
    TARGET_COLUMNS,
    buildTargetIndexes,
    cleanValue,
    extractSourceMembershipEntriesFromGrid,
    findTargetRowIndex,
    getHeaderIndex
} = require('../lib/junior-ranger-tag-sync');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SOURCE_SPREADSHEET_ID = '1Twoq7MNwqGn49d9t2phdDThB5ufT1H2PqY9fmcZrs_8';
const DEFAULT_TARGET_CSV = path.join(REPO_ROOT, '01-code', 'app', 'assets', 'data', 'jr-fallback.csv');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, '05-tools', 'reports');
const DEFAULT_REPORT_BASENAME = 'junior-ranger-catalog-diff';

function parseArgs(argv) {
    const args = {
        sourceSpreadsheetId: process.env.JR_TAG_SOURCE_SPREADSHEET_ID || DEFAULT_SOURCE_SPREADSHEET_ID,
        targetCsv: process.env.JR_TAG_TARGET_CSV || DEFAULT_TARGET_CSV,
        reportDir: process.env.JR_CATALOG_DIFF_REPORT_DIR || DEFAULT_REPORT_DIR,
        reportBasename: process.env.JR_CATALOG_DIFF_REPORT_BASENAME || DEFAULT_REPORT_BASENAME,
        json: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => argv[++i];
        if (arg === '--source-spreadsheet-id') args.sourceSpreadsheetId = next();
        else if (arg === '--target-csv') args.targetCsv = path.resolve(next());
        else if (arg === '--report-dir') args.reportDir = path.resolve(next());
        else if (arg === '--report-basename') args.reportBasename = next();
        else if (arg === '--json') args.json = true;
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
    console.log(`Usage: node 05-tools/scripts/report-junior-ranger-catalog-diff.js [options]

Builds a full membership diff between spreadsheet 1 and the map catalog.

Defaults:
  source spreadsheet: ${DEFAULT_SOURCE_SPREADSHEET_ID}
  target CSV:         ${path.relative(REPO_ROOT, DEFAULT_TARGET_CSV)}
  report dir:         ${path.relative(REPO_ROOT, DEFAULT_REPORT_DIR)}

Options:
  --source-spreadsheet-id <id>    Public Google Sheet source workbook.
  --target-csv <path>             Spreadsheet 2 / map catalog CSV to compare.
  --report-dir <path>             Directory for markdown and CSV reports.
  --report-basename <name>        Report filename without extension.
  --json                          Print machine-readable summary.`);
}

function csvEscape(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed ${response.status}: ${url}`);
    return response.text();
}

function parseGvizResponse(text, sheetName) {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error(`Could not parse GViz response for ${sheetName}.`);
    const payload = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    if (payload.status !== 'ok') {
        const errors = (payload.errors || []).map(error => error.detailed_message || error.message).filter(Boolean).join('; ');
        throw new Error(`GViz response failed for ${sheetName}: ${errors || payload.status}`);
    }
    return payload;
}

async function readPublicSheetTabs(spreadsheetId) {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
    const html = await fetchText(url);
    const tabs = [...html.matchAll(/docs-sheet-tab-caption">([^<]+)<\/div>/g)]
        .map(match => decodeHtml(match[1]).trim())
        .filter(Boolean);

    if (!tabs.length) throw new Error('Could not find public sheet tabs in source workbook.');
    return [...new Set(tabs)];
}

async function readPublicGvizSheet(spreadsheetId, sheetName) {
    const params = new URLSearchParams({
        tqx: 'out:json',
        sheet: sheetName
    });
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?${params.toString()}`;
    const payload = parseGvizResponse(await fetchText(url), sheetName);
    const rows = (payload.table && payload.table.rows ? payload.table.rows : []).map(row => {
        const values = Array.isArray(row.c) ? row.c : [];
        return {
            values: values.map(cell => ({
                formattedValue: cell && (cell.f ?? cell.v) !== undefined ? String(cell.f ?? cell.v) : ''
            }))
        };
    });

    return {
        properties: { title: sheetName },
        data: [{ rowData: rows }]
    };
}

async function readPublicSourceWorkbook(spreadsheetId) {
    const tabs = await readPublicSheetTabs(spreadsheetId);
    const sheets = [];

    for (const tab of tabs) {
        sheets.push(await readPublicGvizSheet(spreadsheetId, tab));
    }

    return { tabs, spreadsheet: { sheets } };
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

function makeSourceRows(sourceEntries) {
    return sourceEntries.map(entry => [entry.name, entry.state, entry.sourceSheet, String(entry.sourceRowNumber || '')]);
}

function getTargetEntries(headers, rows) {
    const nameIndex = getHeaderIndex(headers, TARGET_COLUMNS.name);
    const stateIndex = getHeaderIndex(headers, TARGET_COLUMNS.state);
    const siteIdIndex = getHeaderIndex(headers, TARGET_COLUMNS.siteId);

    return rows.map((row, rowIndex) => ({
        row,
        rowIndex,
        name: cleanValue(row[nameIndex]),
        state: cleanValue(row[stateIndex]),
        siteID: siteIdIndex > -1 ? cleanValue(row[siteIdIndex]) : ''
    })).filter(entry => entry.name || entry.state || entry.siteID);
}

function buildDiff(sourceEntries, targetHeaders, targetRows) {
    const targetIndexes = buildTargetIndexes(targetHeaders, targetRows);
    const sourceHeaders = ['siteName', 'state', 'sourceSheet', 'sourceRowNumber'];
    const sourceRows = makeSourceRows(sourceEntries);
    const sourceIndexes = buildTargetIndexes(sourceHeaders, sourceRows);
    const sourceOnly = [];
    const targetOnly = [];

    sourceEntries.forEach(sourceEntry => {
        const match = findTargetRowIndex(sourceEntry, targetHeaders, targetRows, targetIndexes);
        if (match.index < 0) {
            sourceOnly.push({
                state: sourceEntry.state,
                name: sourceEntry.name,
                sourceSheet: sourceEntry.sourceSheet,
                sourceRowNumber: sourceEntry.sourceRowNumber,
                reason: match.reason
            });
        }
    });

    getTargetEntries(targetHeaders, targetRows).forEach(targetEntry => {
        const match = findTargetRowIndex({
            state: targetEntry.state,
            name: targetEntry.name
        }, sourceHeaders, sourceRows, sourceIndexes);
        if (match.index < 0) {
            targetOnly.push({
                state: targetEntry.state,
                name: targetEntry.name,
                siteID: targetEntry.siteID,
                targetRowNumber: targetEntry.rowIndex + 2,
                reason: match.reason
            });
        }
    });

    const sortByStateName = (a, b) => `${a.state} ${a.name}`.localeCompare(`${b.state} ${b.name}`);
    sourceOnly.sort(sortByStateName);
    targetOnly.sort(sortByStateName);
    return { sourceOnly, targetOnly };
}

function reportRows(diff) {
    const rows = [];
    diff.sourceOnly.forEach(entry => {
        rows.push({
            side: 'Spreadsheet 1 not spreadsheet 2',
            state: entry.state,
            name: entry.name,
            sourceSheet: entry.sourceSheet,
            sourceRowNumber: entry.sourceRowNumber,
            siteID: '',
            targetRowNumber: '',
            reason: entry.reason
        });
    });
    diff.targetOnly.forEach(entry => {
        rows.push({
            side: 'Spreadsheet 2 not spreadsheet 1',
            state: entry.state,
            name: entry.name,
            sourceSheet: '',
            sourceRowNumber: '',
            siteID: entry.siteID,
            targetRowNumber: entry.targetRowNumber,
            reason: entry.reason
        });
    });
    return rows;
}

function writeCsvReport(filePath, rows) {
    const headers = ['side', 'state', 'name', 'sourceSheet', 'sourceRowNumber', 'siteID', 'targetRowNumber', 'reason'];
    const csv = [headers, ...rows.map(row => headers.map(header => row[header]))]
        .map(row => row.map(csvEscape).join(','))
        .join('\n') + '\n';
    fs.writeFileSync(filePath, csv, 'utf8');
}

function markdownTable(entries, side) {
    if (!entries.length) return `No parks found in ${side}.\n`;
    const rows = ['| State | Park | Where | Reason |', '| --- | --- | --- | --- |'];
    entries.forEach(entry => {
        const where = entry.sourceSheet
            ? `${entry.sourceSheet} row ${entry.sourceRowNumber}`
            : `${entry.siteID || 'target row'} row ${entry.targetRowNumber}`;
        rows.push(`| ${entry.state || ''} | ${entry.name || ''} | ${where} | ${entry.reason || ''} |`);
    });
    return rows.join('\n') + '\n';
}

function writeMarkdownReport(filePath, { sourceSpreadsheetId, targetCsv, tabs, sourceEntries, targetRows, diff }) {
    const targetRelative = path.relative(REPO_ROOT, targetCsv);
    const lines = [
        '# Junior Ranger Catalog Diff',
        '',
        `Source spreadsheet: https://docs.google.com/spreadsheets/d/${sourceSpreadsheetId}/edit`,
        `Target catalog: ${targetRelative}`,
        `Source tabs read: ${tabs.length}`,
        `Spreadsheet 1 parks read: ${sourceEntries.length}`,
        `Spreadsheet 2 rows read: ${targetRows.length}`,
        '',
        '## Summary',
        '',
        `- Spreadsheet 1 not spreadsheet 2: ${diff.sourceOnly.length}`,
        `- Spreadsheet 2 not spreadsheet 1: ${diff.targetOnly.length}`,
        '',
        '## Spreadsheet 1 Not Spreadsheet 2',
        '',
        markdownTable(diff.sourceOnly, 'spreadsheet 1 only'),
        '',
        '## Spreadsheet 2 Not Spreadsheet 1',
        '',
        markdownTable(diff.targetOnly, 'spreadsheet 2 only')
    ];
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const { tabs, spreadsheet } = await readPublicSourceWorkbook(args.sourceSpreadsheetId);
    const sourceEntries = extractSourceMembershipEntriesFromGrid(spreadsheet);
    const target = readTargetCsv(args.targetCsv);
    const diff = buildDiff(sourceEntries, target.headers, target.rows);
    const rows = reportRows(diff);

    fs.mkdirSync(args.reportDir, { recursive: true });
    const csvPath = path.join(args.reportDir, `${args.reportBasename}.csv`);
    const mdPath = path.join(args.reportDir, `${args.reportBasename}.md`);
    writeCsvReport(csvPath, rows);
    writeMarkdownReport(mdPath, {
        sourceSpreadsheetId: args.sourceSpreadsheetId,
        targetCsv: args.targetCsv,
        tabs,
        sourceEntries,
        targetRows: target.rows,
        diff
    });

    const summary = {
        sourceTabs: tabs.length,
        sourceParks: sourceEntries.length,
        targetRows: target.rows.length,
        sourceOnly: diff.sourceOnly.length,
        targetOnly: diff.targetOnly.length,
        csvPath,
        markdownPath: mdPath
    };

    if (args.json) {
        console.log(JSON.stringify(summary, null, 2));
    } else {
        console.log('Junior Ranger catalog diff complete.');
        console.log(`Source tabs: ${summary.sourceTabs}`);
        console.log(`Spreadsheet 1 parks: ${summary.sourceParks}`);
        console.log(`Spreadsheet 2 rows: ${summary.targetRows}`);
        console.log(`Spreadsheet 1 not spreadsheet 2: ${summary.sourceOnly}`);
        console.log(`Spreadsheet 2 not spreadsheet 1: ${summary.targetOnly}`);
        console.log(`CSV: ${path.relative(REPO_ROOT, csvPath)}`);
        console.log(`Markdown: ${path.relative(REPO_ROOT, mdPath)}`);
    }
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exit(1);
});
