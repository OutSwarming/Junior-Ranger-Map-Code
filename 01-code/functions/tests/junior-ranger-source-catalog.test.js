'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildSheetRange,
    catalogRowsToCsv,
    extractCatalogRowsFromGrid
} = require('../lib/juniorRangerSourceCatalog');

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

test('buildSheetRange quotes the requested state tab', () => {
    assert.equal(buildSheetRange('Alabama'), "'Alabama'!A:H");
});

test('extractCatalogRowsFromGrid publishes Alabama rows with tag links and skips purple trail rows', () => {
    const spreadsheet = sheet([
        row([cell('Master Map for Planning'), {}, {}, cell('Track Trails')]),
        row([
            cell('Alabama'),
            cell('', { color: { blue: 1 } }),
            cell('Birmingham Civil Rights NM'),
            cell('Junior Ranger', { link: 'https://example.com/birmingham-book.pdf' }),
            {},
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
            {},
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
    assert.equal(rows[0].specialPrograms, 'Junior Ranger | Civil Rights Explorer');
    assert.equal(
        rows[0].jrBooks,
        'Junior Ranger: https://example.com/birmingham-book.pdf\nCivil Rights Explorer: https://example.com/civil-rights-explorer.pdf'
    );
    assert.equal(rows[1].agency, 'US Fish & Wildlife Service');
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
