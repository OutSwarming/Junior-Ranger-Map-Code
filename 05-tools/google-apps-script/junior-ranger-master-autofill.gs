/**
 * Junior Ranger Master Spreadsheet auto-fill helpers.
 *
 * Paste this file into the spreadsheet's Apps Script project, reload the sheet,
 * then run Junior Ranger Tools > Install auto-fill trigger once.
 *
 * Behavior:
 * - Watches column C for new place names.
 * - Fills blank or non-coordinate F/G latitude/longitude cells from Google Maps geocoding.
 * - Fills blank H siteID cells with a stable unique ID.
 * - Never overwrites an existing siteID. Never overwrites existing numeric lat/lng.
 * - If the site name changes later, existing numeric F/G and H values stay untouched.
 */

const JR_AUTOFILL_CONFIG = Object.freeze({
  spreadsheetId: '1Twoq7MNwqGn49d9t2phdDThB5ufT1H2PqY9fmcZrs_8',
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

const JR_OVERNIGHT_CONFIG = Object.freeze({
  handler: 'continueJuniorRangerOvernightFill',
  activeKey: 'jrOvernightActive',
  sheetIndexKey: 'jrOvernightSheetIndex',
  rowKey: 'jrOvernightRow',
  startedAtKey: 'jrOvernightStartedAt',
  processedKey: 'jrOvernightProcessedRows',
  maxRuntimeMs: 4.5 * 60 * 1000
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

const JR_GEOCODE_FALLBACKS = Object.freeze([
  { match: 'steamtown nhs pennsylvania', lat: 41.4079601, lng: -75.6715545 },
  { match: 'steamtown national historic site pennsylvania', lat: 41.4079601, lng: -75.6715545 },
  { match: 'thaddeus kosciuszko nm pennsylvania', lat: 39.9434693, lng: -75.1473051 },
  { match: 'thaddeus kosciuszko national memorial pennsylvania', lat: 39.9434693, lng: -75.1473051 },
  { match: 'valley forge nhp pennsylvania', lat: 40.1006378, lng: -75.4444377 },
  { match: 'valley forge national historical park pennsylvania', lat: 40.1006378, lng: -75.4444377 },
  { match: 'erie nwr pennsylvania', lat: 41.7781949, lng: -79.9652103 },
  { match: 'erie national wildlife refuge pennsylvania', lat: 41.7781949, lng: -79.9652103 },
  { match: 'raystown lake pennsylvania', lat: 40.3362849, lng: -78.1458091 },
  { match: 'shenango river lake pennsylvania', lat: 41.3034013, lng: -80.4577645 },
  { match: 'gloria dei church national historic site pennsylvania', lat: 39.9345817, lng: -75.1438854 },
  { match: 'bartley ranch regional park nevada', lat: 39.46582, lng: -119.80445 },
  { match: 'wilbur d may arboretum nevada', lat: 39.5462, lng: -119.8253 },
  { match: 'new hampshire lake association new hampshire', lat: 43.2111415, lng: -71.496077 },
  { match: 'lost river gorge and boulder caves new hampshire', lat: 44.0372352, lng: -71.7837698 },
  { match: 'quincy bog natural area new hampshire', lat: 43.792608, lng: -71.7748117 },
  { match: 'glen canyon nra carl hayden visitor center', lat: 36.9357176, lng: -111.4858141 },
  { match: 'glen canyon nra glen canyon conservancy', lat: 36.9193756, lng: -111.4602113 },
  { match: 'glen canyon nra bullfrog visitor center', lat: 37.5287243, lng: -110.718687 },
  { match: 'glen canyon nra navajo bridge interpretive center', lat: 36.8181296, lng: -111.6334439 }
]);

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Junior Ranger Tools')
    .addItem('Install auto-fill trigger', 'installJuniorRangerAutoFillTrigger')
    .addSeparator()
    .addItem('Fill selected rows', 'fillSelectedJuniorRangerRows')
    .addItem('Fill active sheet missing rows', 'fillActiveJuniorRangerSheetMissingRows')
    .addItem('Fill AK/AS/AZ missing rows', 'fillRequestedJuniorRangerStateSheets')
    .addItem('Backfill AK/AS/AZ generated data', 'backfillGeneratedAkAsAzJuniorRangerRows')
    .addSeparator()
    .addItem('Start overnight all states', 'startJuniorRangerOvernightFill')
    .addItem('Continue overnight all states now', 'continueJuniorRangerOvernightFill')
    .addItem('Stop overnight all states', 'stopJuniorRangerOvernightFill')
    .addToUi();
}

function doGet(event) {
  const params = event && event.parameter ? event.parameter : {};
  const action = String(params.action || 'kick').toLowerCase();
  const result = action === 'start'
    ? startJuniorRangerOvernightFill({
      runNow: false,
      state: params.state || '',
      row: params.row || ''
    })
    : action === 'stop'
      ? stopJuniorRangerOvernightFill()
      : kickJuniorRangerOvernightFill();

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
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

function fillRequestedJuniorRangerStateSheets() {
  ['Alaska', 'American Samoa', 'Arizona'].forEach(sheetName => {
    fillJuniorRangerSheetMissingRowsByName(sheetName);
  });
}

function fillAlaskaJuniorRangerSheetMissingRows() {
  fillJuniorRangerSheetMissingRowsByName('Alaska');
}

function fillAmericanSamoaJuniorRangerSheetMissingRows() {
  fillJuniorRangerSheetMissingRowsByName('American Samoa');
}

function fillArizonaJuniorRangerSheetMissingRows() {
  fillJuniorRangerSheetMissingRowsByName('Arizona');
}

function fillJuniorRangerSheetMissingRowsByName(sheetName) {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Junior Ranger sheet not found: ${sheetName}`);
  if (!shouldProcessJuniorRangerSheet_(sheet)) throw new Error(`Junior Ranger sheet is skipped: ${sheetName}`);

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    fillJuniorRangerRows_(sheet, JR_AUTOFILL_CONFIG.firstDataRow, sheet.getLastRow(), { toast: true });
  } finally {
    lock.releaseLock();
  }
}

function backfillGeneratedAkAsAzJuniorRangerRows() {
  const spreadsheet = SpreadsheetApp.getActive();
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const result = backfillGeneratedJuniorRangerRows_(spreadsheet, JR_GENERATED_AK_AS_AZ_BACKFILL);
    spreadsheet.toast(
      `IDs: ${result.ids}, coordinates: ${result.coordinates}, skipped existing: ${result.skipped}, missing sheets: ${result.missingSheets}`,
      'Junior Ranger generated-data backfill',
      10
    );
  } finally {
    lock.releaseLock();
  }
}

function startJuniorRangerOvernightFill(options) {
  const shouldRunNow = !options || options.runNow !== false;
  const spreadsheet = getJuniorRangerSpreadsheet_();
  const properties = PropertiesService.getScriptProperties();
  const start = resolveJuniorRangerOvernightStart_(spreadsheet, options || {});

  properties.setProperties({
    [JR_OVERNIGHT_CONFIG.activeKey]: 'true',
    [JR_OVERNIGHT_CONFIG.sheetIndexKey]: String(start.sheetIndex),
    [JR_OVERNIGHT_CONFIG.rowKey]: String(start.row),
    [JR_OVERNIGHT_CONFIG.startedAtKey]: new Date().toISOString(),
    [JR_OVERNIGHT_CONFIG.processedKey]: '0'
  }, false);

  installJuniorRangerOvernightTrigger_();
  spreadsheet.toast(`Overnight all-state fill started at ${start.sheetName}. It will keep resuming itself.`, 'Junior Ranger Tools', 8);
  if (shouldRunNow) continueJuniorRangerOvernightFill();
  return getJuniorRangerOvernightStatus_();
}

function stopJuniorRangerOvernightFill() {
  PropertiesService.getScriptProperties().setProperty(JR_OVERNIGHT_CONFIG.activeKey, 'false');
  deleteJuniorRangerOvernightTriggers_();
  getJuniorRangerSpreadsheet_().toast('Overnight all-state fill stopped.', 'Junior Ranger Tools', 6);
  return getJuniorRangerOvernightStatus_();
}

function continueJuniorRangerOvernightFill() {
  const spreadsheet = getJuniorRangerSpreadsheet_();
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(JR_OVERNIGHT_CONFIG.activeKey) !== 'true') return;

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return;

  try {
    const startedAt = Date.now();
    const deadline = startedAt + JR_OVERNIGHT_CONFIG.maxRuntimeMs;
    const sheets = getJuniorRangerOvernightStateSheets_(spreadsheet);
    const usedIds = collectExistingJuniorRangerSiteIds_(spreadsheet);
    let sheetIndex = Number(properties.getProperty(JR_OVERNIGHT_CONFIG.sheetIndexKey) || 0);
    let row = Number(properties.getProperty(JR_OVERNIGHT_CONFIG.rowKey) || JR_AUTOFILL_CONFIG.firstDataRow);
    let processedRows = Number(properties.getProperty(JR_OVERNIGHT_CONFIG.processedKey) || 0);
    let filledIds = 0;
    let filledCoordinates = 0;
    let skipped = 0;
    let errors = 0;
    let consecutiveGeocodeErrors = 0;

    while (sheetIndex < sheets.length && Date.now() < deadline) {
      const sheet = sheets[sheetIndex];
      const lastRow = sheet.getLastRow();
      if (row < JR_AUTOFILL_CONFIG.firstDataRow) row = JR_AUTOFILL_CONFIG.firstDataRow;

      while (row <= lastRow && Date.now() < deadline) {
        if (properties.getProperty(JR_OVERNIGHT_CONFIG.activeKey) !== 'true') return;
        try {
          const result = fillJuniorRangerRow_(sheet, row, { usedIds });
          if (result.idFilled) filledIds++;
          if (result.coordinatesFilled) filledCoordinates++;
          if (result.skipped) skipped++;
          if (result.error) errors++;
          if (result.rateLimited) {
            properties.setProperty(JR_OVERNIGHT_CONFIG.sheetIndexKey, String(sheetIndex));
            properties.setProperty(JR_OVERNIGHT_CONFIG.rowKey, String(row));
            properties.setProperty(JR_OVERNIGHT_CONFIG.processedKey, String(processedRows));
            installJuniorRangerOvernightTrigger_();
            spreadsheet.toast(
              `Paused at ${sheet.getName()} row ${row}; Google geocoding is rate-limited/transiently unavailable.`,
              'Junior Ranger overnight fill',
              10
            );
            return;
          }

          if (result.error && result.geocodeAttempted) {
            consecutiveGeocodeErrors++;
          } else if (result.geocodeAttempted || result.coordinatesFilled) {
            consecutiveGeocodeErrors = 0;
          }
          if (result.geocodeAttempted) Utilities.sleep(1000);
        } catch (error) {
          errors++;
          consecutiveGeocodeErrors++;
          sheet.getRange(row, JR_AUTOFILL_CONFIG.siteIdColumn)
            .setNote(`Overnight auto-fill error on ${new Date().toLocaleString()}: ${error && error.message ? error.message : error}`);
        }

        if (consecutiveGeocodeErrors >= 5) {
          row++;
          processedRows++;
          properties.setProperty(JR_OVERNIGHT_CONFIG.sheetIndexKey, String(sheetIndex));
          properties.setProperty(JR_OVERNIGHT_CONFIG.rowKey, String(row));
          properties.setProperty(JR_OVERNIGHT_CONFIG.processedKey, String(processedRows));
          installJuniorRangerOvernightTrigger_();
          spreadsheet.toast(
            `Skipped past a hard geocode row in ${sheet.getName()}; overnight fill will keep moving.`,
            'Junior Ranger overnight fill',
            10
          );
          return;
        }

        row++;
        processedRows++;

        if (processedRows % 10 === 0) {
          properties.setProperty(JR_OVERNIGHT_CONFIG.sheetIndexKey, String(sheetIndex));
          properties.setProperty(JR_OVERNIGHT_CONFIG.rowKey, String(row));
          properties.setProperty(JR_OVERNIGHT_CONFIG.processedKey, String(processedRows));
        }
      }

      if (row > lastRow) {
        sheetIndex++;
        row = JR_AUTOFILL_CONFIG.firstDataRow;
      }
    }

    properties.setProperty(JR_OVERNIGHT_CONFIG.sheetIndexKey, String(sheetIndex));
    properties.setProperty(JR_OVERNIGHT_CONFIG.rowKey, String(row));
    properties.setProperty(JR_OVERNIGHT_CONFIG.processedKey, String(processedRows));

    if (sheetIndex >= sheets.length) {
      properties.setProperty(JR_OVERNIGHT_CONFIG.activeKey, 'false');
      deleteJuniorRangerOvernightTriggers_();
      spreadsheet.toast(
        `All state tabs finished. IDs: ${filledIds}, coordinates: ${filledCoordinates}, skipped: ${skipped}, errors: ${errors}`,
        'Junior Ranger overnight fill',
        10
      );
      return;
    }

    installJuniorRangerOvernightTrigger_();
    spreadsheet.toast(
      `Paused at ${sheets[sheetIndex].getName()} row ${row}. IDs: ${filledIds}, coordinates: ${filledCoordinates}, skipped: ${skipped}, errors: ${errors}`,
      'Junior Ranger overnight fill',
      8
    );
  } finally {
    lock.releaseLock();
  }
}

function kickJuniorRangerOvernightFill() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(JR_OVERNIGHT_CONFIG.activeKey) !== 'true') {
    return startJuniorRangerOvernightFill({ runNow: false });
  }

  installJuniorRangerOvernightTrigger_();
  return getJuniorRangerOvernightStatus_();
}

function getJuniorRangerOvernightStatus_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheet = getJuniorRangerSpreadsheet_();
  const sheets = getJuniorRangerOvernightStateSheets_(spreadsheet);
  const sheetIndex = Number(properties.getProperty(JR_OVERNIGHT_CONFIG.sheetIndexKey) || 0);
  return {
    active: properties.getProperty(JR_OVERNIGHT_CONFIG.activeKey) === 'true',
    sheetIndex,
    sheetName: sheets[sheetIndex] ? sheets[sheetIndex].getName() : null,
    row: Number(properties.getProperty(JR_OVERNIGHT_CONFIG.rowKey) || JR_AUTOFILL_CONFIG.firstDataRow),
    processedRows: Number(properties.getProperty(JR_OVERNIGHT_CONFIG.processedKey) || 0),
    startedAt: properties.getProperty(JR_OVERNIGHT_CONFIG.startedAtKey) || null
  };
}

function resolveJuniorRangerOvernightStart_(spreadsheet, options) {
  const sheets = getJuniorRangerOvernightStateSheets_(spreadsheet);
  const requestedState = cleanJuniorRangerValue_(options.state);
  let sheetIndex = 0;

  if (requestedState) {
    const requestedKey = normalizeJuniorRangerStateText_(requestedState).replace(/,/g, '');
    sheetIndex = sheets.findIndex(sheet => (
      normalizeJuniorRangerStateText_(sheet.getName()).replace(/,/g, '') === requestedKey
    ));
    if (sheetIndex === -1) {
      throw new Error(`Junior Ranger state sheet not found: ${requestedState}`);
    }
  }

  const requestedRow = Number(options.row);
  const row = Number.isFinite(requestedRow) && requestedRow >= JR_AUTOFILL_CONFIG.firstDataRow
    ? Math.floor(requestedRow)
    : JR_AUTOFILL_CONFIG.firstDataRow;

  return {
    sheetIndex,
    row,
    sheetName: sheets[sheetIndex] ? sheets[sheetIndex].getName() : 'unknown sheet'
  };
}

function getJuniorRangerSpreadsheet_() {
  return SpreadsheetApp.getActive() || SpreadsheetApp.openById(JR_AUTOFILL_CONFIG.spreadsheetId);
}

function backfillGeneratedJuniorRangerRows_(spreadsheet, payload) {
  const config = JR_AUTOFILL_CONFIG;
  const note = `Generated by Junior Ranger generated-data backfill on ${new Date().toLocaleString()}. Do not overwrite this ID.`;
  const coordinateNote = `Generated by Junior Ranger generated-data backfill on ${new Date().toLocaleString()}. Verify before publishing.`;
  const result = { ids: 0, coordinates: 0, skipped: 0, missingSheets: 0 };

  payload.forEach(sheetPayload => {
    const sheet = spreadsheet.getSheetByName(sheetPayload.sheetName);
    if (!sheet) {
      result.missingSheets++;
      return;
    }

    sheetPayload.rows.forEach(rowPayload => {
      const row = rowPayload[0];
      const latitude = rowPayload[1];
      const longitude = rowPayload[2];
      const siteId = rowPayload[3];
      const siteIdCell = sheet.getRange(row, config.siteIdColumn);
      const latitudeCell = sheet.getRange(row, config.latitudeColumn);
      const longitudeCell = sheet.getRange(row, config.longitudeColumn);
      const existingSiteId = cleanJuniorRangerValue_(siteIdCell.getDisplayValue());
      const existingLatitude = cleanJuniorRangerValue_(latitudeCell.getDisplayValue());
      const existingLongitude = cleanJuniorRangerValue_(longitudeCell.getDisplayValue());
      const canUseCoordinates = Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && !(latitude === 0 && longitude === 0);
      let changed = false;

      if (!existingSiteId && siteId) {
        siteIdCell.setValue(siteId);
        siteIdCell.setNote(note);
        result.ids++;
        changed = true;
      }

      if (canUseCoordinates) {
        let coordinateChanged = false;
        if (!isFiniteJuniorRangerCoordinate_(existingLatitude)) {
          latitudeCell.setValue(latitude);
          latitudeCell.setNumberFormat('0.0000000');
          latitudeCell.setNote(coordinateNote);
          coordinateChanged = true;
        }
        if (!isFiniteJuniorRangerCoordinate_(existingLongitude)) {
          longitudeCell.setValue(longitude);
          longitudeCell.setNumberFormat('0.0000000');
          longitudeCell.setNote(coordinateNote);
          coordinateChanged = true;
        }
        if (coordinateChanged) {
          result.coordinates++;
          changed = true;
        }
      }

      if (!changed) result.skipped++;
    });
  });

  return result;
}

const JR_GENERATED_AK_AS_AZ_BACKFILL = Object.freeze([
  {
    sheetName: 'Alaska',
    rows: Object.freeze([
      [2, 62.5384731, -153.6033115, 'jr_alaska_national_historic_landmarks_of_alaska'],
      [3, 59.0553804, -155.8344633, 'jr_alaska_alagnak_wild_river'],
      [4, 61.2193166, -149.8911685, 'jr_alaska_alaska_public_lands'],
      [6, 63.3362871, -142.9838831, 'jr_alaska_alaska_public_lands_information_center'],
      [12, 53.894564, -166.5402173, 'jr_alaska_aleutian_islands_ww2_nha'],
      [13, 56.9017817, -158.106723, 'jr_alaska_aniakchak_nm_and_pr'],
      [14, 65.9137073, -164.1740479, 'jr_alaska_bering_land_bridge_npr'],
      [17, 67.3907184, -163.5346766, 'jr_alaska_cape_krusenstern_nm'],
      [20, 62.5384731, -153.6033115, 'jr_alaska_chilkoot_nht'],
      [21, 63.7293678, -148.8881876, 'jr_alaska_denali_np_and_pr'],
      [27, 61.2348552, -149.2745742, 'jr_alaska_eagle_river_nature_center'],
      [28, 66.8661186, -155.1351697, 'jr_alaska_gates_of_the_arctic_np_and_pr'],
      [29, 59.1303386, -138.370026, 'jr_alaska_glacier_bay_np_and_pr'],
      [37, 71.2982391, -156.7539226, 'jr_alaska_i_upiat_heritage_center'],
      [39, 58.6929642, -156.6678167, 'jr_alaska_katmai_np_and_pr'],
      [41, 59.8685631, -150.0257714, 'jr_alaska_kenai_fjords_np'],
      [44, 59.592312, -135.1591765, 'jr_alaska_klondike_gold_rush_nhp'],
      [45, 67.3898231, -159.0574319, 'jr_alaska_kobuk_valley_np'],
      [48, 60.6609364, -154.1872833, 'jr_alaska_lake_clark_np_and_pr'],
      [49, 58.5049844, -155.0896226, 'jr_alaska_noatak_np'],
      [52, 57.0484454, -135.3151735, 'jr_alaska_sitka_nhp'],
      [54, 0, 0, 'jr_alaska_western_arctic_national_parklands'],
      [57, 63.7347574, -148.8851355, 'jr_alaska_wrangell_st_elias_np_and_pr'],
      [59, 65.0522811, -143.1506099, 'jr_alaska_yukon_charley_rivers_npr'],
      [60, 54.7216416, -164.04026, 'jr_alaska_alaska_maritime_nwr'],
      [63, 55.3513427, -162.3497099, 'jr_alaska_izembek_nwr'],
      [64, 60.3590565, -150.5129076, 'jr_alaska_kenai_nwr'],
      [66, 57.3194943, -154.2592713, 'jr_alaska_kodiak_nwr'],
      [68, 66.4911961, -157.9540786, 'jr_alaska_selawik_nwr'],
      [69, 62.8217642, -141.7775432, 'jr_alaska_tetlin_nwr'],
      [70, 61.6780478, -163.6362703, 'jr_alaska_yukon_delta_nwr'],
      [71, 61.1641151, -149.7773627, 'jr_alaska_campbell_creek_science_center'],
      [73, 62.5668681, -153.638578, 'jr_alaska_iditarod_nht'],
      [80, 60.406997, -149.3709132, 'jr_alaska_chugach_nf'],
      [84, 58.3742477, -134.7283964, 'jr_alaska_tongass_nf'],
      [85, 55.340671, -131.6440472, 'jr_alaska_tongass_nf_mendenhall_glacier_visitor_center'],
      [86, 55.340671, -131.6440472, 'jr_alaska_tongass_nf_southeast_alaska_discovery_center'],
      [89, 61.61218, -149.2641742, 'jr_alaska_alaska_sp'],
      [90, 59.5555336, -151.2317446, 'jr_alaska_kachemak_bay_sp'],
      [91, 57.0497415, -135.3235231, 'jr_alaska_sitka_sound_science_center']
    ])
  },
  {
    sheetName: 'American Samoa',
    rows: Object.freeze([
      [2, -14.2491297, -169.4490402, 'jr_american_samoa_np_of_american_samoa']
    ])
  },
  {
    sheetName: 'Arizona',
    rows: Object.freeze([
      [25, 36.1433502, -109.4416431, 'jr_arizona_canyon_de_chelly_nm'],
      [26, 32.9970473, -111.532647, 'jr_arizona_casa_grande_ruins_nm'],
      [29, 32.0139728, -109.3475406, 'jr_arizona_chiricahua_nm'],
      [32, 32.0081745, -112.8751837, 'jr_arizona_coronado_nm'],
      [34, 32.1492281, -109.448188, 'jr_arizona_fort_bowie_nhs'],
      [36, 36.3078548, -112.292896, 'jr_arizona_grand_canyon_np'],
      [43, 35.7054644, -109.5621725, 'jr_arizona_hubbell_trading_post_nhs'],
      [46, 36.6842583, -110.5362587, 'jr_arizona_navajo_nm'],
      [50, 34.6130884, -111.8366661, 'jr_arizona_montezuma_castle_nm'],
      [55, 32.0081745, -112.8751837, 'jr_arizona_organ_pipe_cactus_nm'],
      [58, 34.9744769, -109.7079943, 'jr_arizona_petrified_forest_np'],
      [61, 36.8628269, -112.7398568, 'jr_arizona_pipe_spring_nm'],
      [63, 32.1683758, -110.6183452, 'jr_arizona_saguaro_np'],
      [69, 35.3711545, -111.5113228, 'jr_arizona_sunset_crater_volcano_nm'],
      [70, 33.6469254, -111.1135531, 'jr_arizona_tonto_nm'],
      [74, 31.5722717, -111.0476323, 'jr_arizona_tumacacori_nhp'],
      [79, 34.7733961, -112.0287689, 'jr_arizona_tuzigoot_nm'],
      [82, 35.1793072, -111.4514117, 'jr_arizona_walnut_canyon_nm'],
      [83, 35.5649504, -111.4058508, 'jr_arizona_wupatki_nm'],
      [84, 32.232561, -113.4428434, 'jr_arizona_cabeza_pieta_nwr'],
      [85, 34.229193, -112.0481376, 'jr_arizona_agua_fria_nm'],
      [86, 32.8858151, -110.5112851, 'jr_arizona_aravaipa_canyon_wilderness'],
      [87, 35.943238, -111.9941088, 'jr_arizona_baaj_nwaavjo_i_tah_kukveni_ancestral_footprints_of_the_grand_canyon_nm'],
      [88, 32.9664309, -109.3661379, 'jr_arizona_gila_box_riparian_nca'],
      [89, 33.2941556, -112.1712936, 'jr_arizona_gila_district'],
      [90, 36.3012547, -113.6066795, 'jr_arizona_grand_canyon_parashant_nm'],
      [91, 0, 0, 'jr_arizona_tori_tortoise_turns_100'],
      [92, 32.4449519, -111.6521277, 'jr_arizona_ironwood_forest_nm'],
      [93, 31.7830866, -110.6048063, 'jr_arizona_las_cienegas_nca'],
      [94, 31.635569, -110.1782455, 'jr_arizona_san_pedro_riparian_nca'],
      [95, 0, 0, 'jr_arizona_sonoran_desert_nm_phoenix_district_office'],
      [96, 36.8435814, -111.8614392, 'jr_arizona_vermilion_cliffs_nm'],
      [97, 33.8551963, -109.3340994, 'jr_arizona_apache_sitgreaves_nf'],
      [98, 36.0338766, -112.1258379, 'jr_arizona_arizona_trail_nst'],
      [99, 31.4805057, -111.2511598, 'jr_arizona_coronado_nf'],
      [100, 34.6666888, -111.8340412, 'jr_arizona_red_rock_ranger_district_coconino_nf'],
      [101, 33.8155607, -111.5630278, 'jr_arizona_tonto_nf'],
      [102, 34.2454342, -113.5691531, 'jr_arizona_alamo_lake_sp'],
      [103, 34.2569337, -114.1623861, 'jr_arizona_buckskin_mountain_sp'],
      [104, 32.4333938, -110.9134124, 'jr_arizona_catalina_sp'],
      [105, 34.3611477, -114.1683168, 'jr_arizona_cattail_cove_sp'],
      [106, 34.7531566, -112.0148947, 'jr_arizona_dead_horse_ranch_sp'],
      [107, 34.2741371, -110.0652515, 'jr_arizona_fool_hollow_lake_ra'],
      [109, 34.5650694, -111.8524712, 'jr_arizona_fort_verde_shp'],
      [110, 35.0626764, -110.6683958, 'jr_arizona_homolovi_sp'],
      [111, 34.7536722, -112.111326, 'jr_arizona_jerome_shp'],
      [113, 31.8399478, -110.3504702, 'jr_arizona_kartchner_caverns_sp'],
      [116, 34.4358461, -114.2855087, 'jr_arizona_lake_havasu_sp'],
      [117, 33.4562079, -111.4812217, 'jr_arizona_lost_dutchman_sp'],
      [118, 34.3630959, -109.3748173, 'jr_arizona_lyman_lake_sp'],
      [119, 31.6117539, -111.046603, 'jr_arizona_mcfarland_shp'],
      [120, 32.6201043, -110.7271229, 'jr_arizona_oracle_sp'],
      [121, 31.4955002, -110.8539082, 'jr_arizona_patagonia_lake_sp'],
      [122, 32.6392761, -111.405127, 'jr_arizona_picacho_peak_sp'],
      [123, 34.8113281, -111.8288256, 'jr_arizona_red_rock_sp'],
      [124, 35.1875666, -111.6593657, 'jr_arizona_riordan_mansion_shp'],
      [125, 34.5843754, -109.863391, 'jr_arizona_rockin_river_ranch_sp'],
      [126, 32.7549676, -109.7046532, 'jr_arizona_roper_lake_sp'],
      [127, 34.9438461, -111.7531926, 'jr_arizona_slide_rock_sp'],
      [128, 31.7121866, -110.0689586, 'jr_arizona_tombstone_courthouse_shp'],
      [129, 34.32284, -111.4538608, 'jr_arizona_tonto_natural_bridge_sp'],
      [130, 31.6117539, -111.046603, 'jr_arizona_tubac_presidio_shp'],
      [133, 32.7274006, -114.6229134, 'jr_arizona_yuma_quartermaster_depot_shp'],
      [134, 32.7268231, -114.6144703, 'jr_arizona_yuma_territorial_prison_shp'],
      [135, 38.7891321, -121.2448717, 'jr_arizona_city_of_peoria_parks_and_recreation'],
      [136, 34.5376745, -112.2462472, 'jr_arizona_city_of_prescott'],
      [137, 31.9600505, -111.5980625, 'jr_arizona_kitt_peak_national_observatory_visitor_center'],
      [138, 35.2016874, -111.665276, 'jr_arizona_lowell_observatory'],
      [139, 33.9090988, -84.5846474, 'jr_arizona_maricopa_county_parks_and_recreation'],
      [140, 36.9967542, -110.1028562, 'jr_arizona_monument_valley_navajo_tribal_park'],
      [141, 31.4618666, -110.1850769, 'jr_arizona_sky_island_alliance'],
      [142, 33.3220647, -112.3535591, 'jr_arizona_estrella_mountain_regional_park'],
      [143, 33.4942189, -111.926018, 'jr_arizona_city_of_scottsdale'],
      [144, 33.8590011, -109.1698232, 'jr_arizona_san_francisco_river_of_eastern_arizona'],
      [145, 31.9026682, -110.999218, 'jr_arizona_titan_missile_museum_nhl'],
      [146, 37.3867256, -110.8424257, 'jr_across_glen_canyon_nra'],
      [147, 36.9357176, -111.4858141, 'jr_across_glen_canyon_nra_carl_hayden_visitor_center'],
      [148, 36.9193756, -111.4602113, 'jr_across_glen_canyon_nra_glen_canyon_conservancy'],
      [149, 37.5287243, -110.718687, 'jr_across_glen_canyon_nra_bullfrog_visitor_center'],
      [150, 36.8181296, -111.6334439, 'jr_across_glen_canyon_nra_navajo_bridge_interpretive_center']
    ])
  }
]);

function fillJuniorRangerRows_(sheet, firstRow, lastRow, options) {
  const config = JR_AUTOFILL_CONFIG;
  const spreadsheet = sheet.getParent();
  const startRow = Math.max(config.firstDataRow, firstRow);
  const endRow = Math.max(startRow, lastRow);
  const usedIds = collectExistingJuniorRangerSiteIds_(spreadsheet);
  let filledIds = 0;
  let filledCoordinates = 0;
  let skipped = 0;
  let errors = 0;

  for (let row = startRow; row <= endRow; row++) {
    const result = fillJuniorRangerRow_(sheet, row, { usedIds });
    if (result.idFilled) filledIds++;
    if (result.coordinatesFilled) filledCoordinates++;
    if (result.skipped) skipped++;
    if (result.error) errors++;
    if (result.geocodeAttempted) Utilities.sleep(1000);
  }

  if (options && options.toast) {
    spreadsheet.toast(
      `IDs: ${filledIds}, coordinates: ${filledCoordinates}, skipped: ${skipped}, errors: ${errors}`,
      'Junior Ranger auto-fill',
      8
    );
  }
}

function fillJuniorRangerRow_(sheet, row, context) {
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
  const hasLatitude = isFiniteJuniorRangerCoordinate_(existingLatitude);
  const hasLongitude = isFiniteJuniorRangerCoordinate_(existingLongitude);
  const result = {
    idFilled: false,
    coordinatesFilled: false,
    skipped: false,
    error: false,
    geocodeAttempted: false,
    rateLimited: false
  };

  if (!hasLatitude || !hasLongitude) {
    const query = buildJuniorRangerGeocodeQuery_(sheet, row, stateName, placeName);
    result.geocodeAttempted = true;
    const geocode = geocodeJuniorRangerPlace_(query);
    if (geocode && geocode.rateLimited) {
      const note = `Auto-fill paused because Google geocoding returned ${geocode.status || 'a transient/rate-limit status'} for: ${query}`;
      latitudeCell.setNote(note);
      longitudeCell.setNote(note);
      result.error = true;
      result.rateLimited = true;
      return result;
    }

    if (!geocode) {
      latitudeCell.setNote(`Auto-fill could not geocode: ${query}`);
      longitudeCell.setNote(`Auto-fill could not geocode: ${query}`);
      result.error = true;
      return result;
    }

    if (!hasLatitude) {
      latitudeCell.setValue(geocode.lat);
      latitudeCell.setNumberFormat('0.0000000');
    }
    if (!hasLongitude) {
      longitudeCell.setValue(geocode.lng);
      longitudeCell.setNumberFormat('0.0000000');
    }

    const note = `Auto-generated from "${query}" on ${new Date().toLocaleString()}. Verify before publishing.`;
    latitudeCell.setNote(note);
    longitudeCell.setNote(note);
    result.coordinatesFilled = true;
  }

  if (!existingSiteId) {
    const newSiteId = buildUniqueJuniorRangerSiteId_(sheet, row, stateName, placeName, context && context.usedIds);
    siteIdCell.setValue(newSiteId);
    siteIdCell.setNote(`Generated by Junior Ranger auto-fill on ${new Date().toLocaleString()}. Do not overwrite this ID.`);
    if (context && context.usedIds) context.usedIds[newSiteId] = true;
    result.idFilled = true;
  }

  return result;
}

function shouldProcessJuniorRangerSheet_(sheet) {
  const config = JR_AUTOFILL_CONFIG;
  const sheetName = cleanJuniorRangerValue_(sheet.getName()).toLowerCase();
  const ignored = config.ignoredSheetNames.map(name => name.toLowerCase());
  return ignored.indexOf(sheetName) === -1;
}

function getJuniorRangerOvernightStateSheets_(spreadsheet) {
  return spreadsheet.getSheets()
    .filter(sheet => shouldProcessJuniorRangerSheet_(sheet))
    .filter(sheet => isJuniorRangerStateSheetName_(sheet.getName()));
}

function isJuniorRangerStateSheetName_(sheetName) {
  const normalized = normalizeJuniorRangerStateText_(sheetName);
  const withoutCommas = normalized.replace(/,/g, '');
  return JR_US_STATE_NAMES.indexOf(normalized) !== -1
    || JR_US_STATE_NAMES.indexOf(withoutCommas) !== -1
    || withoutCommas === 'washington dc';
}

function installJuniorRangerOvernightTrigger_() {
  deleteJuniorRangerOvernightTriggers_();
  ScriptApp.newTrigger(JR_OVERNIGHT_CONFIG.handler)
    .timeBased()
    .everyMinutes(1)
    .create();
}

function deleteJuniorRangerOvernightTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === JR_OVERNIGHT_CONFIG.handler)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
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

function buildUniqueJuniorRangerSiteId_(sheet, row, stateName, placeName, usedIds) {
  const displayName = stripJuniorRangerExplicitState_(buildJuniorRangerDisplayNameForRow_(sheet, row, placeName));
  const stateSlug = slugifyJuniorRangerIdPart_(stateName || sheet.getName());
  const placeSlug = slugifyJuniorRangerIdPart_(displayName);
  const baseId = `${JR_AUTOFILL_CONFIG.idPrefix}_${stateSlug}_${placeSlug || 'new_place'}`;
  usedIds = usedIds || collectExistingJuniorRangerSiteIds_(sheet.getParent());
  let candidate = baseId;
  let suffix = 2;

  while (usedIds[candidate]) {
    candidate = `${baseId}_${suffix}`;
    suffix++;
  }

  return candidate;
}

function collectExistingJuniorRangerSiteIds_(spreadsheet) {
  const config = JR_AUTOFILL_CONFIG;
  const used = {};

  spreadsheet.getSheets().forEach(sheet => {
    const lastRow = sheet.getLastRow();
    if (lastRow < config.firstDataRow) return;

    const values = sheet
      .getRange(config.firstDataRow, config.siteIdColumn, lastRow - config.firstDataRow + 1, 1)
      .getDisplayValues();

    values.forEach((rowValues, index) => {
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
  const queries = buildJuniorRangerGeocodeQueries_(query);

  for (let index = 0; index < queries.length; index++) {
    const fallback = findJuniorRangerGeocodeFallback_(queries[index]);
    if (fallback) return fallback;

    let response;
    try {
      response = Maps.newGeocoder()
        .setRegion(JR_AUTOFILL_CONFIG.geocodeRegion)
        .geocode(queries[index]);
    } catch (error) {
      return {
        rateLimited: true,
        status: error && error.message ? error.message : 'GEOCODER_EXCEPTION'
      };
    }

    if (!response || response.status !== 'OK') {
      const status = response && response.status ? response.status : 'NO_RESPONSE';
      if (status !== 'ZERO_RESULTS') {
        return {
          rateLimited: true,
          status
        };
      }
      continue;
    }
    if (!response.results || !response.results.length) continue;

    const location = response.results[0].geometry && response.results[0].geometry.location;
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') continue;

    return {
      lat: location.lat,
      lng: location.lng,
      formattedAddress: response.results[0].formatted_address || ''
    };
  }

  return null;
}

function buildJuniorRangerGeocodeQueries_(query) {
  const queries = [];

  addUniqueJuniorRangerGeocodeQuery_(queries, query);
  buildJuniorRangerGeocodeExpansionVariants_(query)
    .forEach(expanded => addUniqueJuniorRangerGeocodeQuery_(queries, expanded));

  return queries;
}

function addUniqueJuniorRangerGeocodeQuery_(queries, query) {
  const cleanQuery = cleanJuniorRangerValue_(query);
  if (cleanQuery && queries.indexOf(cleanQuery) === -1) queries.push(cleanQuery);
}

function buildJuniorRangerGeocodeExpansionVariants_(query) {
  const expanded = expandJuniorRangerGeocodeAcronyms_(query);
  const variants = [expanded];

  if (/\bNM\b/.test(query)) {
    variants.push(expanded.replace(/National Monument/g, 'National Memorial'));
  }
  if (/\bNR\b/.test(query)) {
    variants.push(expanded.replace(/Nature Reserve/g, 'National River'));
  }
  if (/\bS&RR\b/.test(query)) {
    variants.push(expanded.replace(/\bS&RR\b/g, 'Scenic and Recreational River'));
  }

  return variants;
}

function expandJuniorRangerGeocodeAcronyms_(query) {
  return cleanJuniorRangerValue_(query)
    .replace(/\bNGP\b/g, 'National Game Preserve')
    .replace(/\bNFWR\b/g, 'National Fish and Wildlife Refuge')
    .replace(/\bNWR\b/g, 'National Wildlife Refuge')
    .replace(/\bNF\b/g, 'National Forest')
    .replace(/\bNR\b/g, 'Nature Reserve')
    .replace(/\bNHT\b/g, 'National Historic Trail')
    .replace(/\bNST\b/g, 'National Scenic Trail')
    .replace(/\bNHP\b/g, 'National Historical Park')
    .replace(/\bNHS\b/g, 'National Historic Site')
    .replace(/\bNHA\b/g, 'National Heritage Area')
    .replace(/\bNCA\b/g, 'National Conservation Area')
    .replace(/\bNRA\b/g, 'National Recreation Area')
    .replace(/\bNMP\b/g, 'National Military Park')
    .replace(/\bNBP\b/g, 'National Battlefield Park')
    .replace(/\bNB\b/g, 'National Battlefield')
    .replace(/\bNL\b/g, 'National Lakeshore')
    .replace(/\bNSR\b/g, 'National Scenic River')
    .replace(/\bNWSR\b/g, 'National Wild and Scenic River')
    .replace(/\bWSR\b/g, 'Wild and Scenic River')
    .replace(/\bNS\b/g, 'National Seashore')
    .replace(/\bNPr\b/g, 'National Preserve')
    .replace(/\bNP\b/g, 'National Park')
    .replace(/\bNM\b/g, 'National Monument')
    .replace(/\bMP\b/g, 'Memorial Parkway')
    .replace(/\bSP\b/g, 'State Park')
    .replace(/\bSHP\b/g, 'State Historic Park')
    .replace(/\bSHS\b/g, 'State Historic Site')
    .replace(/\bHP\b/g, 'Historic Park')
    .replace(/\bRA\b/g, 'Recreation Area')
    .replace(/\bSRA\b/g, 'State Recreation Area');
}

function findJuniorRangerGeocodeFallback_(query) {
  const normalizedQuery = normalizeJuniorRangerGeocodeText_(query);

  for (let index = 0; index < JR_GEOCODE_FALLBACKS.length; index++) {
    const fallback = JR_GEOCODE_FALLBACKS[index];
    if (normalizedQuery.indexOf(fallback.match) === -1) continue;

    return {
      lat: fallback.lat,
      lng: fallback.lng,
      formattedAddress: `Manual fallback for ${fallback.match}`
    };
  }

  return null;
}

function normalizeJuniorRangerGeocodeText_(value) {
  return cleanJuniorRangerValue_(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function isFiniteJuniorRangerCoordinate_(value) {
  const text = cleanJuniorRangerValue_(value);
  if (!text) return false;
  return Number.isFinite(Number(text));
}

function toJuniorRangerTitleCase_(value) {
  return cleanJuniorRangerValue_(value)
    .split(' ')
    .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
    .join(' ')
    .replace(/\bDc\b/g, 'DC');
}
