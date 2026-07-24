const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadMapMarkerConfig() {
    const source = fs.readFileSync(path.join(__dirname, '../01-code/app/MapMarkerConfig.js'), 'utf8');
    const context = { window: {} };
    vm.runInNewContext(source, context);
    return context.window.MapMarkerConfig;
}

test('map marker config styles National Forest pins brown', () => {
    const MapMarkerConfig = loadMapMarkerConfig();
    const style = MapMarkerConfig.getPinStyle({
        agency: 'US Forest Service - National Forest',
        parkCategory: 'National'
    });

    assert.equal(style.agencyKey, 'national-forest');
    assert.equal(style.pinColor, '#8B5E34');
});

test('map marker config uses lightweight SVG image pins', () => {
    const MapMarkerConfig = loadMapMarkerConfig();
    const style = MapMarkerConfig.getPinStyle({
        agency: 'NPS',
        parkCategory: 'National'
    });
    const iconUrl = MapMarkerConfig.getPinIconUrl(style);
    const decoded = decodeURIComponent(iconUrl);

    assert.match(iconUrl, /^data:image\/svg\+xml;charset=UTF-8,/);
    assert.match(decoded, /<svg/);
    assert.match(decoded, /fill="#2563EB"/);
    assert.doesNotMatch(decoded, /filter|box-shadow|linearGradient/);
});

test('map marker config gives active pins a yellow SVG outline', () => {
    const MapMarkerConfig = loadMapMarkerConfig();
    const style = MapMarkerConfig.getPinStyle({
        agency: 'NPS',
        parkCategory: 'National'
    });
    const decoded = decodeURIComponent(MapMarkerConfig.getPinIconUrl(style, { isActive: true }));

    assert.match(decoded, /stroke="#FBBF24"/);
    assert.equal(MapMarkerConfig.getIconSignature({ agency: 'NPS', parkCategory: 'National' }, false, true), 'nps|open|active|main');
});

test('map marker config gives pickup pins a distinct amber outline without changing master pins', () => {
    const MapMarkerConfig = loadMapMarkerConfig();
    const style = MapMarkerConfig.getPinStyle({
        agency: 'NPS',
        parkCategory: 'National'
    });
    const pickupPark = { agency: 'NPS', parkCategory: 'National', _isPickupLocation: true };
    const decodedPickup = decodeURIComponent(MapMarkerConfig.getPinIconUrl(style, { isPickupLocation: true }));
    const decodedActivePickup = decodeURIComponent(MapMarkerConfig.getPinIconUrl(style, {
        isPickupLocation: true,
        isActive: true
    }));

    assert.match(decodedPickup, /stroke="#D97706"/);
    assert.doesNotMatch(decodedPickup, /stroke="#FBBF24"/);
    assert.match(decodedActivePickup, /stroke="#FBBF24"/);
    assert.equal(MapMarkerConfig.getIconSignature(pickupPark, false, false), 'nps|open|idle|pickup');
    assert.equal(MapMarkerConfig.getIconSignature({ agency: 'NPS', parkCategory: 'National' }, false, false), 'nps|open|idle|main');
});

test('map marker config gives visited pins a green starred center', () => {
    const MapMarkerConfig = loadMapMarkerConfig();
    const style = MapMarkerConfig.getPinStyle({
        agency: 'NPS',
        parkCategory: 'National'
    }, true);
    const decoded = decodeURIComponent(MapMarkerConfig.getPinIconUrl(style, { isVisited: true }));

    assert.match(decoded, /stroke="#22C55E"/);
    assert.match(decoded, /r="6\.4"/);
    assert.match(decoded, /fill="#22C55E"/);
    assert.match(decoded, /M16 11\.1l1\.5 3\.1/);
    assert.equal(MapMarkerConfig.getIconSignature({ agency: 'NPS', parkCategory: 'National' }, true, false), 'nps|visited|idle|main');
});
