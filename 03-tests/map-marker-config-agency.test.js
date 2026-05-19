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

