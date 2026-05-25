/**
 * Junior Ranger Master Spreadsheet auto-fill helpers.
 *
 * Paste this file into the spreadsheet's Apps Script project, reload the sheet,
 * then run Junior Ranger Tools > Install auto-fill trigger once.
 *
 * Behavior:
 * - Watches column C for new place names.
 * - Fills blank F/G latitude/longitude cells from Google Maps geocoding.
 * - Fills blank H siteID cells with a stable unique ID.
 * - Never overwrites an existing siteID. Never overwrites existing lat/lng.
 * - If the site name changes later, existing F/G/H values stay untouched.
 */

const JR_AUTOFILL_CONFIG = Object.freeze({
  firstDataRow: 2,
  stateColumn: 1,
  agencyColorColumn: 2,
  placeColumn: 3,
  latitudeColumn: 6,
  longitudeColumn: 7,
  siteIdColumn: 8,
  idPrefix: 'jr',
  geocodeCountry: 'USA',
  geocodeRegion: 'us',
  maxRowsPerAutoEdit: 10,
  ignoredSheetNames: ['Canada', 'Color Coding', 'Reference', 'References', 'README', 'Read Me'],
  ignoredAgencyColors: ['#9900ff']
});

const JR_US_STATE_NAMES = Object.freeze([
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

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Junior Ranger Tools')
    .addItem('Install auto-fill trigger', 'installJuniorRangerAutoFillTrigger')
    .addSeparator()
    .addItem('Fill selected rows', 'fillSelectedJuniorRangerRows')
    .addItem('Fill active sheet missing rows', 'fillActiveJuniorRangerSheetMissingRows')
    .addToUi();
}

function onEdit(e) {
  juniorRangerAutoFillOnEdit(e);
}

function installJuniorRangerAutoFillTrigger() {
  const spreadsheet = SpreadsheetApp.getActive();
  const handler = 'juniorRangerAutoFillOnEdit';

  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === handler)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(handler)
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();

  spreadsheet.toast('Junior Ranger auto-fill trigger installed.', 'Junior Ranger Tools', 5);
}

function juniorRangerAutoFillOnEdit(e) {
  if (!e || !e.range) return;

  const range = e.range;
  const sheet = range.getSheet();
  const config = JR_AUTOFILL_CONFIG;
  const firstEditedColumn = range.getColumn();
  const lastEditedColumn = range.getLastColumn();
  if (firstEditedColumn > config.placeColumn || lastEditedColumn < config.placeColumn) return;
  if (!shouldProcessJuniorRangerSheet_(sheet)) return;

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(500)) return;

  try {
    const rowCount = Math.min(range.getNumRows(), config.maxRowsPerAutoEdit);
    fillJuniorRangerRows_(sheet, range.getRow(), range.getRow() + rowCount - 1, { toast: false });
  } finally {
    lock.releaseLock();
  }
}

function fillSelectedJuniorRangerRows() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getActiveSheet();
  if (!shouldProcessJuniorRangerSheet_(sheet)) {
    spreadsheet.toast('This tab is skipped by the Junior Ranger auto-fill config.', 'Junior Ranger Tools', 6);
    return;
  }

  const range = sheet.getActiveRange();
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    fillJuniorRangerRows_(sheet, range.getRow(), range.getLastRow(), { toast: true });
  } finally {
    lock.releaseLock();
  }
}

function fillActiveJuniorRangerSheetMissingRows() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getActiveSheet();
  if (!shouldProcessJuniorRangerSheet_(sheet)) {
    spreadsheet.toast('This tab is skipped by the Junior Ranger auto-fill config.', 'Junior Ranger Tools', 6);
    return;
  }

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    fillJuniorRangerRows_(sheet, JR_AUTOFILL_CONFIG.firstDataRow, sheet.getLastRow(), { toast: true });
  } finally {
    lock.releaseLock();
  }
}

function fillJuniorRangerRows_(sheet, firstRow, lastRow, options) {
  const config = JR_AUTOFILL_CONFIG;
  const spreadsheet = sheet.getParent();
  const startRow = Math.max(config.firstDataRow, firstRow);
  const endRow = Math.max(startRow, lastRow);
  let filledIds = 0;
  let filledCoordinates = 0;
  let skipped = 0;
  let errors = 0;

  for (let row = startRow; row <= endRow; row++) {
    const result = fillJuniorRangerRow_(sheet, row);
    if (result.idFilled) filledIds++;
    if (result.coordinatesFilled) filledCoordinates++;
    if (result.skipped) skipped++;
    if (result.error) errors++;
    Utilities.sleep(150);
  }

  if (options && options.toast) {
    spreadsheet.toast(
      `IDs: ${filledIds}, coordinates: ${filledCoordinates}, skipped: ${skipped}, errors: ${errors}`,
      'Junior Ranger auto-fill',
      8
    );
  }
}

function fillJuniorRangerRow_(sheet, row) {
  const config = JR_AUTOFILL_CONFIG;
  const placeCell = sheet.getRange(row, config.placeColumn);
  const placeName = cleanJuniorRangerValue_(placeCell.getDisplayValue());

  if (shouldSkipJuniorRangerPlaceRow_(sheet, row, placeName)) return { skipped: true };

  const stateName = getJuniorRangerStateForPlace_(sheet, row, placeName);
  const siteIdCell = sheet.getRange(row, config.siteIdColumn);
  const latitudeCell = sheet.getRange(row, config.latitudeColumn);
  const longitudeCell = sheet.getRange(row, config.longitudeColumn);
  const existingSiteId = cleanJuniorRangerValue_(siteIdCell.getDisplayValue());
  const existingLatitude = cleanJuniorRangerValue_(latitudeCell.getDisplayValue());
  const existingLongitude = cleanJuniorRangerValue_(longitudeCell.getDisplayValue());
  const result = { idFilled: false, coordinatesFilled: false, skipped: false, error: false };

  if (!existingSiteId) {
    const newSiteId = buildUniqueJuniorRangerSiteId_(sheet, row, stateName, placeName);
    siteIdCell.setValue(newSiteId);
    siteIdCell.setNote(`Generated by Junior Ranger auto-fill on ${new Date().toLocaleString()}. Do not overwrite this ID.`);
    result.idFilled = true;
  }

  if (!existingLatitude || !existingLongitude) {
    const query = buildJuniorRangerGeocodeQuery_(sheet, row, stateName, placeName);
    const geocode = geocodeJuniorRangerPlace_(query);
    if (!geocode) {
      latitudeCell.setNote(`Auto-fill could not geocode: ${query}`);
      longitudeCell.setNote(`Auto-fill could not geocode: ${query}`);
      result.error = true;
      return result;
    }

    if (!existingLatitude) {
      latitudeCell.setValue(geocode.lat);
      latitudeCell.setNumberFormat('0.0000000');
    }
    if (!existingLongitude) {
      longitudeCell.setValue(geocode.lng);
      longitudeCell.setNumberFormat('0.0000000');
    }

    const note = `Auto-generated from "${query}" on ${new Date().toLocaleString()}. Verify before publishing.`;
    latitudeCell.setNote(note);
    longitudeCell.setNote(note);
    result.coordinatesFilled = true;
  }

  return result;
}

function shouldProcessJuniorRangerSheet_(sheet) {
  const config = JR_AUTOFILL_CONFIG;
  const sheetName = cleanJuniorRangerValue_(sheet.getName()).toLowerCase();
  const ignored = config.ignoredSheetNames.map(name => name.toLowerCase());
  return ignored.indexOf(sheetName) === -1;
}

function shouldSkipJuniorRangerPlaceRow_(sheet, row, placeName) {
  if (!placeName) return true;
  if (row < JR_AUTOFILL_CONFIG.firstDataRow) return true;
  if (sourceTextLooksLikeHeader_(placeName)) return true;
  if (sourceTextLooksLikeStateList_(placeName)) return true;

  const background = sheet.getRange(row, JR_AUTOFILL_CONFIG.agencyColorColumn).getBackground().toLowerCase();
  return JR_AUTOFILL_CONFIG.ignoredAgencyColors.indexOf(background) !== -1;
}

function getJuniorRangerStateForRow_(sheet, row) {
  for (let currentRow = row; currentRow >= JR_AUTOFILL_CONFIG.firstDataRow; currentRow--) {
    const state = cleanJuniorRangerValue_(sheet.getRange(currentRow, JR_AUTOFILL_CONFIG.stateColumn).getDisplayValue());
    if (state) return state;
  }
  return cleanJuniorRangerValue_(sheet.getName());
}

function getJuniorRangerStateForPlace_(sheet, row, placeName) {
  return extractJuniorRangerExplicitState_(placeName) || getJuniorRangerStateForRow_(sheet, row);
}

function extractJuniorRangerExplicitState_(placeName) {
  const text = cleanJuniorRangerValue_(placeName);
  if (text.indexOf(',') === -1) return '';

  const stateText = normalizeJuniorRangerStateText_(text.split(',').pop());
  const matchedState = JR_US_STATE_NAMES.filter(state => state === stateText)[0];
  return matchedState ? toJuniorRangerTitleCase_(matchedState) : '';
}

function stripJuniorRangerExplicitState_(placeName) {
  const text = cleanJuniorRangerValue_(placeName);
  if (!extractJuniorRangerExplicitState_(text)) return text;
  return cleanJuniorRangerValue_(text.split(',').slice(0, -1).join(','));
}

function buildUniqueJuniorRangerSiteId_(sheet, row, stateName, placeName) {
  const spreadsheet = sheet.getParent();
  const displayName = stripJuniorRangerExplicitState_(buildJuniorRangerDisplayNameForRow_(sheet, row, placeName));
  const stateSlug = slugifyJuniorRangerIdPart_(stateName || sheet.getName());
  const placeSlug = slugifyJuniorRangerIdPart_(displayName);
  const baseId = `${JR_AUTOFILL_CONFIG.idPrefix}_${stateSlug}_${placeSlug || 'new_place'}`;
  const usedIds = collectExistingJuniorRangerSiteIds_(spreadsheet, sheet.getSheetId(), row);
  let candidate = baseId;
  let suffix = 2;

  while (usedIds[candidate]) {
    candidate = `${baseId}_${suffix}`;
    suffix++;
  }

  return candidate;
}

function collectExistingJuniorRangerSiteIds_(spreadsheet, currentSheetId, currentRow) {
  const config = JR_AUTOFILL_CONFIG;
  const used = {};

  spreadsheet.getSheets().forEach(sheet => {
    const lastRow = sheet.getLastRow();
    if (lastRow < config.firstDataRow) return;

    const values = sheet
      .getRange(config.firstDataRow, config.siteIdColumn, lastRow - config.firstDataRow + 1, 1)
      .getDisplayValues();

    values.forEach((rowValues, index) => {
      const rowNumber = config.firstDataRow + index;
      if (sheet.getSheetId() === currentSheetId && rowNumber === currentRow) return;
      const siteId = cleanJuniorRangerValue_(rowValues[0]);
      if (siteId) used[siteId] = true;
    });
  });

  return used;
}

function buildJuniorRangerGeocodeQuery_(sheet, row, stateName, placeName) {
  const displayName = stripJuniorRangerExplicitState_(buildJuniorRangerDisplayNameForRow_(sheet, row, placeName));
  return [displayName, stateName, JR_AUTOFILL_CONFIG.geocodeCountry]
    .map(cleanJuniorRangerValue_)
    .filter(Boolean)
    .join(', ');
}

function buildJuniorRangerDisplayNameForRow_(sheet, row, placeName) {
  if (!isParentheticalJuniorRangerValue_(placeName)) return placeName;

  const parentName = findPreviousJuniorRangerParentName_(sheet, row);
  const childName = stripJuniorRangerParentheses_(placeName);
  return parentName ? `${parentName} ${childName}` : childName;
}

function findPreviousJuniorRangerParentName_(sheet, row) {
  for (let currentRow = row - 1; currentRow >= JR_AUTOFILL_CONFIG.firstDataRow; currentRow--) {
    const value = cleanJuniorRangerValue_(sheet.getRange(currentRow, JR_AUTOFILL_CONFIG.placeColumn).getDisplayValue());
    if (!value || isParentheticalJuniorRangerValue_(value)) continue;
    if (sourceTextLooksLikeHeader_(value) || sourceTextLooksLikeStateList_(value)) continue;
    return value;
  }
  return '';
}

function geocodeJuniorRangerPlace_(query) {
  const response = Maps.newGeocoder()
    .setRegion(JR_AUTOFILL_CONFIG.geocodeRegion)
    .geocode(query);

  if (!response || response.status !== 'OK' || !response.results || !response.results.length) return null;

  const location = response.results[0].geometry && response.results[0].geometry.location;
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') return null;

  return {
    lat: location.lat,
    lng: location.lng,
    formattedAddress: response.results[0].formatted_address || ''
  };
}

function isParentheticalJuniorRangerValue_(value) {
  return /^\s*\([^)]+\)\s*$/.test(cleanJuniorRangerValue_(value));
}

function stripJuniorRangerParentheses_(value) {
  return cleanJuniorRangerValue_(value).replace(/^\(|\)$/g, '').trim();
}

function sourceTextLooksLikeHeader_(value) {
  const text = cleanJuniorRangerValue_(value).toLowerCase();
  return text.indexOf('master map') !== -1
    || text.indexOf('track trails') !== -1
    || text.indexOf('best contact') !== -1;
}

function sourceTextLooksLikeStateList_(value) {
  const text = normalizeJuniorRangerStateText_(value);
  if (JR_US_STATE_NAMES.indexOf(text) !== -1) return true;
  if (text.indexOf(',') === -1) return false;

  return text
    .split(',')
    .map(part => normalizeJuniorRangerStateText_(part))
    .filter(Boolean)
    .every(part => JR_US_STATE_NAMES.indexOf(part) !== -1);
}

function normalizeJuniorRangerStateText_(value) {
  return cleanJuniorRangerValue_(value)
    .toLowerCase()
    .replace(/\bd\.?c\.?\b/g, 'dc')
    .replace(/[^a-z0-9,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyJuniorRangerIdPart_(value) {
  return cleanJuniorRangerValue_(value)
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

function cleanJuniorRangerValue_(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n/g, '\n').trim();
}

function toJuniorRangerTitleCase_(value) {
  return cleanJuniorRangerValue_(value)
    .split(' ')
    .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
    .join(' ')
    .replace(/\bDc\b/g, 'DC');
}
