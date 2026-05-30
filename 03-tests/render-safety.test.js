const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function createFakeElement() {
    return {
        childNodes: [],
        appendChild(node) {
            this.childNodes.push(node);
            return node;
        },
        removeChild(node) {
            const index = this.childNodes.indexOf(node);
            if (index >= 0) this.childNodes.splice(index, 1);
            return node;
        },
        get firstChild() {
            return this.childNodes[0] || null;
        },
        get textContent() {
            return this.childNodes.map(node => node.textContent || '').join('');
        },
        get innerHTML() {
            return this.childNodes.map(node => {
                if (node.tagName === 'BR') return '<br>';
                return String(node.textContent || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
            }).join('');
        }
    };
}

function loadPanelRendererSafety() {
    const alertMessages = [];
    const paywallCalls = [];
    const context = {
        URL,
        alert(message) {
            alertMessages.push(String(message));
        },
        window: {
            BARK: {
                paywall: {
                    openPaywall(payload) {
                        paywallCalls.push(payload);
                    }
                }
            }
        },
        document: {
            createElement(tagName) {
                return { tagName: String(tagName).toUpperCase(), textContent: '' };
            },
            createTextNode(text) {
                return { textContent: String(text) };
            },
            querySelector() {
                return null;
            }
        },
        __alerts: alertMessages,
        __paywallCalls: paywallCalls
    };
    vm.runInNewContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'renderers', 'panelRenderer.js'), 'utf8'), context);
    return {
        ...context.window.BARK.panelRendererSafety,
        alertMessages,
        paywallCalls,
        context
    };
}

function loadRenderEngineHelpers() {
    const context = {
        URL,
        MapMarkerConfig: {
            getAgencyKey(parkData = {}) {
                const agency = String(parkData.agency || '').toLowerCase();
                if (agency.includes('army corps')) return 'army-corps';
                if (agency.includes('forest service') || agency.includes('national forest')) return 'national-forest';
                if (agency.includes('blm') || agency.includes('bureau of land management')) return 'blm';
                if (agency.includes('fish & wildlife') || agency.includes('wildlife refuge')) return 'wildlife-refuge';
                if (agency.includes('nps')) return 'nps';
                if (agency === 'state') return 'state-park';
                return 'other';
            }
        },
        window: { BARK: {} }
    };
    vm.runInNewContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'modules', 'renderEngine.js'), 'utf8'), context);
    return context.window.BARK;
}

test('marker panel info text is rendered as text with line breaks, not executable HTML', () => {
    const safety = loadPanelRendererSafety();
    const element = createFakeElement();

    safety.setTextWithLineBreaks(element, '<img src=x onerror=alert(1)>\nsecond line');

    assert.equal(element.textContent, '<img src=x onerror=alert(1)>second line');
    assert.equal(element.innerHTML, '&lt;img src=x onerror=alert(1)&gt;<br>second line');
});

test('marker panel URL extraction accepts only safe http links', () => {
    const safety = loadPanelRendererSafety();
    const urls = safety.getSafeHttpUrls('javascript:alert(1) https://example.test/path", ftp://bad.test https://ok.test/a?b=1');

    assert.deepEqual(urls, [
        'https://example.test/path',
        'https://ok.test/a?b=1'
    ]);
});

test('marker panel does not duplicate generic Junior Ranger book and tag pills', () => {
    const safety = loadPanelRendererSafety();
    const bookLinks = safety.getBookLinks({
        jrBooks: [
            'Junior Ranger: https://example.test/oklahoma-city.pdf',
            '25th Anniversary Junior Ranger (limited edition): https://example.test/oklahoma-city-25th.pdf'
        ].join('\n')
    });

    const specialLabels = safety.getSpecialProgramLabels(
        'Junior Ranger | 25th Anniversary Junior Ranger (limited edition)',
        bookLinks
    );
    const catalogLabels = safety.getBookCatalogLabels(bookLinks, specialLabels.map(item => item.label));

    assert.deepEqual(specialLabels.map(item => item.label), [
        'Junior Ranger Tag',
        '25th Anniversary Junior Ranger (limited edition) Tag'
    ]);
    assert.deepEqual(catalogLabels, []);
});

test('free visit limit uses premium paywall modal instead of browser alert when available', () => {
    const safety = loadPanelRendererSafety();

    const opened = safety.openFreeVisitLimitPaywall({ limit: 5 });

    assert.equal(opened, true);
    assert.deepEqual(safety.paywallCalls, [{ source: 'visited-place-limit' }]);
    assert.deepEqual(safety.alertMessages, []);
});

test('free visit limit keeps a readable fallback alert if paywall is unavailable', () => {
    const safety = loadPanelRendererSafety();
    safety.context.window.BARK.paywall = null;

    const opened = safety.openFreeVisitLimitPaywall({ limit: 5 });

    assert.equal(opened, false);
    assert.equal(safety.paywallCalls.length, 0);
    assert.match(safety.alertMessages[0], /Adding more than 5 parks is a Premium feature/);
});

test('swag link formatter validates URLs and adds noopener rel', () => {
    const bark = loadRenderEngineHelpers();
    const html = bark.formatSwagLinks('https://example.test/" onclick="alert(1) javascript:alert(1)');

    assert.match(html, /href="https:\/\/example\.test\/"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.doesNotMatch(html, /onclick|javascript:/);
});

test('park type filter supports expanded agency categories', () => {
    const bark = loadRenderEngineHelpers();
    const armyCorps = { agency: 'US Army Corps of Engineers', parkCategory: 'Other' };
    const nationalForest = { agency: 'US Forest Service - National Forest', parkCategory: 'Other' };
    const blm = { agency: 'BLM', parkCategory: 'Other' };
    const wildlifeRefuge = { agency: 'US Fish & Wildlife Service', parkCategory: 'Other' };
    const localOther = { agency: 'Other', parkCategory: 'Other' };
    const nps = { agency: 'NPS', parkCategory: 'National' };
    const state = { agency: 'State', parkCategory: 'State' };

    assert.equal(bark.matchesParkTypeFilter(armyCorps, 'army-corps'), true);
    assert.equal(bark.matchesParkTypeFilter(nationalForest, 'national-forest'), true);
    assert.equal(bark.matchesParkTypeFilter(blm, 'blm'), true);
    assert.equal(bark.matchesParkTypeFilter(wildlifeRefuge, 'wildlife-refuge'), true);
    assert.equal(bark.matchesParkTypeFilter(localOther, 'Other'), true);
    assert.equal(bark.matchesParkTypeFilter(armyCorps, 'Other'), false);
    assert.equal(bark.matchesParkTypeFilter(nps, 'National'), true);
    assert.equal(bark.matchesParkTypeFilter(nationalForest, 'National'), false);
    assert.equal(bark.matchesParkTypeFilter(wildlifeRefuge, 'National'), false);
    assert.equal(bark.matchesParkTypeFilter(state, 'State'), true);
    assert.equal(bark.matchesParkTypeFilter(localOther, 'State'), false);
});

test('program filter uses regional and national tags from specialPrograms', () => {
    const bark = loadRenderEngineHelpers();
    const masterPoint = { id: 'jr_denali', specialPrograms: 'Night Explorer | Junior Angler' };
    const childPickup = { _isPickupLocation: true, _pickupParentId: 'jr_denali', specialPrograms: '' };
    const points = [
        masterPoint,
        childPickup,
        { specialPrograms: 'Underwater Explorer\nJunior Forest Ranger' },
        { specialPrograms: 'Junior Ranger' }
    ];
    bark.repos = {
        ParkRepo: {
            getById(id) {
                return id === 'jr_denali' ? masterPoint : null;
            }
        }
    };

    assert.deepEqual(bark.getAvailableProgramFilters(points), [
        'Junior Angler',
        'Junior Forest Ranger',
        'Night Explorer',
        'Underwater Explorer'
    ]);
    assert.equal(bark.matchesProgramFilter(points[0], 'Night Explorer'), true);
    assert.equal(bark.matchesProgramFilter(childPickup, 'Night Explorer'), true);
    assert.equal(bark.matchesProgramFilter(childPickup, 'Underwater Explorer'), false);
    assert.equal(bark.matchesProgramFilter(points[2], 'all'), true);
});

test('pickup location pins stay hidden until their master park group is expanded', () => {
    const bark = loadRenderEngineHelpers();
    const childPickup = { _isPickupLocation: true, _pickupParentId: 'jr_denali' };
    const masterPin = { id: 'jr_denali' };

    assert.equal(bark.isPickupLocationVisible(masterPin), true);
    assert.equal(bark.isPickupLocationVisible(childPickup), false);

    bark.expandedPickupParentIds.add('jr_denali');

    assert.equal(bark.isPickupLocationVisible(childPickup), true);
});

test('panel renderer no longer assigns sheet fields directly through innerHTML', () => {
    const source = fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'renderers', 'panelRenderer.js'), 'utf8');

    assert.doesNotMatch(source, /infoEl\.innerHTML\s*=\s*d\.info/);
    assert.doesNotMatch(source, /picsEl\.innerHTML\s*=\s*formattedPics/);
    assert.doesNotMatch(source, /websitesContainer\.innerHTML\s*=\s*`/);
});
