'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildStateSheetRanges,
    buildSheetRange,
    catalogRowsToCsv,
    extractCatalogRowsFromGrid
} = require('../lib/juniorRangerSourceCatalog');
const {
    __test: {
        shouldBypassJuniorRangerCatalogCache
    }
} = require('../index');

function cell(value, options = {}) {
    const out = { formattedValue: value };
    if (options.link) out.hyperlink = options.link;
    if (options.color) out.effectiveFormat = { backgroundColor: options.color };
    return out;
}

function row(values) {
    return { values };
}

function sheet(rows) {
    return {
        sheets: [
            {
                properties: { title: 'Alabama' },
                data: [{ rowData: rows }]
            }
        ]
    };
}

function workbook(sheetDefinitions) {
    return {
        sheets: sheetDefinitions.map(([title, rows]) => ({
            properties: { title },
            data: [{ rowData: rows }]
        }))
    };
}

test('buildSheetRange quotes the requested state tab', () => {
    assert.equal(buildSheetRange('Alabama'), "'Alabama'!A:H");
});

test('buildStateSheetRanges includes state tabs and skips non-source tabs', () => {
    assert.deepEqual(
        buildStateSheetRanges(['Alabama', 'Canada', 'Color Coding', 'Washington, DC', 'Wyoming']),
        ["'Alabama'!A:H", "'Washington, DC'!A:H", "'Wyoming'!A:H"]
    );
});

test('shouldBypassJuniorRangerCatalogCache treats refresh query params as cache bypasses', () => {
    assert.equal(shouldBypassJuniorRangerCatalogCache({}), false);
    assert.equal(shouldBypassJuniorRangerCatalogCache({ state: 'Alabama' }), false);
    assert.equal(shouldBypassJuniorRangerCatalogCache({ cache_bypass: '123' }), true);
    assert.equal(shouldBypassJuniorRangerCatalogCache({ no_cache: '1' }), true);
    assert.equal(shouldBypassJuniorRangerCatalogCache({ refresh: 'true' }), true);
});

test('extractCatalogRowsFromGrid publishes Alabama rows with tag links and skips purple trail rows', () => {
    const spreadsheet = sheet([
        row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
        row([
            cell('Alabama'),
            cell('', { color: { blue: 1 } }),
            cell('Birmingham Civil Rights NM'),
            cell('Junior Ranger', { link: 'https://example.com/birmingham-book.pdf' }),
            cell('Yes'),
            cell('33.515'),
            cell('-86.809'),
            cell('jr_birmingham_civil_rights_nm')
        ]),
        row([
            {},
            cell('', { color: { blue: 1 } }),
            {},
            cell('Civil Rights Explorer', { link: 'https://example.com/civil-rights-explorer.pdf' })
        ]),
        row([
            {},
            cell('', { color: { red: 0.6, blue: 1 } }),
            cell('Alabama Across Program'),
            cell('Across Alabama Trail'),
            {},
            cell('32.377'),
            cell('-86.300'),
            cell('jr_alabama_across_program')
        ]),
        row([
            {},
            cell('', { color: { green: 1 } }),
            cell('Wheeler NWR'),
            cell('Junior Ranger'),
            cell('No'),
            cell('34.548'),
            cell('-86.951'),
            cell('jr_wheeler_nwr')
        ])
    ]);

    const rows = extractCatalogRowsFromGrid(spreadsheet, { state: 'Alabama', today: '2026-05-25' });

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(item => item.siteID), [
        'jr_birmingham_civil_rights_nm',
        'jr_wheeler_nwr'
    ]);
    assert.equal(rows[0].agency, 'NPS');
    assert.equal(rows[0].siteSpecific, 'Yes');
    assert.equal(rows[0].specialPrograms, 'Junior Ranger | Civil Rights Explorer');
    assert.equal(
        rows[0].jrBooks,
        'Junior Ranger: https://example.com/birmingham-book.pdf\nCivil Rights Explorer: https://example.com/civil-rights-explorer.pdf'
    );
    assert.equal(rows[1].agency, 'US Fish & Wildlife Service');
    assert.equal(rows[1].siteSpecific, 'No');
});

test('extractCatalogRowsFromGrid publishes every state tab when no state is requested', () => {
    const spreadsheet = workbook([
        ['Alabama', [
            row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
            row([
                cell('Alabama'),
                cell('', { color: { blue: 1 } }),
                cell('Birmingham Civil Rights NM'),
                cell('Junior Ranger'),
                {},
                cell('33.515'),
                cell('-86.809'),
                cell('jr_alabama_birmingham_civil_rights_nm')
            ])
        ]],
        ['Montana', [
            row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
            row([
                cell('Montana'),
                cell('', { color: { blue: 1 } }),
                cell('Glacier NP'),
                cell('Junior Ranger'),
                {},
                cell('48.7596'),
                cell('-113.7870'),
                cell('jr_montana_glacier_np')
            ])
        ]],
        ['Canada', [
            row([cell('Canada'), cell('', { color: { blue: 1 } }), cell('Banff'), cell('Junior Ranger'), {}, cell('51.4968'), cell('-115.9281'), cell('jr_canada_banff')])
        ]]
    ]);

    const rows = extractCatalogRowsFromGrid(spreadsheet, { today: '2026-05-25' });

    assert.deepEqual(rows.map(item => item.siteID), [
        'jr_alabama_birmingham_civil_rights_nm',
        'jr_montana_glacier_np'
    ]);
    assert.deepEqual(rows.map(item => item.state), ['Alabama', 'Montana']);
});

test('extractCatalogRowsFromGrid publishes non-purple Across rows and still ignores purple Across rows', () => {
    const spreadsheet = workbook([
        ['North Carolina', [
            row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
            row([
                cell('North Carolina'),
                cell('', { color: { blue: 1 } }),
                cell('Salem Lake Park'),
                cell('Junior Ranger'),
                {},
                cell('35.0862583'),
                cell('-80.6350681'),
                cell('jr_north_carolina_salem_lake_park')
            ]),
            row([
                cell('Across'),
                cell('', { color: { blue: 1 } }),
                cell('Great Smoky Mountains NP'),
                cell('Junior Ranger'),
                {},
                cell('35.6531943'),
                cell('-83.5070203'),
                cell('jr_across_great_smoky_mountains_np')
            ]),
            row([
                {},
                cell('', { color: { blue: 1 } }),
                {},
                cell('Junior Angler')
            ]),
            row([
                {},
                cell('', { color: { red: 0.6, blue: 1 } }),
                cell('Appalachian NST'),
                cell('Junior Ranger'),
                {},
                cell('36.2679'),
                cell('-112.3535'),
                cell('jr_across_appalachian_nst')
            ])
        ]]
    ]);

    const rows = extractCatalogRowsFromGrid(spreadsheet, { today: '2026-05-25' });

    assert.deepEqual(rows.map(item => item.siteID), [
        'jr_north_carolina_salem_lake_park',
        'jr_across_great_smoky_mountains_np'
    ]);
    assert.equal(rows[1].state, 'North Carolina');
    assert.equal(rows[1].agency, 'NPS');
    assert.equal(rows[1].specialPrograms, 'Junior Ranger | Junior Angler');
});

test('extractCatalogRowsFromGrid skips later duplicate names when either copy is from Across', () => {
    const spreadsheet = workbook([
        ['Tennessee', [
            row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
            row([
                cell('Tennessee'),
                cell('', { color: { blue: 1 } }),
                cell('Great Smoky Mountains NP'),
                cell('Junior Ranger'),
                {},
                cell('35.6118'),
                cell('-83.4895'),
                cell('jr_tennessee_great_smoky_mountains_np')
            ])
        ]],
        ['North Carolina', [
            row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
            row([
                cell('Across'),
                cell('', { color: { blue: 1 } }),
                cell('Great Smoky Mountains NP'),
                cell('Junior Ranger'),
                {},
                cell('35.6531943'),
                cell('-83.5070203'),
                cell('jr_across_great_smoky_mountains_np')
            ]),
            row([
                {},
                cell('', { color: { blue: 1 } }),
                cell('Blue Ridge Parkway'),
                cell('Junior Ranger'),
                {},
                cell('35.5656'),
                cell('-82.4865'),
                cell('jr_across_blue_ridge_parkway')
            ])
        ]]
    ]);

    const rows = extractCatalogRowsFromGrid(spreadsheet, { today: '2026-05-25' });

    assert.deepEqual(rows.map(item => item.siteID), [
        'jr_tennessee_great_smoky_mountains_np',
        'jr_across_blue_ridge_parkway'
    ]);
});

test('extractCatalogRowsFromGrid ignores punctuation-only state cells and keeps the sheet state', () => {
    const spreadsheet = workbook([
        ['Maryland', [
            row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
            row([
                cell(':'),
                cell('', { color: { blue: 1 } }),
                cell('Clara Barton NHS'),
                cell('Junior Ranger'),
                {},
                cell('38.9672859'),
                cell('-77.1407718'),
                {}
            ])
        ]]
    ]);

    const rows = extractCatalogRowsFromGrid(spreadsheet, { today: '2026-05-25' });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'Maryland');
    assert.equal(rows[0].siteID, 'jr_maryland_clara_barton_nhs');
});

test('extractCatalogRowsFromGrid treats parenthesized pickup locations as separate pins', () => {
    const spreadsheet = sheet([
        row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
        row([
            cell('Alabama'),
            cell('', { color: { red: 0.356, green: 0.0588 } }),
            cell('Tongass NF'),
            cell('Tongass NF Junior Ranger')
        ]),
        row([
            {},
            cell('', { color: { red: 0.356, green: 0.0588 } }),
            cell('(Mendenhall Glacier Visitor Center)'),
            cell('Mendenhall Glacier Junior Ranger', { link: 'https://example.com/mendenhall.pdf' }),
            {},
            cell('58.416'),
            cell('-134.545'),
            cell('jr_tongass_mendenhall')
        ])
    ]);

    const rows = extractCatalogRowsFromGrid(spreadsheet, { state: 'Alabama', today: '2026-05-25' });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].siteName, 'Tongass NF - Mendenhall Glacier Visitor Center');
    assert.equal(rows[0].siteID, 'jr_tongass_mendenhall');
    assert.equal(rows[0].jrBooks, 'Mendenhall Glacier Junior Ranger: https://example.com/mendenhall.pdf');
});

test('extractCatalogRowsFromGrid keeps non-purple Across pickup rows and ignores state-list note rows', () => {
    const spreadsheet = workbook([
        ['Arizona', [
            row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
            row([
                cell('Across'),
                cell('', { color: { blue: 1 } }),
                cell('Glen Canyon NRA'),
                cell('Junior Ranger', { link: 'https://example.com/glen-canyon.pdf' }),
                {},
                cell('37.3867256'),
                cell('-110.8424257'),
                cell('jr_across_glen_canyon_nra')
            ]),
            row([
                {},
                cell('', { color: { blue: 1 } }),
                cell('(Carl Hayden Visitor Center)'),
                cell('50th Birthday Scavenger Hunt'),
                {},
                cell('36.9357176'),
                cell('-111.4858141'),
                cell('jr_across_glen_canyon_nra_carl_hayden_visitor_center')
            ]),
            row([
                {},
                cell('', { color: { blue: 1 } }),
                cell('(Glen Canyon Conservancy)'),
                {},
                {},
                cell('38.7945952'),
                cell('-106.5348379'),
                cell('jr_across_glen_canyon_nra_glen_canyon_conservancy')
            ]),
            row([
                {},
                cell('', { color: { blue: 1 } }),
                cell('Arizona, Utah'),
                cell('Junior Angler')
            ]),
            row([
                {},
                cell('', { color: { blue: 1 } }),
                cell('(Navajo Bridge Interpretive Center)'),
                {},
                {},
                cell('36.8181296'),
                cell('-111.6334439'),
                cell('jr_across_glen_canyon_nra_navajo_bridge_interpretive_center')
            ])
        ]]
    ]);

    const rows = extractCatalogRowsFromGrid(spreadsheet, { today: '2026-05-25' });

    assert.deepEqual(rows.map(item => item.siteID), [
        'jr_across_glen_canyon_nra',
        'jr_across_glen_canyon_nra_carl_hayden_visitor_center',
        'jr_across_glen_canyon_nra_glen_canyon_conservancy',
        'jr_across_glen_canyon_nra_navajo_bridge_interpretive_center'
    ]);
    assert.deepEqual(rows.map(item => item.siteName), [
        'Glen Canyon NRA',
        'Glen Canyon NRA - Carl Hayden Visitor Center',
        'Glen Canyon NRA - Glen Canyon Conservancy',
        'Glen Canyon NRA - Navajo Bridge Interpretive Center'
    ]);
    assert.ok(rows.every(item => item.agency === 'NPS'));
    assert.equal(rows[0].specialPrograms, 'Junior Ranger');
    assert.equal(rows[2].latitude, '36.9193756');
    assert.equal(rows[2].longitude, '-111.4602113');
    assert.equal(rows[2].specialPrograms, 'Junior Angler');
});

test('extractCatalogRowsFromGrid skips parenthesized trading card names without dropping later tags', () => {
    const spreadsheet = sheet([
        row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
        row([
            cell('Alabama'),
            cell('', { color: { blue: 1 } }),
            cell('Selma to Montgomery NHT'),
            cell('Junior Ranger', { link: 'https://example.com/selma-jr.pdf' }),
            {},
            cell('32.407'),
            cell('-86.918'),
            cell('jr_selma_to_montgomery_nht')
        ]),
        row([{}, cell('', { color: { blue: 1 } }), {}, cell('Trading Cards:', { link: 'https://example.com/trading-cards.pdf' })]),
        row([{}, cell('', { color: { blue: 1 } }), {}, cell('(Brown Chapel, African Methodist Episcopal Church)')]),
        row([{}, cell('', { color: { blue: 1 } }), {}, cell('(Edmund Pettus Bridge, "Bloody Sunday")')]),
        row([{}, cell('', { color: { blue: 1 } }), {}, cell('Civil Rights Explorer', { link: 'https://example.com/explorer.pdf' })])
    ]);

    const rows = extractCatalogRowsFromGrid(spreadsheet, { state: 'Alabama', today: '2026-05-25' });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].specialPrograms, 'Junior Ranger | Trading Cards | Civil Rights Explorer');
    assert.equal(
        rows[0].jrBooks,
        'Junior Ranger: https://example.com/selma-jr.pdf\nTrading Cards: https://example.com/trading-cards.pdf\nCivil Rights Explorer: https://example.com/explorer.pdf'
    );
    assert.doesNotMatch(rows[0].specialPrograms, /Brown Chapel|Edmund Pettus/);
});

test('extractCatalogRowsFromGrid honors explicit state suffixes and generates a temporary site id', () => {
    const spreadsheet = sheet([
        row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
        row([
            cell('Alabama'),
            cell('', { color: { blue: 1 } }),
            cell('Hinckley, Ohio'),
            cell('Junior Ranger Adventure Guide', { link: 'https://example.com/hinckley.pdf' }),
            {},
            cell('41.2383874'),
            cell('-81.7451298'),
            {}
        ])
    ]);

    const rows = extractCatalogRowsFromGrid(spreadsheet, { state: 'Alabama', today: '2026-05-25' });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].siteName, 'Hinckley');
    assert.equal(rows[0].state, 'Ohio');
    assert.equal(rows[0].siteID, 'jr_ohio_hinckley');
    assert.equal(rows[0].jrBooks, 'Junior Ranger Adventure Guide: https://example.com/hinckley.pdf');
});

test('catalogRowsToCsv preserves multi-line book links as quoted CSV fields', () => {
    const csv = catalogRowsToCsv([
        {
            siteID: 'jr_test',
            siteName: 'Test Site',
            siteInfo: 'Info',
            jrBooks: 'Junior Ranger: https://example.com/book.pdf\nExplorer: https://example.com/explorer.pdf',
            latitude: '1',
            longitude: '2',
            state: 'Alabama',
            address: '',
            agency: 'NPS',
            historyTimelineInfo: '',
            badgePictures: '',
            officialGovWebsite: '',
            websiteLinks: '',
            lastUpdated: '2026-05-25',
            specialPrograms: 'Junior Ranger | Explorer'
        }
    ]);

    assert.match(csv, /^siteID,siteName,siteInfo,jrBooks,/);
    assert.match(csv, /"Junior Ranger: https:\/\/example\.com\/book\.pdf\nExplorer: https:\/\/example\.com\/explorer\.pdf"/);
});
