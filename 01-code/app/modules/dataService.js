/**
 * dataService.js — CSV Fetching, Parsing, Data Polling
 * Firebase/Auth responsibilities live in /services as of Phase 3.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

// ====== CSV PARSING ENGINE ======
let isRendering = false;
let pendingCSV = null;
let pendingCSVOptions = null;

const CSV_COLUMNS = {
    PARK_ID: ['siteID', 'Park ID', 'Park id'],
    LOCATION: ['siteName', 'Location'],
    STATE: ['state', 'State'],
    SWAG_COST: ['Swag Cost'],
    TYPE: ['agency', 'Type'],
    INFO: ['siteInfo', 'Useful/Important/Other Info'],
    JR_BOOKS: ['jrBooks'],
    SPECIAL_PROGRAMS: ['specialPrograms'],
    WEBSITE: ['officialGovWebsite', 'websiteLinks', 'Website'],
    PICS: ['badgePictures', 'Swag Pics - If available, and may not be current.'],
    VIDEO: ['Swearing-In Video. Not all sites do this, and ones that do only do it as time permits.'],
    LAT: ['latitude', 'lat'],
    LNG: ['longitude', 'lng'],
    ADDRESS: ['address', 'Address'],
    HISTORY: ['historyTimelineInfo', 'History Timeline Info', 'Junior Ranger History']
};

const SWAG_TYPE_COLUMNS = ['Swag Type', 'Swag', 'Swag Available'];
const LIVE_SOURCE_CSV_URL = '/api/junior-ranger-catalog';
const AUTHORITATIVE_DATA_SOURCE = 'junior-ranger-master-spreadsheet';
const DATA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DATA_CACHE_KEY = 'juniorRangerCSV';
const DATA_CACHE_TIME_KEY = 'juniorRangerCSV_time';
const DATA_CACHE_SOURCE_KEY = 'juniorRangerCSV_source';
const LEGACY_DATA_CACHE_KEYS = ['barkCSV', 'barkCSV_time'];
let liveDataRefreshInFlight = null;
let dataRefreshTimer = null;

function cleanCSVValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    return value;
}

function getCSVColumnKey(row, columnName) {
    if (!row) return '';
    const columnNames = Array.isArray(columnName) ? columnName : [columnName];

    for (const name of columnNames) {
        if (Object.prototype.hasOwnProperty.call(row, name)) return name;

        const normalizedColumnName = cleanCSVValue(name).toLowerCase();
        const matchingKey = Object.keys(row).find(key => cleanCSVValue(key).toLowerCase() === normalizedColumnName);
        if (matchingKey) return matchingKey;
    }

    return '';
}

function getCSVValue(row, columnName) {
    const key = getCSVColumnKey(row, columnName);
    return key ? cleanCSVValue(row[key]) : '';
}

function getFirstPresentCSVValue(row, columnNames) {
    for (const columnName of columnNames) {
        if (row && Object.prototype.hasOwnProperty.call(row, columnName)) {
            return { found: true, value: cleanCSVValue(row[columnName]) };
        }
        const matchingKey = getCSVColumnKey(row, columnName);
        if (matchingKey) return { found: true, value: cleanCSVValue(row[matchingKey]) };
    }
    return { found: false, value: '' };
}

function normalizeSwagType(value) {
    if (!value) return 'Other';
    if (['Tag', 'Bandana', 'Certificate', 'Other'].includes(value)) return value;
    if (['Junior Ranger', 'Special Programs'].includes(value)) return value;
    return window.BARK.getSwagType(value);
}

function isJuniorRangerRow(row) {
    return Boolean(getCSVColumnKey(row, 'siteID') || getCSVColumnKey(row, 'siteName'));
}

function buildJuniorRangerInfo(row) {
    const sections = [];
    const siteInfo = getCSVValue(row, CSV_COLUMNS.INFO);
    const jrBooks = getCSVValue(row, CSV_COLUMNS.JR_BOOKS);
    const specialPrograms = getCSVValue(row, CSV_COLUMNS.SPECIAL_PROGRAMS);

    if (siteInfo) sections.push(siteInfo);
    if (jrBooks) sections.push(`Junior Ranger books: ${jrBooks}`);
    if (specialPrograms) sections.push(`Special programs: ${specialPrograms}`);

    return sections.join('\n\n');
}

function isPickupLocationRowName(name) {
    const value = cleanCSVValue(name);
    return value.length > 2 && value.startsWith('(') && value.endsWith(')');
}

function getPickupLocationLabel(name) {
    const value = cleanCSVValue(name);
    if (!isPickupLocationRowName(value)) return value;
    return value.slice(1, -1).trim();
}

function getGeneratedPickupLocationLabel(name, parentPoint) {
    if (!parentPoint || !parentPoint.name) return '';
    const value = cleanCSVValue(name);
    const prefix = `${cleanCSVValue(parentPoint.name)} - `;
    if (!value.startsWith(prefix) || value.length <= prefix.length) return '';
    return value.slice(prefix.length).trim();
}

function normalizeCSVRow(rawItem) {
    const row = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const isJuniorRanger = isJuniorRangerRow(row);
    const info = isJuniorRanger ? buildJuniorRangerInfo(row) : getCSVValue(row, CSV_COLUMNS.INFO);
    const explicitSwag = getFirstPresentCSVValue(row, SWAG_TYPE_COLUMNS);
    const specialPrograms = getCSVValue(row, CSV_COLUMNS.SPECIAL_PROGRAMS);
    const jrSwagType = specialPrograms ? 'Special Programs' : 'Junior Ranger';

    return {
        parkId: getCSVValue(row, CSV_COLUMNS.PARK_ID),
        name: getCSVValue(row, CSV_COLUMNS.LOCATION),
        state: getCSVValue(row, CSV_COLUMNS.STATE),
        cost: getCSVValue(row, CSV_COLUMNS.SWAG_COST),
        category: getCSVValue(row, CSV_COLUMNS.TYPE),
        info,
        website: getCSVValue(row, CSV_COLUMNS.WEBSITE),
        pics: getCSVValue(row, CSV_COLUMNS.PICS),
        video: getCSVValue(row, CSV_COLUMNS.VIDEO),
        lat: getCSVValue(row, CSV_COLUMNS.LAT),
        lng: getCSVValue(row, CSV_COLUMNS.LNG),
        address: getCSVValue(row, CSV_COLUMNS.ADDRESS),
        historyTimelineInfo: getCSVValue(row, CSV_COLUMNS.HISTORY),
        specialPrograms,
        jrBooks: getCSVValue(row, CSV_COLUMNS.JR_BOOKS),
        swagType: isJuniorRanger
            ? jrSwagType
            : (explicitSwag.found ? normalizeSwagType(explicitSwag.value) : window.BARK.getSwagType(info))
    };
}

function getParkId(item) {
    const parkId = cleanCSVValue(item && item.parkId);
    return parkId ? String(parkId) : '';
}

function isLegacyParkId(id) {
    return /^-?\d+\.\d{2}_-?\d+\.\d{2}$/.test(cleanCSVValue(id));
}

function isCanonicalParkId(id) {
    const value = cleanCSVValue(id);
    return Boolean(value && value.toLowerCase() !== 'unknown' && !isLegacyParkId(value));
}

function stripPickupLocationInfoSections(info) {
    return String(info || '')
        .split(/\n{2,}/)
        .filter(section => {
            const text = String(section || '').trim();
            return !/^Special programs:/i.test(text) && !/^Junior Ranger books:/i.test(text);
        })
        .join('\n\n');
}

function processParsedResults(results, options = {}) {
    const newAllPoints = [];
    const seenParkIds = new Set();
    let currentPickupParent = null;
    let missingParkIdCount = 0;
    let duplicateParkIdCount = 0;
    let missingCoordinateCount = 0;
    const missingCoordinateSamples = [];

    results.data.forEach((rawItem, rowIndex) => {
        try {
            const item = normalizeCSVRow(rawItem);
            const name = item.name;
            const generatedPickupLocationLabel = getGeneratedPickupLocationLabel(name, currentPickupParent);
            const isPickupLocation = isPickupLocationRowName(name) || Boolean(generatedPickupLocationLabel);
            const pickupLocationLabel = generatedPickupLocationLabel || getPickupLocationLabel(name);
            const state = item.state;
            const cost = item.cost;
            const category = item.category;
            const agency = category;
            const info = item.info;
            const website = item.website;
            const pics = item.pics;
            const video = item.video;
            const address = item.address;
            const historyTimelineInfo = item.historyTimelineInfo;
            let lat = item.lat;
            let lng = item.lng;
            const id = getParkId(item);

            if (!isPickupLocation) {
                currentPickupParent = null;
            }

            if (!lat || !lng) {
                missingCoordinateCount++;
                if (missingCoordinateSamples.length < 5) {
                    missingCoordinateSamples.push({ rowNumber: rowIndex + 2, id, name });
                }
                return;
            }

            let swagType = item.swagType;
            let specialPrograms = item.specialPrograms;
            const parkCategory = window.BARK.getParkCategory(category);

            if (!id) {
                missingParkIdCount++;
                return;
            }
            if (!isCanonicalParkId(id)) {
                missingParkIdCount++;
                return;
            }
            if (seenParkIds.has(id)) {
                duplicateParkIdCount++;
                console.warn('[dataService] Skipped duplicate Park ID row. Production data must have one row per UUID.', {
                    rowNumber: rowIndex + 2,
                    id,
                    name
                });
                return;
            }
            seenParkIds.add(id);

            const parkData = {
                id,
                name,
                state,
                cost,
                swagType,
                agency,
                info,
                website,
                pics,
                video,
                address,
                historyTimelineInfo,
                lat,
                lng,
                parkCategory,
                specialPrograms,
                jrBooks: item.jrBooks,
                pickupLocations: []
            };

            if (isPickupLocation && currentPickupParent) {
                swagType = currentPickupParent.swagType;
                specialPrograms = '';
                parkData.swagType = swagType;
                parkData.specialPrograms = specialPrograms;
                parkData.jrBooks = '';
                parkData.info = stripPickupLocationInfoSections(parkData.info);
                parkData._isPickupLocation = true;
                parkData._pickupParentId = currentPickupParent.id;
                parkData._pickupParentName = currentPickupParent.name;
                parkData._pickupLocationName = pickupLocationLabel;
                currentPickupParent.pickupLocations.push({
                    id,
                    name,
                    displayName: pickupLocationLabel,
                    lat,
                    lng,
                    state
                });
                currentPickupParent._cachedPickupSearchText = window.BARK.normalizeText(
                    currentPickupParent.pickupLocations
                        .map(location => location.displayName)
                        .join(' ')
                );
            } else if (!isPickupLocation) {
                currentPickupParent = parkData;
            }

            // v25: Pre-Normalized Name
            parkData._cachedNormalizedName = window.BARK.normalizeText(name);

            parkData.category = parkCategory;
            newAllPoints.push(parkData);
        } catch (error) {
            console.error('[dataService] Failed to process CSV row; skipping row.', {
                rowNumber: rowIndex + 2,
                rawItem,
                error
            });
        }
    });

    if (missingParkIdCount > 0) {
        console.warn(`[dataService] Skipped ${missingParkIdCount} row(s) without Park ID. Production data must be UUID-only.`);
    }
    if (duplicateParkIdCount > 0) {
        console.warn(`[dataService] Skipped ${duplicateParkIdCount} duplicate Park ID row(s). Check the sheet before publishing.`);
    }
    if (missingCoordinateCount > 0) {
        console.warn(`[dataService] Skipped ${missingCoordinateCount} row(s) without coordinates. Add lat/lng before publishing new parks.`, {
            sampleRows: missingCoordinateSamples
        });
    }

    const parkRepo = window.BARK.repos && window.BARK.repos.ParkRepo;
    if (!parkRepo || typeof parkRepo.replaceAll !== 'function') {
        throw new Error('ParkRepo is required before dataService can publish park data.');
    }

    const replaceResult = parkRepo.replaceAll(newAllPoints, {
        debug: window.BARK.debugDataRefresh === true,
        source: options.source || AUTHORITATIVE_DATA_SOURCE
    });
    if (!replaceResult.accepted) return false;

    if (typeof window.BARK.populateProgramFilterOptions === 'function') {
        window.BARK.populateProgramFilterOptions(newAllPoints);
    }

    // Hydrate canonical counts for gamification
    if (window.gamificationEngine && newAllPoints.length > 0) {
        window.gamificationEngine.updateCanonicalCountsFromPoints(newAllPoints);
    }

    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    if (firebaseService && typeof firebaseService.normalizeLocalVisitedPlacesToCanonical === 'function') {
        firebaseService.normalizeLocalVisitedPlacesToCanonical({ writeBack: true })
            .catch(error => console.error('[dataService] visited-place canonicalization failed:', error));
    }

    window.syncState();
    return true;
}

function commitCSVCache(csvString, options = {}) {
    if (!options.cacheTime) return;
    localStorage.setItem(DATA_CACHE_KEY, csvString);
    localStorage.setItem(DATA_CACHE_TIME_KEY, String(options.cacheTime));
    localStorage.setItem(DATA_CACHE_SOURCE_KEY, options.source || AUTHORITATIVE_DATA_SOURCE);
}

function hasAcceptedParkData() {
    const parkRepo = window.BARK && window.BARK.repos && window.BARK.repos.ParkRepo;
    return Boolean(
        parkRepo &&
        typeof parkRepo.getAll === 'function' &&
        parkRepo.getAll().length > 0
    );
}

function parseCSVString(csvString, options = {}) {
    if (options.skipIfDataLoaded && hasAcceptedParkData()) return;

    if (isRendering) {
        pendingCSV = csvString;
        pendingCSVOptions = options;
        return;
    }
    isRendering = true;
    Papa.parse(csvString, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: 'greedy',
        transformHeader: header => cleanCSVValue(header),
        transform: value => cleanCSVValue(value),
        complete: function (results) {
            if (results.errors && results.errors.length) {
                console.warn('[dataService] CSV parse completed with recoverable row issues:', results.errors);
            }
            const accepted = processParsedResults(results, options);
            if (accepted) {
                commitCSVCache(csvString, options);
                if (typeof options.onAccepted === 'function') options.onAccepted();
            } else if (typeof options.onRejected === 'function') {
                options.onRejected();
            }
            isRendering = false;
            if (pendingCSV) {
                const next = pendingCSV;
                const nextOptions = pendingCSVOptions || {};
                pendingCSV = null;
                pendingCSVOptions = null;
                parseCSVString(next, nextOptions);
            }
        },
        error: function (err) {
            console.error('Error parsing CSV data:', err);
            if (typeof options.onRejected === 'function') options.onRejected(err);
            isRendering = false;
        }
    });
}

window.BARK.parseCSVString = parseCSVString;

function parseCSVStringAsPromise(csvString, options = {}) {
    return new Promise(resolve => {
        parseCSVString(csvString, {
            ...options,
            onAccepted: () => {
                if (typeof options.onAccepted === 'function') options.onAccepted();
                resolve(true);
            },
            onRejected: () => {
                if (typeof options.onRejected === 'function') options.onRejected();
                resolve(false);
            }
        });
    });
}

function buildLiveSourceUrl() {
    const separator = LIVE_SOURCE_CSV_URL.includes('?') ? '&' : '?';
    return `${LIVE_SOURCE_CSV_URL}${separator}cache_bypass=${Date.now()}`;
}

function startDataRefreshTimer() {
    if (dataRefreshTimer || window.location.protocol === 'file:') return;
    dataRefreshTimer = setInterval(() => {
        if (document.hidden || !navigator.onLine) return;
        loadLiveSourceData('scheduled sheet refresh');
    }, DATA_REFRESH_INTERVAL_MS);
}

function loadLiveSourceData(reason = 'live sheet source') {
    if (window.location.protocol === 'file:' || !navigator.onLine) return Promise.resolve(false);
    if (liveDataRefreshInFlight) return liveDataRefreshInFlight;

    liveDataRefreshInFlight = fetch(buildLiveSourceUrl(), { cache: 'no-store' })
        .then(res => {
            if (!res.ok) throw new Error(`Live source response was not ok: ${res.status}`);
            return res.text();
        })
        .then(csvString => {
            if (!csvString || csvString.trim().length < 10) throw new Error('Live source returned an empty catalog.');

            const liveHash = quickHash(csvString);
            if (hasAcceptedParkData() && liveHash === lastDataHash) return false;

            return parseCSVStringAsPromise(csvString, {
                cacheTime: Date.now(),
                source: AUTHORITATIVE_DATA_SOURCE,
                onAccepted: () => {
                    lastDataHash = liveHash;
                    rememberDataHash(liveHash, Date.now());
                    if (window.BARK.debugDataRefresh === true) {
                        console.info(`[dataService] Loaded live Junior Ranger sheet data (${reason}).`);
                    }
                }
            }).then(accepted => {
                if (!accepted) throw new Error('Live source data was rejected by the park repository.');
                return true;
            });
        })
        .catch(error => {
            console.warn('[dataService] Live Junior Ranger sheet data unavailable; keeping current data.', error);
            return false;
        })
        .finally(() => {
            liveDataRefreshInFlight = null;
        });

    return liveDataRefreshInFlight;
}

window.BARK.loadLiveSourceData = loadLiveSourceData;
window.BARK.startDataRefreshTimer = startDataRefreshTimer;

function loadStaticFallbackData(reason = 'unknown') {
    console.warn(`[dataService] Static fallback disabled (${reason}); the Junior Ranger map uses only the master spreadsheet feed.`);
    return Promise.resolve(false);
}

window.BARK.loadStaticFallbackData = loadStaticFallbackData;

// ====== STATIC DATA LOADING ======
function quickHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
    }
    return hash;
}

let lastDataHash = null;
let seenHashes = new Map();
const MAX_SEEN_DATA_HASHES = 64;

function pruneSeenHashes() {
    while (seenHashes.size > MAX_SEEN_DATA_HASHES) {
        const oldestHash = seenHashes.keys().next().value;
        if (oldestHash === lastDataHash && seenHashes.size > 1) {
            const currentHashTime = seenHashes.get(oldestHash);
            seenHashes.delete(oldestHash);
            seenHashes.set(oldestHash, currentHashTime);
            continue;
        }

        seenHashes.delete(oldestHash);
    }
}

function rememberDataHash(hash, revisionTime) {
    if (hash === null || hash === undefined) return;
    if (seenHashes.has(hash)) seenHashes.delete(hash);
    seenHashes.set(hash, revisionTime);
    pruneSeenHashes();
}

function clearLayerSafely(layer, label) {
    if (!layer || typeof layer.clearLayers !== 'function') return false;

    try {
        layer.clearLayers();
        return true;
    } catch (error) {
        console.warn(`[dataService] failed to clear ${label}:`, error);
        return false;
    }
}

function clearMarkerLayersSafely() {
    const markerLayerCleared = clearLayerSafely(window.BARK.markerLayer, 'markerLayer');
    const clusterLayerCleared = clearLayerSafely(window.BARK.markerClusterGroup, 'markerClusterGroup');

    if ((markerLayerCleared || clusterLayerCleared) && window.BARK.markerManager && window.BARK.markerManager.markers instanceof Map) {
        window.BARK.markerManager.markers.clear();
    }

    if (markerLayerCleared || clusterLayerCleared) {
        window.BARK.activePinMarker = null;
    }
}

function loadCachedData() {
    const cachedCsv = localStorage.getItem(DATA_CACHE_KEY);
    const cachedTime = localStorage.getItem(DATA_CACHE_TIME_KEY);
    const cachedSource = localStorage.getItem(DATA_CACHE_SOURCE_KEY);

    if (!cachedCsv) return false;
    if (cachedSource !== AUTHORITATIVE_DATA_SOURCE) {
        localStorage.removeItem(DATA_CACHE_KEY);
        localStorage.removeItem(DATA_CACHE_TIME_KEY);
        localStorage.removeItem(DATA_CACHE_SOURCE_KEY);
        return false;
    }
    lastDataHash = quickHash(cachedCsv);
    rememberDataHash(lastDataHash, cachedTime ? parseInt(cachedTime, 10) : Date.now());
    parseCSVString(cachedCsv, { source: AUTHORITATIVE_DATA_SOURCE });
    return true;
}

function loadData() {
    LEGACY_DATA_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
    if (localStorage.getItem(DATA_CACHE_SOURCE_KEY) !== AUTHORITATIVE_DATA_SOURCE) {
        localStorage.removeItem(DATA_CACHE_KEY);
        localStorage.removeItem(DATA_CACHE_TIME_KEY);
        localStorage.removeItem(DATA_CACHE_SOURCE_KEY);
    }
    startDataRefreshTimer();

    if (!navigator.onLine) {
        const loadedCachedData = loadCachedData();
        const premiumService = window.BARK && window.BARK.services && window.BARK.services.premium;
        const isPremium = Boolean(
            premiumService &&
            typeof premiumService.isPremium === 'function' &&
            premiumService.isPremium()
        );
        if (!isPremium && !loadedCachedData) {
            alert('Network disconnected. Log in via the Profile tab to enable Premium Offline Mode.');
            clearMarkerLayersSafely();
        }
        return;
    }

    loadLiveSourceData('initial sheet load')
        .then(loadedLiveData => {
            if (loadedLiveData || hasAcceptedParkData()) return true;
            return false;
        })
        .then(loadedAuthoritativeData => {
            if (!loadedAuthoritativeData && !hasAcceptedParkData()) loadCachedData();
        });
}

window.BARK.loadData = loadData;
window.BARK.safeDataPoll = () => false;
window.BARK.clearMarkerLayersSafely = clearMarkerLayersSafely;

// ====== VERSION CHECK ======
let pollErrorCount = 0;

async function safePoll() {
    if (document.hidden) {
        setTimeout(safePoll, 10000);
        return;
    }

    try {
        await checkForUpdates();
        pollErrorCount = 0;
    } catch (err) {
        if (err.message && err.message.includes("Safety Shutdown")) {
            console.error("KILL SWITCH: Terminating Version Poll.");
            return;
        }
        pollErrorCount++;
        console.error("Update check failed, backing off...", err);
    }

    const nextInterval = pollErrorCount > 5 ? 60000 : 30000;
    setTimeout(safePoll, nextInterval);
}

async function checkForUpdates() {
    if (!navigator.onLine || window.location.protocol === 'file:') return;

    window.BARK.incrementRequestCount();

    const res = await fetch('version.json?cache_bypass=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('version.json not found');

    const data = await res.json();
    const remoteVersion = parseInt(data.version);
    const seenVersion = parseInt(localStorage.getItem('bark_seen_version') || '0');

    const versionLabel = document.getElementById('settings-app-version');
    if (versionLabel) versionLabel.textContent = remoteVersion;

    if (data.version && remoteVersion !== seenVersion) {
        const toast = document.getElementById('update-toast');
        if (toast) toast.classList.add('show');

        localStorage.setItem('bark_seen_version', remoteVersion);
        window.BARK.setAppVersion(remoteVersion);
    }
}

window.BARK.safePoll = safePoll;
