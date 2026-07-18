'use strict';

const SPREADSHEET_ID = '1Twoq7MNwqGn49d9t2phdDThB5ufT1H2PqY9fmcZrs_8';
const DEFAULT_STATE = 'Alabama';
const SOURCE_RANGE_COLUMNS = 'A:H';

const SOURCE_COLUMNS = Object.freeze({
    state: 0,
    color: 1,
    name: 2,
    tag: 3,
    siteSpecific: 4,
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
    'siteSpecific',
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
const ACROSS_SECTION_NAME = 'across';
const COORDINATE_OVERRIDES_BY_SITE_ID = Object.freeze({
    jr_across_glen_canyon_nra_glen_canyon_conservancy: {
        latitude: '36.9193756',
        longitude: '-111.4602113'
    }
});
const US_STATE_NAMES = Object.freeze([
    'alabama', 'alaska', 'american samoa', 'arizona', 'arkansas', 'california',
    'colorado', 'connecticut', 'delaware', 'district of columbia', 'florida',
    'georgia', 'guam', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
    'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts',
    'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska',
    'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york',
    'north carolina', 'north dakota', 'northern mariana islands', 'ohio',
    'oklahoma', 'oregon', 'pennsylvania', 'puerto rico', 'rhode island',
    'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont',
    'virgin islands', 'virginia', 'washington', 'washington dc',
    'west virginia', 'wisconsin', 'wyoming'
]);

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
    if (runWithLink) return runWithLink.format.link.uri;

    const formula = cell.userEnteredValue && cell.userEnteredValue.formulaValue;
    const formulaLink = String(formula || '').match(/^=HYPERLINK\("((?:""|[^"])*)"/i);
    return formulaLink ? formulaLink[1].replace(/""/g, '"') : '';
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

function titleCaseState(value) {
    return cleanValue(value)
        .split(' ')
        .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
        .join(' ')
        .replace(/\bDc\b/g, 'DC');
}

function isJuniorRangerStateSheetTitle(value) {
    const normalized = normalizeStateName(value);
    const withoutCommas = normalized.replace(/,/g, '');
    return US_STATE_NAMES.includes(normalized)
        || US_STATE_NAMES.includes(withoutCommas)
        || withoutCommas === 'washington dc';
}

function isAcrossStateSection(value) {
    return normalizeStateName(value) === ACROSS_SECTION_NAME;
}

function resolveStateLabel(value, fallback) {
    const text = cleanValue(value);
    const fallbackText = cleanValue(fallback);
    if (!isJuniorRangerStateSheetTitle(text)) return fallbackText;

    const normalizedText = normalizeStateName(text);
    if (normalizedText === normalizeStateName(fallbackText)) return fallbackText;
    return titleCaseState(normalizedText);
}

function extractExplicitState(value) {
    const text = cleanValue(value);
    if (!text.includes(',')) return '';

    const candidate = normalizeStateName(text.split(',').pop());
    return US_STATE_NAMES.includes(candidate) ? titleCaseState(candidate) : '';
}

function stripExplicitState(value) {
    const text = cleanValue(value);
    if (!extractExplicitState(text)) return text;
    return cleanValue(text.split(',').slice(0, -1).join(','));
}

function slugifyIdPart(value) {
    return cleanValue(value)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/\bnational park and preserve\b/g, 'np pr')
        .replace(/\bnational parks?\b/g, 'np')
        .replace(/\bnational preserves?\b/g, 'npr')
        .replace(/\bnational monuments?\b/g, 'nm')
        .replace(/\bnational military parks?\b/g, 'nmp')
        .replace(/\bnational historical parks?\b/g, 'nhp')
        .replace(/\bnational historic parks?\b/g, 'nhp')
        .replace(/\bnational historic sites?\b/g, 'nhs')
        .replace(/\bnational recreation areas?\b/g, 'nra')
        .replace(/\bnational heritage areas?\b/g, 'nha')
        .replace(/\bnational forests?\b/g, 'nf')
        .replace(/\bstate parks?\b/g, 'sp')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

function buildGeneratedSiteId(state, name) {
    const stateSlug = slugifyIdPart(state);
    const nameSlug = slugifyIdPart(name);
    if (!stateSlug || !nameSlug) return '';
    return `jr_${stateSlug}_${nameSlug}`;
}

function buildDeduplicationNameKey(name) {
    return slugifyIdPart(name);
}

function sourceRowLooksLikeHeader(name, tag) {
    const combined = `${name} ${tag}`.toLowerCase();
    return combined.includes('master map') || combined.includes('track trails') || combined.includes('best contact');
}

function sourceTextLooksLikeStateList(value) {
    const text = cleanValue(value);
    if (!text) return false;

    if (US_STATE_NAMES.includes(normalizeStateName(text))) return true;
    if (!text.includes(',')) return false;

    return text
        .split(',')
        .map(normalizeStateName)
        .filter(Boolean)
        .every(part => US_STATE_NAMES.includes(part));
}

function isParentheticalLocation(value) {
    return /^\s*\([^)]+\)\s*$/.test(cleanValue(value));
}

function stripParenthetical(value) {
    return cleanValue(value).replace(/^\(|\)$/g, '').trim();
}

function isFiniteCoordinate(value) {
    const text = cleanValue(value);
    if (!text) return false;
    const number = Number(text);
    return Number.isFinite(number);
}

function normalizeSiteSpecificValue(value) {
    const normalized = cleanValue(value).toLowerCase();
    if (normalized === 'yes' || normalized === 'y' || normalized === 'true') return 'Yes';
    if (normalized === 'no' || normalized === 'n' || normalized === 'false') return 'No';
    return '';
}

function normalizeTagLabel(value) {
    return cleanValue(value)
        .replace(/\s+/g, ' ')
        .replace(/\s+\*+$/g, '')
        .replace(/:\s*$/, '')
        .trim();
}

function isParentheticalTag(value) {
    return /^\s*\([^)]+\)\s*$/.test(normalizeTagLabel(value));
}

function isTradingCardsTag(value) {
    return /^trading cards?:?$/i.test(normalizeTagLabel(value));
}

function isBadgesTag(value) {
    return /^badges?:?$/i.test(normalizeTagLabel(value));
}

function isNoRewardTag(value) {
    return /^\(?\s*no\s+(badge|patch|reward|rewards?)\s*\)?$/i.test(normalizeTagLabel(value));
}

function stripBadgeLabel(value) {
    return normalizeTagLabel(value).replace(/^\s*\(|\)\s*$/g, '').trim();
}

function addBadgeLink(entry, label, tagCell) {
    if (!entry) return;
    if (isNoRewardTag(label)) return;

    const url = cleanValue(getCellLink(tagCell));
    if (!url) return;

    const cleanedLabel = stripBadgeLabel(label);
    entry.badgeLinks.push({
        label: cleanedLabel || `Badge ${entry.badgeLinks.length + 1}`,
        url
    });
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
            if (isBadgesTag(label)) {
                entry.isBadgeBlock = true;
                return;
            }
            if (entry.isBadgeBlock && (isParentheticalTag(label) || isNoRewardTag(label))) {
                addBadgeLink(entry, label, tagCell);
                return;
            }

            entry.isBadgeBlock = false;
            if (entry.isTradingCardsBlock && isParentheticalTag(label)) return;
            entry.tags.push({ label, url });
            entry.isTradingCardsBlock = isTradingCardsTag(label);
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

function buildBadgePicturesPayload(badgeLinks) {
    const seen = new Set();
    const lines = [];

    (Array.isArray(badgeLinks) ? badgeLinks : []).forEach(link => {
        const label = normalizeTagLabel(link && link.label);
        const url = cleanValue(link && link.url);
        if (!url) return;

        const key = url.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        lines.push(label ? `${label}: ${url}` : url);
    });

    return lines.join('\n');
}

function createEntry({
    rowNumber,
    name,
    state,
    color,
    latitude,
    longitude,
    siteId,
    siteSpecific,
    parentName = '',
    isAcrossSection = false
}) {
    const rawPlaceName = parentName && isParentheticalLocation(name)
        ? `${parentName} - ${stripParenthetical(name)}`
        : cleanValue(name);
    const explicitState = extractExplicitState(rawPlaceName);
    const placeName = stripExplicitState(rawPlaceName);
    const resolvedState = explicitState || cleanValue(state);
    const resolvedSiteId = cleanValue(siteId) || buildGeneratedSiteId(resolvedState, placeName);
    const coordinateOverride = COORDINATE_OVERRIDES_BY_SITE_ID[resolvedSiteId] || null;

    return {
        rowNumber,
        state: resolvedState,
        name: placeName,
        parentName: cleanValue(parentName),
        color,
        agency: AGENCY_BY_COLOR[color] || '',
        latitude: coordinateOverride ? coordinateOverride.latitude : cleanValue(latitude),
        longitude: coordinateOverride ? coordinateOverride.longitude : cleanValue(longitude),
        siteId: resolvedSiteId,
        siteSpecific: normalizeSiteSpecificValue(siteSpecific),
        isAcrossSection: isAcrossSection === true,
        isTradingCardsBlock: false,
        isBadgeBlock: false,
        badgeLinks: [],
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
    const requestedStateOption = cleanValue(options.state);
    const requestedState = /^all$/i.test(requestedStateOption) ? '' : requestedStateOption;
    const requestedStateKey = normalizeStateName(requestedState);
    const entries = [];
    const seenPublishedNames = new Map();
    const sheets = spreadsheet && Array.isArray(spreadsheet.sheets) ? spreadsheet.sheets : [];

    sheets.forEach(sheet => {
        const sheetTitle = cleanValue(sheet.properties && sheet.properties.title);
        if (!isJuniorRangerStateSheetTitle(sheetTitle)) return;
        if (requestedStateKey && normalizeStateName(sheetTitle) !== requestedStateKey) return;

        let currentState = sheetTitle;
        let isAcrossSection = false;
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
            const siteSpecific = getCellText(values[SOURCE_COLUMNS.siteSpecific]);
            const color = getCellColor(values[SOURCE_COLUMNS.color]);
            const latitude = getCellText(values[SOURCE_COLUMNS.latitude]);
            const longitude = getCellText(values[SOURCE_COLUMNS.longitude]);
            const siteId = getCellText(values[SOURCE_COLUMNS.siteId]);

            if (stateText) {
                if (isAcrossStateSection(stateText)) {
                    isAcrossSection = true;
                    currentEntry = null;
                    currentParentName = '';
                } else if (isJuniorRangerStateSheetTitle(stateText)) {
                    currentState = resolveStateLabel(stateText, sheetTitle);
                    isAcrossSection = false;
                }
            }
            if (rowIndex === 0 || sourceRowLooksLikeHeader(name, tag)) return;
            if (IGNORED_COLORS.has(color)) {
                currentEntry = null;
                return;
            }
            if (name && sourceTextLooksLikeStateList(name)) {
                if (tag) addTag(currentEntry, values[SOURCE_COLUMNS.tag]);
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
                    siteSpecific,
                    parentName,
                    isAcrossSection
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

    return entries.filter(entry => {
        if (!shouldPublishEntry(entry)) return false;
        const nameKey = buildDeduplicationNameKey(entry.name);
        if (!nameKey) return true;
        const previous = seenPublishedNames.get(nameKey);
        if (previous && (previous.isAcrossSection || entry.isAcrossSection)) return false;
        seenPublishedNames.set(nameKey, { isAcrossSection: entry.isAcrossSection });
        return true;
    }).map(entry => {
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
            badgePictures: buildBadgePicturesPayload(entry.badgeLinks),
            officialGovWebsite: '',
            websiteLinks: '',
            lastUpdated: options.today || new Date().toISOString().slice(0, 10),
            siteSpecific: entry.siteSpecific,
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

function buildStateSheetRanges(sheetTitles) {
    return (Array.isArray(sheetTitles) ? sheetTitles : [])
        .map(cleanValue)
        .filter(isJuniorRangerStateSheetTitle)
        .map(title => buildSheetRange(title));
}

module.exports = {
    SPREADSHEET_ID,
    DEFAULT_STATE,
    TARGET_HEADERS,
    buildStateSheetRanges,
    buildSheetRange,
    catalogRowsToCsv,
    extractCatalogRowsFromGrid,
    getCellColor,
    getCellLink,
    getCellText
};
