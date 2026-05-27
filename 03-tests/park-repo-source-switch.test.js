const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function loadParkRepo() {
    const sandbox = {
        console,
        window: { BARK: { repos: {} } }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'repos', 'ParkRepo.js'), 'utf8'), sandbox);
    return sandbox.window.BARK.repos.ParkRepo;
}

function points(prefix, count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `${prefix}_${index + 1}`,
        name: `${prefix} ${index + 1}`,
        lat: 40 + index,
        lng: -80 - index
    }));
}

test('ParkRepo accepts authoritative master spreadsheet source switch from old catalog', () => {
    const repo = loadParkRepo();

    const first = repo.replaceAll(points('old_catalog', 100), { source: 'old-static-catalog' });
    assert.equal(first.accepted, true);
    assert.equal(repo.getAll().length, 100);

    const second = repo.replaceAll(points('jr_master', 10), { source: 'junior-ranger-master-spreadsheet' });
    assert.equal(second.accepted, true);
    assert.equal(repo.getAll().length, 10);
    assert.equal(repo.getSource(), 'junior-ranger-master-spreadsheet');
});

test('ParkRepo still rejects destructive refreshes within the same source', () => {
    const repo = loadParkRepo();

    repo.replaceAll(points('jr_master', 100), { source: 'junior-ranger-master-spreadsheet' });
    const destructive = repo.replaceAll(points('jr_master', 10), { source: 'junior-ranger-master-spreadsheet' });

    assert.equal(destructive.accepted, false);
    assert.equal(repo.getAll().length, 100);
});
