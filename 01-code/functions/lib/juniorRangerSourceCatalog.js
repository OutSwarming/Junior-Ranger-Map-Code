'use strict';

const SPREADSHEET_ID = '1Twoq7MNwqGn49d9t2phdDThB5ufT1H2PqY9fmcZrs_8';
const DEFAULT_STATE = 'Alabama';
const SOURCE_RANGE_COLUMNS = 'A:H';

const SOURCE_COLUMNS = Object.freeze({
    state: 0,
    color: 1,
    name: 2,
    tag: 3,
    latitude: 5,
    longitude: 6,
    siteId: 7
});

const TARGET_HEADERS = Object.freeze([
    'siteID',
    'siteName',
    'siteInfo',
    'jrBooks',
    'latitude',
    'longitude',
    'state',
    'address',
    'agency',
    'historyTimelineInfo',
    'badgePictures',
    'officialGovWebsite',
    'websiteLinks',
    'lastUpdated',
    'specialPrograms'
]);

const AGENCY_BY_COLOR = Object.freeze({
    '#0000ff': 'NPS',
    '#00ff00': 'US Fish & Wildlife Service',
    '#5b0f00': 'US Forest Service - National Forest',
    '#000000': 'State',
    '#ffff00': 'Other',
    '#ff9900': 'BLM',
    '#ff0000': 'US Army Corps of Engineers'
});

const IGNORED_COLORS = new Set(['#9900ff']);

function cleanValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\r\n/g, '\n').trim();
}

function getCellText(cell = {}) {
    if (cell.formattedValue !== undefined) return cleanValue(cell.formattedValue);
    const value = cell.effectiveValue || cell.userEnteredValue || {};
    return cleanValue(value.stringValue ?? value.numberValue ?? value.boolValue ?? '');
}

function getCellLink(cell = {}) {
    if (cell.hyperlink) return cell.hyperlink;

    const directLink = cell.userEnteredFormat && cell.userEnteredFormat.textFormat && cell.userEnteredFormat.textFormat.link;
    if (directLink && directLink.uri) return directLink.uri;

    const runs = Array.isArray(cell.textFormatRuns) ? cell.textFormatRuns : [];
    const runWithLink = runs.find(run => run && run.format && run.format.link && run.format.link.uri);
    return runWithLink ? runWithLink.format.link.uri : '';
}

function getCellColor(cell = {}) {
    const color = (cell.effectiveFormat && cell.effectiveFormat.backgroundColor)
        || (cell.userEnteredFormat && cell.userEnteredFormat.backgroundColor)
        || null;
    if (!color) return '';

    const rgb = ['red', 'green', 'blue'].map(channel => {
        const value = Number.isFinite(color[channel]) ? color[channel] : 0;
        return Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0');
    });
    return `#${rgb.join('')}`;
}

function normalizeStateName(value) {
    return cleanValue(value)
        .toLowerCase()
        .replace(/\bd\.?c\.?\b/g, 'dc')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sourceRowLooksLikeHeader(name, tag) {
    const combined = `${name} ${tag}`.toLowerCase();
    return combined.includes('master map') || combined.includes('track trails') || combined.includes('best contact');
}

function isParentheticalLocation(value) {
    return /^\s*\([^)]+\)\s*$/.test(cleanValue(value));
}

function stripParenthetical(value) {
    return cleanValue(value).replace(/^\(|\)$/g, '').trim();
}

function isFiniteCoordinate(value) {
    const number = Number(cleanValue(value));
    return Number.isFinite(number);
}

function normalizeTagLabel(value) {
    return cleanValue(value)
        .replace(/\s+/g, ' ')
        .replace(/\s+\*+$/g, '')
        .trim();
}

function addTag(entry, tagCell) {
    if (!entry) return;
    const text = getCellText(tagCell);
    if (!text) return;

    const url = cleanValue(getCellLink(tagCell));
    text.split(/\n+/)
        .map(normalizeTagLabel)
        .filter(Boolean)
        .forEach(label => {
            entry.tags.push({ label, url });
        });
}

function buildTagPayload(tags) {
    const labels = [];
    const bookLines = [];
    const seenLabels = new Set();
    const seenBookLines = new Set();

    tags.forEach(tag => {
        const label = normalizeTagLabel(tag && tag.label);
        if (!label) return;

        const labelKey = label.toLowerCase();
        if (!seenLabels.has(labelKey)) {
            seenLabels.add(labelKey);
            labels.push(label);
        }

        if (tag.url) {
            const bookLine = `${label}: ${tag.url}`;
            const bookLineKey = bookLine.toLowerCase();
            if (!seenBookLines.has(bookLineKey)) {
                seenBookLines.add(bookLineKey);
                bookLines.push(bookLine);
            }
        }
    });

    return {
        specialPrograms: labels.join(' | '),
        jrBooks: bookLines.join('\n')
    };
}

function createEntry({
    rowNumber,
    name,
    state,
    color,
    latitude,
    longitude,
    siteId,
    parentName = ''
}) {
    const placeName = parentName && isParentheticalLocation(name)
        ? `${parentName} - ${stripParenthetical(name)}`
        : cleanValue(name);

    return {
        rowNumber,
        state: cleanValue(state),
        name: placeName,
        parentName: cleanValue(parentName),
        color,
        agency: AGENCY_BY_COLOR[color] || '',
        latitude: cleanValue(latitude),
        longitude: cleanValue(longitude),
        siteId: cleanValue(siteId),
        tags: []
    };
}

function shouldPublishEntry(entry) {
    return Boolean(
        entry
        && entry.name
        && entry.siteId
        && isFiniteCoordinate(entry.latitude)
        && isFiniteCoordinate(entry.longitude)
    );
}

function extractCatalogRowsFromGrid(spreadsheet, options = {}) {
    const requestedState = cleanValue(options.state || DEFAULT_STATE);
    const requestedStateKey = normalizeStateName(requestedState);
    const entries = [];
    const sheets = spreadsheet && Array.isArray(spreadsheet.sheets) ? spreadsheet.sheets : [];

    sheets.forEach(sheet => {
        const sheetTitle = cleanValue(sheet.properties && sheet.properties.title);
        if (requestedStateKey && normalizeStateName(sheetTitle) !== requestedStateKey) return;

        let currentState = requestedState || sheetTitle;
        let currentEntry = null;
        let currentParentName = '';
        const rows = sheet.data && sheet.data[0] && Array.isArray(sheet.data[0].rowData)
            ? sheet.data[0].rowData
            : [];

        rows.forEach((row, rowIndex) => {
            const values = Array.isArray(row.values) ? row.values : [];
            const rowNumber = rowIndex + 1;
            const stateText = getCellText(values[SOURCE_COLUMNS.state]);
            const name = getCellText(values[SOURCE_COLUMNS.name]);
            const tag = getCellText(values[SOURCE_COLUMNS.tag]);
            const color = getCellColor(values[SOURCE_COLUMNS.color]);
            const latitude = getCellText(values[SOURCE_COLUMNS.latitude]);
            const longitude = getCellText(values[SOURCE_COLUMNS.longitude]);
            const siteId = getCellText(values[SOURCE_COLUMNS.siteId]);

            if (stateText) currentState = stateText;
            if (rowIndex === 0 || sourceRowLooksLikeHeader(name, tag)) return;
            if (IGNORED_COLORS.has(color)) {
                currentEntry = null;
                return;
            }

            if (name) {
                const parentName = isParentheticalLocation(name) ? currentParentName : '';
                currentEntry = createEntry({
                    rowNumber,
                    name,
                    state: currentState,
                    color,
                    latitude,
                    longitude,
                    siteId,
                    parentName
                });
                entries.push(currentEntry);
                if (!isParentheticalLocation(name)) currentParentName = name;
            } else if (currentEntry && (latitude || longitude || siteId)) {
                currentEntry.latitude = currentEntry.latitude || cleanValue(latitude);
                currentEntry.longitude = currentEntry.longitude || cleanValue(longitude);
                currentEntry.siteId = currentEntry.siteId || cleanValue(siteId);
            }

            if (tag) addTag(currentEntry, values[SOURCE_COLUMNS.tag]);
        });
    });

    return entries.filter(shouldPublishEntry).map(entry => {
        const tagPayload = buildTagPayload(entry.tags);
        return {
            siteID: entry.siteId,
            siteName: entry.name,
            siteInfo: `Imported live from Junior Ranger Master Spreadsheet ${entry.state} row ${entry.rowNumber}.`,
            jrBooks: tagPayload.jrBooks,
            latitude: entry.latitude,
            longitude: entry.longitude,
            state: entry.state,
            address: '',
            agency: entry.agency,
            historyTimelineInfo: '',
            badgePictures: '',
            officialGovWebsite: '',
            websiteLinks: '',
            lastUpdated: options.today || new Date().toISOString().slice(0, 10),
            specialPrograms: tagPayload.specialPrograms
        };
    });
}

function csvEscape(value) {
    const text = cleanValue(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function catalogRowsToCsv(rows) {
    const lines = [TARGET_HEADERS.join(',')];
    rows.forEach(row => {
        lines.push(TARGET_HEADERS.map(header => csvEscape(row[header])).join(','));
    });
    return `${lines.join('\n')}\n`;
}

function buildSheetRange(state = DEFAULT_STATE) {
    const safeState = cleanValue(state || DEFAULT_STATE).replace(/'/g, "''");
    return `'${safeState}'!${SOURCE_RANGE_COLUMNS}`;
}

module.exports = {
    SPREADSHEET_ID,
    DEFAULT_STATE,
    TARGET_HEADERS,
    buildSheetRange,
    catalogRowsToCsv,
    extractCatalogRowsFromGrid,
    getCellColor,
    getCellLink,
    getCellText
};
