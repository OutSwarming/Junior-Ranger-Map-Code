const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function parseSimpleCsv(csvString, options) {
    const lines = csvString.trim().split(/\r?\n/);
    const headers = lines[0]
        .split(',')
        .map(header => options.transformHeader ? options.transformHeader(header) : header);
    const data = lines.slice(1).map(line => {
        const values = line.split(',').map(value => options.transform ? options.transform(value) : value);
        return headers.reduce((row, header, index) => {
            row[header] = values[index] || '';
            return row;
        }, {});
    });
    options.complete({ data, errors: [] });
}

function loadDataServiceHarness(options = {}) {
    let publishedPoints = null;
    const publishedHistory = [];
    let gamificationPoints = null;
    let replaceOptions = null;
    const storage = new Map();
    const sandbox = {
        console,
        fetch: options.fetch || fetch,
        setTimeout,
        clearTimeout,
        setInterval() { return 1; },
        clearInterval() {},
        navigator: { onLine: true },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        Papa: {
            parse: parseSimpleCsv
        },
        window: {
            location: { protocol: 'https:' },
            BARK: {
                debugDataRefresh: false,
                getSwagType() { return 'Other'; },
                getParkCategory(value) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (normalized === 'nps' || normalized.includes('national')) return 'National';
                    if (normalized.includes('state')) return 'State';
                    return value || 'Unknown';
                },
                normalizeText(value) { return String(value || '').trim().toLowerCase(); },
                repos: {
                    ParkRepo: {
                        replaceAll(points, options) {
                            publishedPoints = points;
                            replaceOptions = options;
                            publishedHistory.push({ points, options });
                            return { accepted: true };
                        }
                    }
                }
            },
            gamificationEngine: {
                updateCanonicalCountsFromPoints(points) {
                    gamificationPoints = points;
                }
            },
            syncState() {}
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'modules', 'dataService.js'), 'utf8'), sandbox);

    return {
        sandbox,
        getPublishedPoints: () => publishedPoints,
        getPublishedHistory: () => publishedHistory,
        getGamificationPoints: () => gamificationPoints,
        getReplaceOptions: () => replaceOptions,
        storage
    };
}

test('data service skips source rows with missing coordinates instead of repairing them', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'Location,State,Swag Cost,Type,Useful/Important/Other Info,Website,lat,lng,Park id',
        'Cliffs of the Neuse State Park,North Carolina,Unknown,State,Tag,https://www.ncparks.gov/state-parks/cliffs-neuse-state-park,,,38e0a9bb-4365-4d84-87ea-cca3bde06435'
    ].join('\n'));

    const publishedPoints = harness.getPublishedPoints();
    assert.equal(publishedPoints.length, 0);
    assert.equal(harness.getGamificationPoints(), null);
});

test('data service publishes Fort Caroline and Kingsley Plantation source coordinates unchanged', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'Location,State,Swag Cost,Type,Useful/Important/Other Info,Website,lat,lng,Park id',
        'Fort Caroline/Timucuan Ecological and Historical Preserve,Florida,Free,National,Tag,https://www.nps.gov/places/foca.htm,30.385948,-81.497541,b7b26034-7d2c-4c3e-9901-29e1b5751230',
        'Timucuan Ecological and Historical Preserve Kingsley Plantation,Florida,Free,National,Tag,https://www.nps.gov/timu/learn/historyculture/kp.htm,30.439983,-81.437833,f1bf6d46-3919-4c0c-838d-555ca47155d2'
    ].join('\n'));

    const publishedPoints = harness.getPublishedPoints();
    const fortCaroline = publishedPoints.find(point => point.id === 'b7b26034-7d2c-4c3e-9901-29e1b5751230');
    const kingsley = publishedPoints.find(point => point.id === 'f1bf6d46-3919-4c0c-838d-555ca47155d2');

    assert.equal(publishedPoints.length, 2);
    assert.equal(fortCaroline.lat, 30.385948);
    assert.equal(fortCaroline.lng, -81.497541);
    assert.equal(kingsley.lat, 30.439983);
    assert.equal(kingsley.lng, -81.437833);
});

test('data service publishes War in the Pacific source coordinates unchanged', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'Location,State,Swag Cost,Type,Useful/Important/Other Info,Website,lat,lng,Park id',
        'War in the Pacific National Historical Park,Guam,Free,National,Tag,https://www.nps.gov/wapa/planyourvisit/index.htm,13.4744653,144.7187141,dd646fe7-2eca-459a-9280-8168b17b60f3'
    ].join('\n'));

    const publishedPoints = harness.getPublishedPoints();
    assert.equal(publishedPoints.length, 1);
    assert.equal(publishedPoints[0].lat, 13.4744653);
    assert.equal(publishedPoints[0].lng, 144.7187141);
});

test('data service publishes Junior Ranger sheet rows by siteID and latitude/longitude', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'siteID,siteName,siteInfo,jrBooks,latitude,longitude,state,agency,officialGovWebsite,badgePictures,siteSpecific,specialPrograms',
        'jr_test_site,Test Junior Ranger Site,Main badge available,Booklet A,38.1234,-77.5678,Virginia,NPS,https://www.nps.gov/test,,No,Night Explorer'
    ].join('\n'));

    const publishedPoints = harness.getPublishedPoints();

    assert.equal(publishedPoints.length, 1);
    assert.equal(publishedPoints[0].id, 'jr_test_site');
    assert.equal(publishedPoints[0].name, 'Test Junior Ranger Site');
    assert.equal(publishedPoints[0].lat, 38.1234);
    assert.equal(publishedPoints[0].lng, -77.5678);
    assert.equal(publishedPoints[0].agency, 'NPS');
    assert.equal(publishedPoints[0].parkCategory, 'National');
    assert.equal(publishedPoints[0].swagType, 'Special Programs');
    assert.equal(publishedPoints[0].siteSpecific, 'No');
    assert.equal(publishedPoints[0].specialPrograms, 'Night Explorer');
    assert.match(publishedPoints[0].info, /Special programs: Night Explorer/);
    assert.equal(harness.getReplaceOptions().source, 'junior-ranger-master-spreadsheet');
});

test('data service groups parenthesized rows as hidden pickup locations under the previous master park', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'siteID,siteName,siteInfo,jrBooks,latitude,longitude,state,agency,officialGovWebsite,badgePictures,siteSpecific,specialPrograms',
        'jr_denali,Denali NP & Pr,Main book,Junior Ranger,63.7281,-148.8860,Alaska,NPS,https://www.nps.gov/dena,,Yes,Night Explorer',
        'jr_denali_visitor,(Denali Visitor Center),Pickup spot,Junior Ranger,63.7300,-148.9190,Alaska,NPS,https://www.nps.gov/dena,,,Night Explorer',
        'jr_denali_talkeetna,(Walter Harper Talkeetna Ranger Station),Pickup spot,Junior Ranger,62.3230,-150.1090,Alaska,NPS,https://www.nps.gov/dena,,,Junior Angler',
        'jr_eagle,Eagle River Nature Center,Separate place,Rodak Ranger,61.2360,-149.2700,Alaska,State,https://example.test,,No,'
    ].join('\n'));

    const publishedPoints = harness.getPublishedPoints();
    const denali = publishedPoints.find(point => point.id === 'jr_denali');
    const visitorCenter = publishedPoints.find(point => point.id === 'jr_denali_visitor');
    const talkeetna = publishedPoints.find(point => point.id === 'jr_denali_talkeetna');
    const eagleRiver = publishedPoints.find(point => point.id === 'jr_eagle');

    assert.equal(publishedPoints.length, 4);
    assert.deepEqual(denali.pickupLocations.map(location => location.displayName), [
        'Denali Visitor Center',
        'Walter Harper Talkeetna Ranger Station'
    ]);
    assert.equal(visitorCenter._isPickupLocation, true);
    assert.equal(visitorCenter._pickupParentId, 'jr_denali');
    assert.equal(visitorCenter.swagType, 'Junior Ranger');
    assert.equal(visitorCenter.siteSpecific, 'Yes');
    assert.equal(visitorCenter.specialPrograms, '');
    assert.equal(visitorCenter.jrBooks, '');
    assert.doesNotMatch(visitorCenter.info, /Special programs:/);
    assert.doesNotMatch(visitorCenter.info, /Junior Ranger books:/);
    assert.equal(talkeetna._pickupParentName, 'Denali NP & Pr');
    assert.equal(talkeetna.specialPrograms, '');
    assert.equal(talkeetna.jrBooks, '');
    assert.equal(denali.specialPrograms, 'Night Explorer');
    assert.match(denali._cachedPickupSearchText, /talkeetna/);
    assert.deepEqual(eagleRiver.pickupLocations, []);
});

test('data service groups live catalog child names generated from parenthetical sheet rows', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'siteID,siteName,siteInfo,jrBooks,latitude,longitude,state,agency,officialGovWebsite,badgePictures,siteSpecific,specialPrograms',
        'jr_alaska_denali_np_and_pr,Denali NP & Pr,Main book,Junior Ranger,63.0691689,-151.0069842,Alaska,NPS,https://www.nps.gov/dena,,Yes,Night Explorer',
        'jr_alaska_denali_np_and_pr_denali_visitor_center,Denali NP & Pr - Denali Visitor Center,Pickup spot,Ocean Stewards Junior Ranger: https://example.test/ocean.pdf,63.7308550,-148.9170622,Alaska,NPS,https://www.nps.gov/dena,,,Ocean Stewards Junior Ranger',
        'jr_alaska_denali_np_and_pr_eielson_visitor_center,Denali NP & Pr - Eielson Visitor Center,Pickup spot,World Heritage Junior Ranger: https://example.test/world.pdf,63.4309992,-150.3114272,Alaska,NPS,https://www.nps.gov/dena,,,World Heritage Junior Ranger'
    ].join('\n'));

    const publishedPoints = harness.getPublishedPoints();
    const denali = publishedPoints.find(point => point.id === 'jr_alaska_denali_np_and_pr');
    const eielson = publishedPoints.find(point => point.id === 'jr_alaska_denali_np_and_pr_eielson_visitor_center');

    assert.deepEqual(denali.pickupLocations.map(location => location.displayName), [
        'Denali Visitor Center',
        'Eielson Visitor Center'
    ]);
    assert.equal(denali.specialPrograms, 'Night Explorer');
    assert.equal(eielson._isPickupLocation, true);
    assert.equal(eielson._pickupParentId, 'jr_alaska_denali_np_and_pr');
    assert.equal(eielson.siteSpecific, 'Yes');
    assert.equal(eielson.specialPrograms, '');
    assert.equal(eielson.jrBooks, '');
    assert.doesNotMatch(eielson.info, /World Heritage/);
});

test('data service caches only authoritative Junior Ranger master spreadsheet data', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'siteID,siteName,siteInfo,jrBooks,latitude,longitude,state,agency,officialGovWebsite,badgePictures,siteSpecific,specialPrograms',
        'jr_test_site,Test Junior Ranger Site,Main badge available,Booklet A,38.1234,-77.5678,Virginia,NPS,https://www.nps.gov/test,,No,Night Explorer'
    ].join('\n'), {
        cacheTime: 12345
    });

    assert.equal(harness.storage.get('juniorRangerCSV_source'), 'junior-ranger-master-spreadsheet');
});

test('data service publishes bundled fallback while live catalog request is pending', async () => {
    const requests = [];
    const liveCatalogPromise = new Promise(() => {});
    const fallbackCsv = [
        'siteID,siteName,siteInfo,jrBooks,latitude,longitude,state,agency,officialGovWebsite,badgePictures,siteSpecific,specialPrograms',
        'jr_fast_start,Fast Start Site,Main badge available,Booklet A,38.1234,-77.5678,Virginia,NPS,https://www.nps.gov/test,,Yes,'
    ].join('\n');
    const harness = loadDataServiceHarness({
        fetch(url) {
            const requestUrl = String(url);
            requests.push(requestUrl);
            if (requestUrl.includes('/api/junior-ranger-catalog')) return liveCatalogPromise;
            if (requestUrl === 'assets/data/jr-fallback.csv') {
                return Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(fallbackCsv)
                });
            }
            return Promise.reject(new Error(`Unexpected fetch URL: ${requestUrl}`));
        }
    });

    harness.sandbox.window.BARK.loadData();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.deepEqual(requests, ['assets/data/jr-fallback.csv', '/api/junior-ranger-catalog']);
    assert.equal(harness.getPublishedPoints().length, 1);
    assert.equal(harness.getPublishedPoints()[0].id, 'jr_fast_start');
    assert.equal(harness.getReplaceOptions().source, 'bundled-static-fallback');
});

test('data service paints authoritative cache immediately and skips bundled fallback', async () => {
    const requests = [];
    const liveCatalogPromise = new Promise(() => {});
    const cachedCsv = [
        'siteID,siteName,siteInfo,jrBooks,latitude,longitude,state,agency,officialGovWebsite,badgePictures,siteSpecific,specialPrograms',
        'jr_cached_start,Cached Start Site,Main badge available,Booklet A,39.1234,-78.5678,Virginia,NPS,https://www.nps.gov/test,,Yes,'
    ].join('\n');
    const harness = loadDataServiceHarness({
        fetch(url) {
            const requestUrl = String(url);
            requests.push(requestUrl);
            if (requestUrl.includes('/api/junior-ranger-catalog')) return liveCatalogPromise;
            return Promise.reject(new Error(`Unexpected fetch URL: ${requestUrl}`));
        }
    });
    harness.storage.set('juniorRangerCSV', cachedCsv);
    harness.storage.set('juniorRangerCSV_time', '12345');
    harness.storage.set('juniorRangerCSV_source', 'junior-ranger-master-spreadsheet');

    harness.sandbox.window.BARK.loadData();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.deepEqual(requests, ['/api/junior-ranger-catalog']);
    assert.equal(harness.getPublishedPoints().length, 1);
    assert.equal(harness.getPublishedPoints()[0].id, 'jr_cached_start');
    assert.equal(harness.getReplaceOptions().source, 'junior-ranger-master-spreadsheet');
});
