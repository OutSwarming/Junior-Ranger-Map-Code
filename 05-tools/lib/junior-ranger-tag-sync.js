'use strict';

const SOURCE_NAME_COLUMN = 2;
const SOURCE_TAG_COLUMN = 3;
const SOURCE_STATE_COLUMN = 0;
const SOURCE_COLOR_COLUMN = 1;

const TARGET_COLUMNS = {
    siteId: ['siteID', 'Park ID', 'Park id'],
    name: ['siteName', 'Location'],
    siteInfo: ['siteInfo', 'Site Info', 'Park Info', 'Park Information'],
    state: ['state', 'State'],
    jrBooks: ['jrBooks'],
    historyTimelineInfo: ['historyTimelineInfo', 'JR History', 'Junior Ranger History', 'Junior Ranger history'],
    specialPrograms: ['specialPrograms'],
    lastUpdated: ['lastUpdated', 'Last Updated'],
    color: ['color', 'Color', 'markerColor', 'Marker Color']
};

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

function normalizeState(value) {
    return cleanValue(value).toLowerCase();
}

function normalizeName(value) {
    return cleanValue(value)
        .toLowerCase()
        .replace(/^\(?\s*\d+\s+of\s+\d+\)?\s*/i, '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/&/g, ' and ')
        .replace(/\bnational park and preserve\b/g, 'np pr')
        .replace(/\bnational parks?\b/g, 'np')
        .replace(/\bnational preserves?\b/g, 'npr')
        .replace(/\bnational monuments?\b/g, 'nm')
        .replace(/\bnational historical parks?\b/g, 'nhp')
        .replace(/\bnational historic sites?\b/g, 'nhs')
        .replace(/\bnational battlefields?\b/g, 'nb')
        .replace(/\bnational recreation areas?\b/g, 'nra')
        .replace(/\bnational wildlife refuges?\b/g, 'nwr')
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function nameTokens(value) {
    const stopWords = new Set(['and', 'at', 'for', 'jr', 'junior', 'of', 'ranger', 'the']);
    return normalizeName(value).split(/\s+/).filter(token => token && !stopWords.has(token));
}

function tokenScore(a, b) {
    const aTokens = new Set(nameTokens(a));
    const bTokens = new Set(nameTokens(b));
    if (!aTokens.size || !bTokens.size) return 0;
    let intersection = 0;
    aTokens.forEach(token => {
        if (bTokens.has(token)) intersection++;
    });
    const union = new Set([...aTokens, ...bTokens]).size;
    return intersection / union;
}

function slugifySiteId(name) {
    const slug = normalizeName(name)
        .replace(/\bnp\b/g, 'national park')
        .replace(/\bnm\b/g, 'national monument')
        .replace(/\bnpr\b/g, 'national preserve')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `jr_${slug || 'new_place'}`;
}

function getHeaderIndex(headers, aliases) {
    const normalized = headers.map(header => cleanValue(header).toLowerCase());
    for (const alias of aliases) {
        const index = normalized.indexOf(alias.toLowerCase());
        if (index !== -1) return index;
    }
    return -1;
}

function normalizeHeader(value) {
    return cleanValue(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findSourceColumnByHeader(rows, aliases) {
    const aliasesNormalized = new Set(aliases.map(normalizeHeader));
    const headerRowsToScan = Math.min(rows.length, 8);

    for (let rowIndex = 0; rowIndex < headerRowsToScan; rowIndex++) {
        const values = Array.isArray(rows[rowIndex].values) ? rows[rowIndex].values : [];
        for (let columnIndex = 0; columnIndex < values.length; columnIndex++) {
            if (aliasesNormalized.has(normalizeHeader(getCellText(values[columnIndex])))) {
                return columnIndex;
            }
        }
    }

    return -1;
}

function buildSourceColumnMap(rows) {
    return {
        state: SOURCE_STATE_COLUMN,
        color: SOURCE_COLOR_COLUMN,
        name: SOURCE_NAME_COLUMN,
        tag: SOURCE_TAG_COLUMN,
        siteInfo: findSourceColumnByHeader(rows, TARGET_COLUMNS.siteInfo),
        historyTimelineInfo: findSourceColumnByHeader(rows, TARGET_COLUMNS.historyTimelineInfo)
    };
}

function sourceRowLooksLikeHeader(name, tag) {
    const combined = `${name} ${tag}`.toLowerCase();
    return combined.includes('master map') || combined.includes('track trails') || combined.includes('best contact');
}

function appendOptionalSourceValue(currentValue, nextValue) {
    const current = cleanValue(currentValue);
    const next = cleanValue(nextValue);
    if (!next) return current;
    if (!current) return next;
    if (current.toLowerCase().includes(next.toLowerCase())) return current;
    return `${current}\n${next}`;
}

function applySourceDetails(currentEntry, values, sourceColumns) {
    if (!currentEntry) return;
    if (sourceColumns.siteInfo > -1) {
        currentEntry.siteInfo = appendOptionalSourceValue(currentEntry.siteInfo, getCellText(values[sourceColumns.siteInfo]));
    }
    if (sourceColumns.historyTimelineInfo > -1) {
        currentEntry.historyTimelineInfo = appendOptionalSourceValue(
            currentEntry.historyTimelineInfo,
            getCellText(values[sourceColumns.historyTimelineInfo])
        );
    }
}

function addSourceTag(currentEntry, tagCell) {
    if (!currentEntry) return;
    const text = getCellText(tagCell);
    if (!text) return;

    const link = getCellLink(tagCell);
    text.split(/\n+/)
        .map(line => cleanValue(line))
        .filter(Boolean)
        .forEach(label => {
            currentEntry.tags.push({ label, url: link });
        });
}

function extractSourceEntriesFromGrid(spreadsheet) {
    const entries = [];
    const sheets = spreadsheet && Array.isArray(spreadsheet.sheets) ? spreadsheet.sheets : [];

    sheets.forEach(sheet => {
        const title = cleanValue(sheet.properties && sheet.properties.title);
        let currentState = title;
        let currentEntry = null;
        const rows = sheet.data && sheet.data[0] && Array.isArray(sheet.data[0].rowData)
            ? sheet.data[0].rowData
            : [];
        const sourceColumns = buildSourceColumnMap(rows);

        rows.forEach((row, rowIndex) => {
            const values = Array.isArray(row.values) ? row.values : [];
            const state = getCellText(values[sourceColumns.state]);
            const name = getCellText(values[sourceColumns.name]);
            const tag = getCellText(values[sourceColumns.tag]);
            if (state) currentState = state;
            if (rowIndex === 0 || sourceRowLooksLikeHeader(name, tag)) return;

            if (name) {
                currentEntry = {
                    state: currentState,
                    name,
                    siteInfo: '',
                    historyTimelineInfo: '',
                    color: getCellColor(values[sourceColumns.color]),
                    sourceSheet: title,
                    sourceRowNumber: rowIndex + 1,
                    tags: []
                };
                entries.push(currentEntry);
            }

            applySourceDetails(currentEntry, values, sourceColumns);
            if (tag) addSourceTag(currentEntry, values[sourceColumns.tag]);
        });
    });

    return entries.filter(entry => entry.name && (entry.tags.length || entry.siteInfo || entry.historyTimelineInfo));
}

function buildTagPayload(tags) {
    const seenLabels = new Set();
    const seenBooks = new Set();
    const labels = [];
    const bookLines = [];

    tags.forEach(tag => {
        const label = cleanValue(tag.label).replace(/\s+/g, ' ');
        if (!label) return;
        const labelKey = label.toLowerCase();
        if (!seenLabels.has(labelKey)) {
            seenLabels.add(labelKey);
            labels.push(label);
        }
        if (tag.url) {
            const bookLine = `${label}: ${tag.url}`;
            const bookKey = bookLine.toLowerCase();
            if (!seenBooks.has(bookKey)) {
                seenBooks.add(bookKey);
                bookLines.push(bookLine);
            }
        }
    });

    return {
        specialPrograms: labels.join(' | '),
        jrBooks: bookLines.join('\n')
    };
}

function buildTargetIndexes(headers, rows) {
    const nameIndex = getHeaderIndex(headers, TARGET_COLUMNS.name);
    const stateIndex = getHeaderIndex(headers, TARGET_COLUMNS.state);
    const colorIndex = getHeaderIndex(headers, TARGET_COLUMNS.color);
    const byStateName = new Map();
    const byName = new Map();

    rows.forEach((row, index) => {
        const name = row[nameIndex];
        if (!name) return;
        const normalizedName = normalizeName(name);
        const normalizedState = normalizeState(row[stateIndex]);
        const stateNameKey = `${normalizedState}::${normalizedName}`;
        if (!byStateName.has(stateNameKey)) byStateName.set(stateNameKey, []);
        byStateName.get(stateNameKey).push(index);

        if (!byName.has(normalizedName)) byName.set(normalizedName, []);
        byName.get(normalizedName).push(index);
    });

    return { nameIndex, stateIndex, colorIndex, byStateName, byName };
}

function findTargetRowIndex(sourceEntry, headers, rows, indexes) {
    const normalizedName = normalizeName(sourceEntry.name);
    const normalizedState = normalizeState(sourceEntry.state);
    const exactStateName = indexes.byStateName.get(`${normalizedState}::${normalizedName}`) || [];
    if (exactStateName.length === 1) return { index: exactStateName[0], confidence: 1, reason: 'exact-state-name' };

    const exactName = indexes.byName.get(normalizedName) || [];
    if (exactName.length === 1) return { index: exactName[0], confidence: 0.94, reason: 'unique-name' };

    const candidates = rows.map((row, index) => {
        const name = row[indexes.nameIndex];
        if (!name) return null;
        const stateMatches = normalizeState(row[indexes.stateIndex]) === normalizedState;
        const colorMatches = indexes.colorIndex > -1
            && sourceEntry.color
            && cleanValue(row[indexes.colorIndex]).toLowerCase() === sourceEntry.color.toLowerCase();
        const score = tokenScore(sourceEntry.name, name)
            + (stateMatches ? 0.2 : 0)
            + (colorMatches ? 0.05 : 0);
        return { index, score, stateMatches };
    }).filter(Boolean).sort((a, b) => b.score - a.score);

    const best = candidates[0];
    const runnerUp = candidates[1];
    if (best && best.score >= 0.9 && (!runnerUp || best.score - runnerUp.score >= 0.12)) {
        return { index: best.index, confidence: Math.min(best.score, 0.99), reason: 'fuzzy-state-name' };
    }

    return { index: -1, confidence: 0, reason: candidates.length ? 'no-confident-match' : 'no-candidates' };
}

function ensureUniqueSiteId(baseId, usedIds) {
    let candidate = baseId;
    let suffix = 2;
    while (usedIds.has(candidate)) {
        candidate = `${baseId}_${suffix}`;
        suffix++;
    }
    usedIds.add(candidate);
    return candidate;
}

function makeBlankRow(headers) {
    return headers.map(() => '');
}

function setIfColumn(row, headers, aliases, value) {
    const index = getHeaderIndex(headers, aliases);
    if (index > -1) row[index] = value;
}

function setChangedValue(row, columnIndex, fieldName, value, changes) {
    if (columnIndex < 0) return;
    const cleanNextValue = cleanValue(value);
    if (row[columnIndex] === cleanNextValue) return;
    changes[fieldName] = {
        before: row[columnIndex],
        after: cleanNextValue,
        columnIndex
    };
    row[columnIndex] = cleanNextValue;
}

function rowHasTargetIdentity(row, indexes, siteIdIndex) {
    return Boolean(
        cleanValue(row[indexes.nameIndex])
        || cleanValue(row[indexes.stateIndex])
        || cleanValue(row[siteIdIndex])
    );
}

function syncTagCatalog({
    sourceEntries,
    targetHeaders,
    targetRows,
    today = new Date().toISOString().slice(0, 10),
    appendNew = true,
    removeMissing = true
}) {
    const rows = targetRows.map(row => targetHeaders.map((_, index) => cleanValue(row[index])));
    const originalRowCount = rows.length;
    const indexes = buildTargetIndexes(targetHeaders, rows);
    const jrBooksIndex = getHeaderIndex(targetHeaders, TARGET_COLUMNS.jrBooks);
    const specialProgramsIndex = getHeaderIndex(targetHeaders, TARGET_COLUMNS.specialPrograms);
    const siteInfoIndex = getHeaderIndex(targetHeaders, TARGET_COLUMNS.siteInfo);
    const historyTimelineInfoIndex = getHeaderIndex(targetHeaders, TARGET_COLUMNS.historyTimelineInfo);
    if (indexes.nameIndex < 0) throw new Error('Target sheet is missing a siteName/Location column.');
    if (indexes.stateIndex < 0) throw new Error('Target sheet is missing a state/State column.');
    if (jrBooksIndex < 0) throw new Error('Target sheet is missing a jrBooks column.');
    if (specialProgramsIndex < 0) throw new Error('Target sheet is missing a specialPrograms column.');

    const siteIdIndex = getHeaderIndex(targetHeaders, TARGET_COLUMNS.siteId);
    const usedIds = new Set(rows.map(row => cleanValue(row[siteIdIndex])).filter(Boolean));
    const updates = [];
    const appends = [];
    const skipped = [];
    const unchanged = [];
    const removals = [];
    const matchedTargetRows = new Set();

    sourceEntries.forEach(sourceEntry => {
        const payload = buildTagPayload(sourceEntry.tags);
        const match = findTargetRowIndex(sourceEntry, targetHeaders, rows, indexes);

        if (match.index > -1) {
            matchedTargetRows.add(match.index);
            const row = rows[match.index];
            const changes = {};
            setChangedValue(row, jrBooksIndex, 'jrBooks', payload.jrBooks, changes);
            setChangedValue(row, specialProgramsIndex, 'specialPrograms', payload.specialPrograms, changes);
            if (sourceEntry.siteInfo) setChangedValue(row, siteInfoIndex, 'siteInfo', sourceEntry.siteInfo, changes);
            if (sourceEntry.historyTimelineInfo) {
                setChangedValue(row, historyTimelineInfoIndex, 'historyTimelineInfo', sourceEntry.historyTimelineInfo, changes);
            }
            if (Object.keys(changes).length) {
                updates.push({ sourceEntry, rowIndex: match.index, row, match, changes });
            } else {
                unchanged.push({ sourceEntry, rowIndex: match.index, row, match });
            }
            return;
        }

        if (!appendNew) {
            skipped.push({ sourceEntry, reason: match.reason });
            return;
        }

        const newRow = makeBlankRow(targetHeaders);
        if (siteIdIndex > -1) newRow[siteIdIndex] = ensureUniqueSiteId(slugifySiteId(sourceEntry.name), usedIds);
        setIfColumn(newRow, targetHeaders, TARGET_COLUMNS.name, sourceEntry.name);
        setIfColumn(newRow, targetHeaders, TARGET_COLUMNS.state, sourceEntry.state);
        setIfColumn(newRow, targetHeaders, TARGET_COLUMNS.jrBooks, payload.jrBooks);
        setIfColumn(newRow, targetHeaders, TARGET_COLUMNS.specialPrograms, payload.specialPrograms);
        if (sourceEntry.siteInfo) setIfColumn(newRow, targetHeaders, TARGET_COLUMNS.siteInfo, sourceEntry.siteInfo);
        if (sourceEntry.historyTimelineInfo) {
            setIfColumn(newRow, targetHeaders, TARGET_COLUMNS.historyTimelineInfo, sourceEntry.historyTimelineInfo);
        }
        setIfColumn(newRow, targetHeaders, TARGET_COLUMNS.lastUpdated, today);
        rows.push(newRow);
        appends.push({ sourceEntry, row: newRow, reason: match.reason });
    });

    if (removeMissing) {
        for (let rowIndex = 0; rowIndex < originalRowCount; rowIndex++) {
            if (matchedTargetRows.has(rowIndex)) continue;
            const row = rows[rowIndex];
            if (!rowHasTargetIdentity(row, indexes, siteIdIndex)) continue;
            removals.push({ rowIndex, row });
        }
    }

    const removedIndexes = new Set(removals.map(removal => removal.rowIndex));
    const mirroredRows = rows.filter((_, rowIndex) => !removedIndexes.has(rowIndex));

    return { headers: targetHeaders, rows: mirroredRows, updates, appends, removals, skipped, unchanged };
}

module.exports = {
    TARGET_COLUMNS,
    buildSourceColumnMap,
    buildTagPayload,
    cleanValue,
    extractSourceEntriesFromGrid,
    findTargetRowIndex,
    getCellLink,
    getCellText,
    getHeaderIndex,
    normalizeName,
    normalizeState,
    slugifySiteId,
    syncTagCatalog,
    tokenScore
};
