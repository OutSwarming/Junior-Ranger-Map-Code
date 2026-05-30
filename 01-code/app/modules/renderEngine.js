/**
 * renderEngine.js — Marker Rendering Pipeline & Central Heartbeat
 * Owns updateMarkers(), syncState(), safeUpdateHTML(), and marker helper functions.
 * Loaded FOURTH in the boot sequence.
 */
window.BARK = window.BARK || {};

function getParkRepo() {
    return window.BARK.repos && window.BARK.repos.ParkRepo;
}

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function hasRenderVisitedPlace(placeOrId) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function') {
        return vaultRepo.hasVisit(placeOrId);
    }

    return false;
}

// ====== MARKER HELPER FUNCTIONS ======
function getColor(type) {
    if (type === 'Tag') return '#2196F3';
    if (type === 'Bandana') return '#FF9800';
    if (type === 'Certificate') return '#4CAF50';
    return '#9E9E9E';
}

function getBadgeClass(type) {
    if (type === 'Tag') return 'tag';
    if (type === 'Bandana') return 'bandana';
    if (type === 'Certificate') return 'certificate';
    return 'other';
}

function getParkCategory(typeString) {
    if (!typeString) return 'Other';
    const t = String(typeString).trim().toLowerCase();
    if (t === 'nps' || t.includes('national park service')) return 'National';
    if (t === 'national' || t.includes('national')) return 'National';
    if (t === 'sp' || t.includes('state park') || t.includes('state forest')) return 'State';
    if (t === 'state' || t.includes('state')) return 'State';
    return 'Other';
}

function getSwagType(info) {
    if (!info) return 'Other';
    const lower = String(info).toLowerCase();
    if (lower.includes('tag')) return 'Tag';
    if (lower.includes('bandana') || lower.includes('vest')) return 'Bandana';
    if (lower.includes('certificate') || lower.includes('pledge')) return 'Certificate';
    return 'Other';
}

function getParkAgencyFilterKey(parkData = {}) {
    if (window.MapMarkerConfig && typeof window.MapMarkerConfig.getAgencyKey === 'function') {
        return window.MapMarkerConfig.getAgencyKey(parkData);
    }
    if (typeof MapMarkerConfig !== 'undefined' && typeof MapMarkerConfig.getAgencyKey === 'function') {
        return MapMarkerConfig.getAgencyKey(parkData);
    }
    return 'other';
}

function matchesParkTypeFilter(parkData, activeTypeFilter) {
    const filter = activeTypeFilter || 'all';
    if (filter === 'all') return true;

    if (filter === 'National') return getParkAgencyFilterKey(parkData) === 'nps';
    if (filter === 'State') return getParkAgencyFilterKey(parkData) === 'state-park';
    if (filter === 'Other') return getParkAgencyFilterKey(parkData) === 'other';

    return getParkAgencyFilterKey(parkData) === filter;
}

function getSpecialProgramFilterLabels(value) {
    const seen = new Set();
    return String(value || '')
        .split(/[|\n;]+/)
        .map(part => part.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim())
        .filter(Boolean)
        .filter(label => {
            const key = getProgramFilterKey(label);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function getProgramFilterKey(label) {
    return String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function shouldShowProgramFilterLabel(label) {
    const key = getProgramFilterKey(label);
    return Boolean(key && key !== 'junior ranger');
}

const MIN_PROGRAM_FILTER_PARKS = 3;

function getProgramFilterSourcePoint(parkData) {
    if (!parkData || !parkData._isPickupLocation || !parkData._pickupParentId) return parkData;
    const parkRepo = getParkRepo();
    return parkRepo && typeof parkRepo.getById === 'function'
        ? (parkRepo.getById(parkData._pickupParentId) || parkData)
        : parkData;
}

function matchesProgramFilter(parkData, activeProgramFilter) {
    const filterKey = getProgramFilterKey(activeProgramFilter || 'all');
    if (!filterKey || filterKey === 'all') return true;

    const sourcePoint = getProgramFilterSourcePoint(parkData);
    return getSpecialProgramFilterLabels(sourcePoint && sourcePoint.specialPrograms)
        .some(label => getProgramFilterKey(label) === filterKey);
}

function getAvailableProgramFilters(points = []) {
    const labelsByKey = new Map();
    const parkIdsByKey = new Map();
    points.forEach(point => {
        if (point && point._isPickupLocation) return;
        const pointProgramKeys = new Set();
        getSpecialProgramFilterLabels(point && point.specialPrograms).forEach(label => {
            if (!shouldShowProgramFilterLabel(label)) return;
            const key = getProgramFilterKey(label);
            if (!labelsByKey.has(key)) labelsByKey.set(key, label);
            pointProgramKeys.add(key);
        });

        const pointId = (point && point.id) || point;
        pointProgramKeys.forEach(key => {
            if (!parkIdsByKey.has(key)) parkIdsByKey.set(key, new Set());
            parkIdsByKey.get(key).add(pointId);
        });
    });

    return Array.from(labelsByKey.entries())
        .filter(([key]) => (parkIdsByKey.get(key) || new Set()).size >= MIN_PROGRAM_FILTER_PARKS)
        .map(([, label]) => label)
        .sort((a, b) => a.localeCompare(b));
}

function populateProgramFilterOptions(points) {
    const select = document.getElementById('program-filter');
    if (!select) return;

    const parkRepo = getParkRepo();
    const sourcePoints = Array.isArray(points)
        ? points
        : (parkRepo && typeof parkRepo.getAll === 'function' ? parkRepo.getAll() : []);
    const labels = getAvailableProgramFilters(sourcePoints);
    const previousValue = select.value || window.BARK.activeProgramFilter || 'all';
    const previousKey = getProgramFilterKey(previousValue);

    select.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Regional/National Programs';
    select.appendChild(allOption);

    labels.forEach(label => {
        const option = document.createElement('option');
        option.value = label;
        option.textContent = label;
        select.appendChild(option);
    });

    const stillAvailable = previousKey === 'all' || labels.some(label => getProgramFilterKey(label) === previousKey);
    select.value = stillAvailable ? previousValue : 'all';
    window.BARK.activeProgramFilter = select.value;
}

function formatSwagLinks(text) {
    if (!text) return '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);
    if (!urls) return '';

    let resultHTML = '';
    urls.forEach((url, index) => {
        try {
            const parsedUrl = new URL(url.replace(/['",]+$/, ''));
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return;
            resultHTML += `<a href="${parsedUrl.href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" class="swag-link-btn">📷 Swag Pic ${index + 1}</a> `;
        } catch (_error) {
            // Ignore malformed sheet URLs; marker panels hide the picture section if none survive validation.
        }
    });
    return resultHTML.trim();
}

window.BARK.getColor = getColor;
window.BARK.getBadgeClass = getBadgeClass;
window.BARK.getParkCategory = getParkCategory;
window.BARK.getParkAgencyFilterKey = getParkAgencyFilterKey;
window.BARK.matchesParkTypeFilter = matchesParkTypeFilter;
window.BARK.getSpecialProgramFilterLabels = getSpecialProgramFilterLabels;
window.BARK.matchesProgramFilter = matchesProgramFilter;
window.BARK.getAvailableProgramFilters = getAvailableProgramFilters;
window.BARK.populateProgramFilterOptions = populateProgramFilterOptions;
window.BARK.getSwagType = getSwagType;
window.BARK.formatSwagLinks = formatSwagLinks;

// ====== DOM PROTECTION ======
/**
 * 🧊 Prevents "Layout Thrashing" by verifying content changes before painting.
 */
function safeUpdateHTML(elementId, newHTML) {
    const el = document.getElementById(elementId);
    if (el && el.innerHTML !== newHTML) {
        el.innerHTML = newHTML;
    }
}
window.BARK.safeUpdateHTML = safeUpdateHTML;

// ====== THE HEARTBEAT (v25) ======
/**
 * 💓 Batches DOM updates into a single frame buffer.
 */
let syncScheduled = false;
let lastMarkerVisibilityStateKey = null;
let lastSyncedMarkerDataRevision = null;
let markerVisibilityRevision = 0;
const ACHIEVEMENT_EVAL_DEBOUNCE_MS = 3000;
let achievementEvalTimer = null;
let achievementEvalInProgress = false;
let achievementEvalRequestedDuringRun = false;

function serializeSet(set) {
    return Array.from(set || []).sort().join(',');
}

function getVisitedIdsCacheKey() {
    if (typeof window.BARK._visitedIdsCacheKey === 'string') {
        return window.BARK._visitedIdsCacheKey;
    }

    const vaultRepo = getVaultRepo();
    const visitedIds = vaultRepo && typeof vaultRepo.getVisitedIds === 'function'
        ? vaultRepo.getVisitedIds()
        : [];
    window.BARK._visitedIdsCacheKey = Array.from(visitedIds).sort().join(',');
    return window.BARK._visitedIdsCacheKey;
}

function getTripRouteParkIds() {
    const tripLayer = window.BARK && window.BARK.tripLayer;
    if (tripLayer && typeof tripLayer.getStopParkIds === 'function') {
        const ids = tripLayer.getStopParkIds();
        if (ids instanceof Set) return ids;
    }

    const days = Array.isArray(window.BARK && window.BARK.tripDays) ? window.BARK.tripDays : [];
    const ids = new Set();
    days.forEach(day => {
        const stops = Array.isArray(day && day.stops) ? day.stops : [];
        stops.forEach(stop => {
            if (stop && typeof stop.id === 'string' && stop.id.trim()) ids.add(stop.id.trim());
        });
    });
    return ids;
}

function getTripRouteParkIdsCacheKey() {
    return Array.from(getTripRouteParkIds()).sort().join(',');
}

function getExpandedPickupParentIds() {
    if (!(window.BARK.expandedPickupParentIds instanceof Set)) {
        window.BARK.expandedPickupParentIds = new Set();
    }
    return window.BARK.expandedPickupParentIds;
}

function serializeExpandedPickupParentIds() {
    return serializeSet(getExpandedPickupParentIds());
}

function isPickupGroupExpanded(parentId) {
    return Boolean(parentId && getExpandedPickupParentIds().has(parentId));
}

function isPickupLocationVisible(parkData) {
    if (!parkData || !parkData._isPickupLocation) return true;
    return isPickupGroupExpanded(parkData._pickupParentId);
}

function getPickupGroupPoints(parentId) {
    const parkRepo = getParkRepo();
    const allPoints = parkRepo ? parkRepo.getAll() : [];
    return allPoints.filter(point => point && (point.id === parentId || point._pickupParentId === parentId));
}

function framePickupGroup(parentId) {
    const map = getUsableMap();
    if (!map || window.stopAutoMovements) return;

    const bounds = L.latLngBounds();
    getPickupGroupPoints(parentId).forEach(point => {
        const lat = Number(point.lat);
        const lng = Number(point.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) bounds.extend([lat, lng]);
    });
    if (!bounds.isValid()) return;

    map.flyToBounds(bounds, {
        padding: [50, 90],
        maxZoom: 11,
        duration: window.lowGfxEnabled ? 0 : 0.6,
        animate: !window.lowGfxEnabled
    });
}

function setPickupGroupExpanded(parentId, expanded, options = {}) {
    if (!parentId) return false;
    const expandedIds = getExpandedPickupParentIds();
    const wasExpanded = expandedIds.has(parentId);
    if (expanded) expandedIds.add(parentId);
    else expandedIds.delete(parentId);
    if (wasExpanded === expandedIds.has(parentId)) return false;

    window.BARK.invalidateMarkerVisibility();
    if (typeof window.syncState === 'function') window.syncState();
    if (expanded && options.frame !== false) {
        window.setTimeout(() => framePickupGroup(parentId), 80);
    }
    return true;
}

function getTargetMarkerLayerType(zoom) {
    if (window.BARK.getMarkerLayerPolicy) return window.BARK.getMarkerLayerPolicy(zoom).layerType;
    const forceNoClustering = window.premiumClusteringEnabled && zoom >= 7;
    return (window.clusteringEnabled && !forceNoClustering) ? 'cluster' : 'plain';
}

function isMapVisibleByDefaultViewState() {
    // The map is the implicit/default view; app tabs are represented by `.ui-view.active`.
    return !document.querySelector('.ui-view.active');
}

function isUsableLeafletMap(map) {
    return Boolean(
        map &&
        typeof map.getZoom === 'function' &&
        typeof map.getBounds === 'function' &&
        typeof map.getContainer === 'function'
    );
}

function getUsableMap() {
    return isUsableLeafletMap(window.map) ? window.map : null;
}

function isMapViewportReady(map) {
    if (!isUsableLeafletMap(map) || !isMapVisibleByDefaultViewState()) return false;
    const container = map.getContainer();
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function shouldCullPlainMarkers(zoom) {
    const map = getUsableMap();
    if (!isMapViewportReady(map)) return false;
    if (window.BARK.getMarkerLayerPolicy) {
        const policy = window.BARK.getMarkerLayerPolicy(zoom);
        return policy.layerType === 'plain' && policy.cullPlainMarkers;
    }
    return Boolean(window.viewportCulling);
}

function getAutoFramePaddingPoint(padding) {
    const x = Array.isArray(padding) ? Number(padding[0]) || 0 : 0;
    const y = Array.isArray(padding) ? Number(padding[1]) || 0 : 0;
    return L.point(x * 2, y * 2);
}

function boundsFitAtZoom(map, bounds, zoom, padding) {
    if (!map || !bounds || !bounds.isValid()) return false;
    if (typeof map.project !== 'function' || typeof map.getSize !== 'function') return true;

    const availableSize = map.getSize().subtract(getAutoFramePaddingPoint(padding));
    if (availableSize.x <= 0 || availableSize.y <= 0) return false;

    const northWest = map.project(bounds.getNorthWest(), zoom);
    const southEast = map.project(bounds.getSouthEast(), zoom);
    const boundsSize = L.point(
        Math.abs(southEast.x - northWest.x),
        Math.abs(southEast.y - northWest.y)
    );

    return boundsSize.x <= availableSize.x + 1 && boundsSize.y <= availableSize.y + 1;
}

function canAutoFrameBounds(map, bounds, padding) {
    if (!map || !bounds || !bounds.isValid()) return false;

    const policy = window.BARK.getMarkerLayerPolicy
        ? window.BARK.getMarkerLayerPolicy(map.getZoom())
        : { limitZoomOut: Boolean(window.limitZoomOut), minZoom: null };

    if (!policy.limitZoomOut) return true;

    const minZoom = policy.minZoom === null || policy.minZoom === undefined
        ? (typeof map.getMinZoom === 'function' ? map.getMinZoom() : 0)
        : policy.minZoom;

    return boundsFitAtZoom(map, bounds, minZoom, padding);
}

function getMarkerVisibilityStateKey() {
    const map = getUsableMap();
    const searchCache = window.BARK._searchResultCache || {};
    const searchCacheIds = searchCache.matchedIds ? Array.from(searchCache.matchedIds).sort().join(',') : '';
    const searchCacheStatus = searchCache.complete === false ? 'search-partial' : 'search-complete';
    const routeParkIds = getTripRouteParkIdsCacheKey();
    const visitedIds = getVisitedIdsCacheKey();
    const zoom = map ? map.getZoom() : 0;
    const shouldCull = shouldCullPlainMarkers(zoom);
    const viewportKey = shouldCull && map
        ? map.getBounds().pad(0.2).toBBoxString()
        : '';

    return [
        window.BARK._markerDataRevision || 0,
        serializeSet(window.BARK.activeSwagFilters),
        window.BARK.activeSearchQuery || '',
        window.BARK.activeTypeFilter || 'all',
        window.BARK.activeProgramFilter || 'all',
        window.BARK.visitedFilterState || 'all',
        routeParkIds,
        visitedIds,
        serializeExpandedPickupParentIds(),
        searchCache.query || '',
        searchCacheStatus,
        searchCacheIds,
        window.clusteringEnabled ? 'cluster-on' : 'cluster-off',
        window.premiumClusteringEnabled ? 'premium-cluster-on' : 'premium-cluster-off',
        window.standardClusteringEnabled ? 'standard-cluster-on' : 'standard-cluster-off',
        window.lowGfxEnabled ? 'low-gfx-on' : 'low-gfx-off',
        window.forcePlainMarkers ? 'force-plain-on' : 'force-plain-off',
        window.stopResizing ? 'stop-resizing-on' : 'stop-resizing-off',
        window.viewportCulling ? 'viewport-culling-on' : 'viewport-culling-off',
        window.limitZoomOut ? 'limit-zoom-on' : 'limit-zoom-off',
        getTargetMarkerLayerType(zoom),
        shouldCull ? zoom : '',
        viewportKey
    ].join('|');
}

window.BARK.invalidateMarkerVisibility = function () {
    lastMarkerVisibilityStateKey = null;
};
window.BARK.invalidateMarkerDataSync = function () {
    lastSyncedMarkerDataRevision = null;
    window.BARK.invalidateMarkerVisibility();
};
window.BARK.invalidateVisitedIdsCache = function () {
    window.BARK._visitedIdsCacheKey = null;
    window.BARK.invalidateMarkerVisibility();
};
window.BARK.isPickupGroupExpanded = isPickupGroupExpanded;
window.BARK.isPickupLocationVisible = isPickupLocationVisible;
window.BARK.setPickupGroupExpanded = setPickupGroupExpanded;
window.BARK.showPickupGroup = function (parentId, options = {}) {
    return setPickupGroupExpanded(parentId, true, options);
};
window.BARK.hidePickupGroup = function (parentId, options = {}) {
    return setPickupGroupExpanded(parentId, false, options);
};
window.BARK.isMapVisibleByDefaultViewState = isMapVisibleByDefaultViewState;
window.BARK.isMapViewActive = isMapVisibleByDefaultViewState;
window.BARK.isUsableLeafletMap = isUsableLeafletMap;
window.BARK.getUsableMap = getUsableMap;

function scheduleAchievementEvaluation() {
    if (typeof window.BARK.evaluateAchievements !== 'function') return;

    clearTimeout(achievementEvalTimer);
    achievementEvalTimer = setTimeout(runAchievementEvaluation, ACHIEVEMENT_EVAL_DEBOUNCE_MS);
}

async function runAchievementEvaluation() {
    achievementEvalTimer = null;
    if (typeof window.BARK.evaluateAchievements !== 'function') return;

    if (achievementEvalInProgress) {
        achievementEvalRequestedDuringRun = true;
        return;
    }

    achievementEvalInProgress = true;
    try {
        await window.BARK.evaluateAchievements();
    } catch (error) {
        console.error('[renderEngine] achievement evaluation failed:', error);
    } finally {
        achievementEvalInProgress = false;
        if (achievementEvalRequestedDuringRun) {
            achievementEvalRequestedDuringRun = false;
            scheduleAchievementEvaluation();
        }
    }
}

window.syncState = function () {
    if (syncScheduled) return;
    syncScheduled = true;
    window.requestAnimationFrame(() => {
        syncScheduled = false;
        if (typeof window.BARK.updateMarkers === 'function') {
            if (!isMapVisibleByDefaultViewState()) {
                window.BARK._pendingMarkerSync = true;
            } else if (!getUsableMap()) {
                window.BARK._pendingMarkerSync = true;
            } else if (window.BARK._isZooming) {
                window.BARK._pendingMarkerSync = true;
            } else {
                const markerVisibilityStateKey = getMarkerVisibilityStateKey();
                if (markerVisibilityStateKey !== lastMarkerVisibilityStateKey) {
                    lastMarkerVisibilityStateKey = markerVisibilityStateKey;
                    window.BARK.updateMarkers();
                }
            }
        }
        if (typeof window.BARK.updateStatsUI === 'function') {
            window.BARK.updateStatsUI();
        }
        scheduleAchievementEvaluation();
    });
};

// ====== THE RENDERING ENGINE — updateMarkers() ======
function updateMarkers() {
    const map = getUsableMap();
    if (!map) {
        window.BARK._pendingMarkerSync = true;
        return;
    }

    const parkRepo = getParkRepo();
    const allPoints = parkRepo ? parkRepo.getAll() : [];
    const activeSwagFilters = window.BARK.activeSwagFilters;
    const activeSearchQuery = window.BARK.activeSearchQuery;
    const activeTypeFilter = window.BARK.activeTypeFilter;
    const activeProgramFilter = window.BARK.activeProgramFilter;
    const visitedFilterState = window.BARK.visitedFilterState;
    const tripRouteParkIds = visitedFilterState === 'route' ? getTripRouteParkIds() : null;
    const _searchResultCache = window.BARK._searchResultCache;
    const queryNorm = window.BARK.normalizeText(activeSearchQuery);
    const cachedSearch = _searchResultCache || {};
    const searchCacheMatchesQuery = Boolean(queryNorm && cachedSearch.query === queryNorm && cachedSearch.matchedIds);
    const searchCacheComplete = !searchCacheMatchesQuery || cachedSearch.complete !== false;

    const currentZoom = map.getZoom();
    const targetLayerType = getTargetMarkerLayerType(currentZoom);
    const shouldCull = shouldCullPlainMarkers(currentZoom);

    let visibleBounds = L.latLngBounds();
    const screenBounds = map.getBounds().pad(0.2);
    const activeMarkerIds = new Set();

    // Collect DOM writes to batch them (avoids layout thrashing)
    const markerClassUpdates = [];

    const markerDataRevision = window.BARK._markerDataRevision || 0;
    if (window.BARK.markerManager && markerDataRevision !== lastSyncedMarkerDataRevision) {
        window.BARK.markerManager.sync(allPoints, { applyLayers: false });
        lastSyncedMarkerDataRevision = markerDataRevision;
    }

    allPoints.forEach(item => {
        const matchesSwag = activeSwagFilters.size === 0 || activeSwagFilters.has(item.swagType);
        const nameNorm = [
            item._cachedNormalizedName || window.BARK.normalizeText(item.name),
            item._cachedPickupSearchText || ''
        ].filter(Boolean).join(' ');
        let matchesSearch = true;

        if (activeSearchQuery) {
            if (!queryNorm) {
                matchesSearch = true;
            } else if (searchCacheMatchesQuery) {
                matchesSearch = cachedSearch.matchedIds.has(item.id);
            } else {
                matchesSearch = nameNorm.includes(queryNorm);
            }
        }

        const matchesType = matchesParkTypeFilter(item, activeTypeFilter);
        const matchesProgram = matchesProgramFilter(item, activeProgramFilter);
        let matchesVisited = true;
        const isVisited = typeof window.BARK.isParkVisited === 'function'
            ? window.BARK.isParkVisited(item)
            : hasRenderVisitedPlace(item);
        if (visitedFilterState === 'visited' && !isVisited) matchesVisited = false;
        if (visitedFilterState === 'unvisited' && isVisited) matchesVisited = false;
        if (visitedFilterState === 'route') matchesVisited = Boolean(tripRouteParkIds && tripRouteParkIds.has(item.id));

        // Trip stops no longer force park-marker visibility (Fix #19); the trip
        // overlay layer renders badges independently. Removing this OR-clause +
        // per-park tripDays scan is a real RAF perf win.
        let isVisible = matchesSwag && matchesSearch && matchesType && matchesProgram && matchesVisited;

        if (isVisible && !isPickupLocationVisible(item)) {
            isVisible = false;
        }

        // 🎯 VIEWPORT CULLING: Skip off-screen pins entirely
        if (isVisible && shouldCull && !screenBounds.contains([item.lat, item.lng])) {
            isVisible = false;
        }

        item.marker._barkIsVisible = isVisible;

        // 🎯 PURE CSS HIDE/SHOW: No Leaflet API calls, no cluster recalculation, no animation.
        if (isVisible) {
            activeMarkerIds.add(item.id);
            visibleBounds.extend(item.marker.getLatLng());

            if (item.marker._icon) {
                item.marker._icon.classList.remove('marker-filter-hidden');
                markerClassUpdates.push({ icon: item.marker._icon, isVisited });
            }
        } else {
            if (item.marker._icon) {
                item.marker._icon.classList.add('marker-filter-hidden');
            }
        }
    });

    markerVisibilityRevision++;
    window.BARK._markerVisibilityRevision = markerVisibilityRevision;

    if (window.BARK.markerManager && typeof window.BARK.markerManager.applyVisibility === 'function') {
        const forceLayerReset = window.BARK._forceMarkerLayerReset === true;
        window.BARK._forceMarkerLayerReset = false;
        window.BARK.markerManager.applyVisibility(allPoints, { forceReset: forceLayerReset });
    }

    // 🏭 BATCH: Apply visited-pin class (avoids interleaved read/write layout thrash)
    markerClassUpdates.forEach(({ icon, isVisited }) => {
        icon.classList.toggle('visited-pin', isVisited);
        icon.classList.toggle('visited-marker', isVisited);
        icon.classList.toggle('unvisited-marker', !isVisited);
    });

    if (window.BARK.tripLayer && typeof window.BARK.tripLayer.refreshBadgeStyles === 'function') {
        window.BARK.tripLayer.refreshBadgeStyles();
    }

    window.BARK._lastLayerType = targetLayerType;

    // 🎯 SMART AUTO-FRAMING (Interrupt Protection)
    const hasLongSearchQuery = activeSearchQuery.length > 2;
    const currentFilterState = [
        activeSearchQuery,
        Array.from(activeSwagFilters).join(','),
        activeProgramFilter || 'all',
        hasLongSearchQuery && searchCacheMatchesQuery && !searchCacheComplete ? 'search-partial' : 'search-complete'
    ].join('|');

    if (window._lastFilterState !== currentFilterState) {
        window._lastFilterState = currentFilterState;

        const autoFramePadding = [50, 50];
        if (
            !window.stopAutoMovements &&
            searchCacheComplete &&
            (activeSwagFilters.size > 0 || (activeProgramFilter && activeProgramFilter !== 'all') || hasLongSearchQuery) &&
            canAutoFrameBounds(map, visibleBounds, autoFramePadding)
        ) {
            map.flyToBounds(visibleBounds, {
                padding: autoFramePadding,
                maxZoom: 12,
                duration: window.lowGfxEnabled ? 0 : 0.8,
                animate: !window.lowGfxEnabled
            });
        }
    }
}

window.BARK.updateMarkers = updateMarkers;
