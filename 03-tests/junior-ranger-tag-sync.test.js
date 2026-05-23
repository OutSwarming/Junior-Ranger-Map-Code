const assert = require('assert');
const test = require('node:test');
const {
    buildTagPayload,
    extractSourceEntriesFromGrid,
    syncTagCatalog
} = require('../05-tools/lib/junior-ranger-tag-sync');

function cell(value, url = '') {
    return {
        formattedValue: value,
        hyperlink: url,
        effectiveFormat: {
            backgroundColor: { red: 0, green: 0, blue: 1 }
        }
    };
}

function blank() {
    return {};
}

test('extractSourceEntriesFromGrid groups state-sheet rows into place tags with links', () => {
    const spreadsheet = {
        sheets: [{
            properties: { title: 'Alaska' },
            data: [{
                rowData: [
                    { values: [cell('Master Map for Planning'), blank(), cell(''), cell('Track Trails')] },
                    { values: [cell('Alaska'), cell(''), cell('Alaska Public Lands Information Center'), cell('Greatlands Junior Ranger Certificate', 'https://example.com/greatlands.pdf')] },
                    { values: [blank(), blank(), blank(), cell('Museum Scavenger Hunt')] },
                    { values: [blank(), blank(), blank(), cell('Aleutian Islands WW2 NHA Junior Ranger', 'https://example.com/aleutian.pdf')] },
                    { values: [blank(), blank(), cell('Eagle River Nature Center'), cell('Rodak Ranger')] }
                ]
            }]
        }]
    };

    const entries = extractSourceEntriesFromGrid(spreadsheet);

    assert.equal(entries.length, 2);
    assert.equal(entries[0].name, 'Alaska Public Lands Information Center');
    assert.equal(entries[0].state, 'Alaska');
    assert.deepEqual(entries[0].tags, [
        { label: 'Greatlands Junior Ranger Certificate', url: 'https://example.com/greatlands.pdf' },
        { label: 'Museum Scavenger Hunt', url: '' },
        { label: 'Aleutian Islands WW2 NHA Junior Ranger', url: 'https://example.com/aleutian.pdf' }
    ]);
    assert.equal(entries[1].name, 'Eagle River Nature Center');
    assert.deepEqual(entries[1].tags, [{ label: 'Rodak Ranger', url: '' }]);
});

test('buildTagPayload keeps every tag name and only writes linked entries to jrBooks', () => {
    const payload = buildTagPayload([
        { label: 'Greatlands Junior Ranger Certificate', url: 'https://example.com/greatlands.pdf' },
        { label: 'Museum Scavenger Hunt', url: '' },
        { label: 'Greatlands Junior Ranger Certificate', url: 'https://example.com/greatlands.pdf' }
    ]);

    assert.equal(payload.specialPrograms, 'Greatlands Junior Ranger Certificate | Museum Scavenger Hunt');
    assert.equal(payload.jrBooks, 'Greatlands Junior Ranger Certificate: https://example.com/greatlands.pdf');
});

test('syncTagCatalog updates only tag columns and appends new places', () => {
    const headers = [
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
    ];
    const rows = [[
        'jr_alaska_public_lands_information_center',
        'Alaska Public Lands Information Center',
        'Do not touch this info.',
        'Old Book: https://example.com/old.pdf',
        '61.2181',
        '-149.9003',
        'Alaska',
        'Do not touch address',
        'NPS',
        'Do not touch history',
        'Do not touch pictures',
        'https://example.com/site',
        '',
        '5/1/2026',
        'Old Tag'
    ]];
    const sourceEntries = [{
        state: 'Alaska',
        name: 'Alaska Public Lands Information Center',
        color: '#0000ff',
        tags: [
            { label: 'Greatlands Junior Ranger Certificate', url: 'https://example.com/greatlands.pdf' },
            { label: 'Museum Scavenger Hunt', url: '' }
        ]
    }, {
        state: 'Alaska',
        name: 'Eagle River Nature Center',
        color: '#0000ff',
        tags: [{ label: 'Rodak Ranger', url: '' }]
    }];

    const result = syncTagCatalog({
        sourceEntries,
        targetHeaders: headers,
        targetRows: rows,
        today: '2026-05-22'
    });

    assert.equal(result.updates.length, 1);
    assert.equal(result.appends.length, 1);
    assert.equal(result.rows[0][2], 'Do not touch this info.');
    assert.equal(result.rows[0][4], '61.2181');
    assert.equal(result.rows[0][5], '-149.9003');
    assert.equal(result.rows[0][9], 'Do not touch history');
    assert.equal(result.rows[0][3], 'Greatlands Junior Ranger Certificate: https://example.com/greatlands.pdf');
    assert.equal(result.rows[0][14], 'Greatlands Junior Ranger Certificate | Museum Scavenger Hunt');

    const appended = result.rows[1];
    assert.equal(appended[0], 'jr_eagle_river_nature_center');
    assert.equal(appended[1], 'Eagle River Nature Center');
    assert.equal(appended[2], '');
    assert.equal(appended[4], '');
    assert.equal(appended[5], '');
    assert.equal(appended[6], 'Alaska');
    assert.equal(appended[13], '2026-05-22');
    assert.equal(appended[14], 'Rodak Ranger');
});
