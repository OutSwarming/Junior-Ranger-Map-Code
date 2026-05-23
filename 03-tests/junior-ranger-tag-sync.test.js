const assert = require('assert');
const test = require('node:test');
const {
    buildTagPayload,
    extractSourceEntriesFromGrid,
    extractSourceMembershipEntriesFromGrid,
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
                    { values: [cell('Master Map for Planning'), blank(), cell(''), cell('Track Trails'), blank(), cell('Park Info'), cell('JR History')] },
                    { values: [cell('Alaska'), cell(''), cell('Alaska Public Lands Information Center'), cell('Greatlands Junior Ranger Certificate', 'https://example.com/greatlands.pdf'), blank(), cell('Source park info'), cell('Source JR history')] },
                    { values: [blank(), blank(), blank(), cell('Museum Scavenger Hunt'), blank(), cell('Extra park note'), blank()] },
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
    assert.equal(entries[0].siteInfo, 'Source park info\nExtra park note');
    assert.equal(entries[0].historyTimelineInfo, 'Source JR history');
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

test('extractSourceMembershipEntriesFromGrid keeps named parks even without book tags', () => {
    const spreadsheet = {
        sheets: [{
            properties: { title: 'Alaska' },
            data: [{
                rowData: [
                    { values: [cell('Master Map for Planning'), blank(), cell(''), cell('Track Trails')] },
                    { values: [cell('Alaska'), blank(), cell('Tagged Park'), cell('Junior Ranger')] },
                    { values: [cell('Across'), blank(), cell('Alabama, Arkansas, Georgia,'), blank()] },
                    { values: [blank(), blank(), cell('No Tag Park'), blank()] }
                ]
            }]
        }]
    };

    const entries = extractSourceMembershipEntriesFromGrid(spreadsheet);

    assert.deepEqual(entries.map(entry => entry.name), ['Tagged Park', 'No Tag Park']);
    assert.deepEqual(entries.map(entry => entry.state), ['Alaska', 'Alaska']);
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

test('syncTagCatalog QC mirrors source link, tag additions, tag removals, and deleted parks', () => {
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
        'Existing info should stay until source has info.',
        'Greatlands Junior Ranger Certificate: https://example.com/old-greatlands.pdf\nMuseum Scavenger Hunt: https://example.com/museum.pdf',
        '61.2181',
        '-149.9003',
        'Alaska',
        'Anchorage',
        'NPS',
        'Existing history should stay until source has history.',
        '',
        '',
        '',
        '2026-05-01',
        'Greatlands Junior Ranger Certificate | Museum Scavenger Hunt'
    ], [
        'jr_deleted_park',
        'Deleted Park',
        'This whole pin should disappear.',
        'Deleted Book: https://example.com/deleted.pdf',
        '1',
        '2',
        'Alaska',
        '',
        '',
        '',
        '',
        '',
        '',
        '2026-05-01',
        'Deleted Book'
    ]];
    const sourceEntries = [{
        state: 'Alaska',
        name: 'Alaska Public Lands Information Center',
        siteInfo: '',
        historyTimelineInfo: '',
        tags: [
            { label: 'Greatlands Junior Ranger Certificate', url: 'https://example.com/new-greatlands.pdf' },
            { label: 'Night Ranger', url: 'https://example.com/night-ranger.pdf' }
        ]
    }];

    const result = syncTagCatalog({
        sourceEntries,
        targetHeaders: headers,
        targetRows: rows
    });

    assert.equal(result.updates.length, 1);
    assert.equal(result.removals.length, 1);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0][1], 'Alaska Public Lands Information Center');
    assert.equal(result.rows[0][2], 'Existing info should stay until source has info.');
    assert.equal(result.rows[0][9], 'Existing history should stay until source has history.');
    assert.equal(result.rows[0][3], 'Greatlands Junior Ranger Certificate: https://example.com/new-greatlands.pdf\nNight Ranger: https://example.com/night-ranger.pdf');
    assert.equal(result.rows[0][14], 'Greatlands Junior Ranger Certificate | Night Ranger');
    assert.equal(result.removals[0].row[1], 'Deleted Park');
});

test('syncTagCatalog writes source park info and JR history only when provided', () => {
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
        'jr_denali_np_pr',
        'Denali NP & Pr',
        '',
        '',
        '63.1148',
        '-151.1926',
        'Alaska',
        '',
        '',
        '',
        '',
        '',
        '',
        '2026-05-01',
        ''
    ]];

    const result = syncTagCatalog({
        sourceEntries: [{
            state: 'Alaska',
            name: 'Denali NP & Pr',
            siteInfo: 'Park info from the source tab.',
            historyTimelineInfo: 'JR history from the source tab.',
            tags: [{ label: 'Junior Ranger', url: 'https://example.com/denali.pdf' }]
        }],
        targetHeaders: headers,
        targetRows: rows
    });

    assert.equal(result.rows[0][2], 'Park info from the source tab.');
    assert.equal(result.rows[0][9], 'JR history from the source tab.');
});
