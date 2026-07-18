(function () {
    window.BARK = window.BARK || {};
    window.BARK.services = window.BARK.services || {};

    const BADGE_MANIFEST_URL = 'assets/data/badge-manifest.json';
    const FALLBACK_CSV_URL = 'assets/data/jr-fallback.csv';
    const PROXIED_IMAGE_HOSTS = new Set([
        'mymaps.usercontent.google.com',
        'lh3.googleusercontent.com',
        'lh4.googleusercontent.com',
        'lh5.googleusercontent.com',
        'lh6.googleusercontent.com'
    ]);
    let manifestPromise = null;
    let fallbackBadgeIndexPromise = null;

    function cleanText(value) {
        return String(value || '').trim();
    }

    function normalizePinId(value) {
        return cleanText(value);
    }

    function normalizeLookupText(value) {
        return cleanText(value)
            .toLowerCase()
            .replace(/^\(?\d+\s+of\s+\d+\)?\s*/i, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function getStateNameKey(state, name) {
        const normalizedState = normalizeLookupText(state);
        const normalizedName = normalizeLookupText(name);
        return normalizedState && normalizedName ? `${normalizedState}|${normalizedName}` : '';
    }

    function shouldProxyImageUrl(imageUrl) {
        try {
            const url = new URL(imageUrl);
            return url.protocol === 'https:' && PROXIED_IMAGE_HOSTS.has(url.hostname);
        } catch (_error) {
            return false;
        }
    }

    function getDisplayImageUrl(imageUrl) {
        const cleanedUrl = cleanText(imageUrl);
        return shouldProxyImageUrl(cleanedUrl)
            ? `/api/badge-image?url=${encodeURIComponent(cleanedUrl)}`
            : cleanedUrl;
    }

    function getSafeHttpUrls(value) {
        if (!value || typeof value !== 'string') return [];
        const seen = new Set();
        const matches = value.match(/https?:\/\/[^\s]+/g) || [];
        return matches
            .map(rawUrl => rawUrl.replace(/['",]+$/, ''))
            .map(rawUrl => {
                try {
                    const url = new URL(rawUrl);
                    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
                } catch (_error) {
                    return null;
                }
            })
            .filter(Boolean)
            .filter(url => {
                if (seen.has(url)) return false;
                seen.add(url);
                return true;
            });
    }

    function normalizeBadge(rawBadge, index) {
        if (!rawBadge || typeof rawBadge !== 'object') return null;
        const imageUrl = cleanText(rawBadge.imageUrl || rawBadge.url || rawBadge.badgeImageUrl || rawBadge['Badge Image URL']);
        const thumbnailUrl = cleanText(rawBadge.thumbnailUrl || rawBadge.thumbUrl || rawBadge.thumbnail || imageUrl);
        if (!imageUrl) return null;

        return {
            id: cleanText(rawBadge.id || rawBadge.badgeId || rawBadge['Badge ID'] || `badge-${index + 1}`),
            title: cleanText(rawBadge.title || rawBadge.badgeTitle || rawBadge['Badge Title'] || `Badge ${index + 1}`),
            type: cleanText(rawBadge.type || rawBadge.badgeType || rawBadge['Badge Type'] || 'Badge'),
            imageUrl,
            thumbnailUrl,
            source: cleanText(rawBadge.source || rawBadge.imageSource || rawBadge['Source'] || 'badge-manifest')
        };
    }

    async function loadManifest() {
        if (!manifestPromise) {
            manifestPromise = fetch(BADGE_MANIFEST_URL, { cache: 'force-cache' })
                .then(response => response.ok ? response.json() : { badgesByPinId: {} })
                .catch(error => {
                    console.warn('[badgeImageService] Badge manifest unavailable; using CSV badge pictures only.', error);
                    return { badgesByPinId: {} };
                });
        }
        return manifestPromise;
    }

    async function loadFallbackBadgeIndex() {
        if (!fallbackBadgeIndexPromise) {
            fallbackBadgeIndexPromise = fetch(FALLBACK_CSV_URL, { cache: 'force-cache' })
                .then(response => response.ok ? response.text() : '')
                .then(csvText => {
                    const index = { byPinId: {}, byStateName: {} };
                    if (!csvText || !window.Papa || typeof window.Papa.parse !== 'function') return index;
                    const parsed = window.Papa.parse(csvText, {
                        header: true,
                        skipEmptyLines: true
                    });
                    (parsed.data || []).forEach(row => {
                        const pinId = normalizePinId(row.siteID);
                        const stateNameKey = getStateNameKey(row.state, row.siteName);
                        const urls = getSafeHttpUrls(row.badgePictures || '');
                        if (!urls.length) return;
                        const badges = urls.map((url, index) => ({
                            id: `fallback-picture-${index + 1}`,
                            title: `Badge Picture ${index + 1}`,
                            type: 'Badge Picture',
                            imageUrl: url,
                            thumbnailUrl: url,
                            source: 'bundled-fallback'
                        }));
                        if (pinId && !index.byPinId[pinId]) index.byPinId[pinId] = badges;
                        if (stateNameKey && !index.byStateName[stateNameKey]) index.byStateName[stateNameKey] = badges;
                    });
                    return index;
                })
                .catch(error => {
                    console.warn('[badgeImageService] Fallback badge picture index unavailable.', error);
                    return {};
                });
        }
        return fallbackBadgeIndexPromise;
    }

    async function getBadgesForPlace(place = {}) {
        const normalizedPinId = normalizePinId(place.id || place.pinId || place.siteID);
        const stateNameKey = getStateNameKey(place.state, place.name || place.siteName);
        const [manifest, fallbackIndex] = await Promise.all([
            loadManifest(),
            loadFallbackBadgeIndex()
        ]);
        const badgesByPinId = manifest && manifest.badgesByPinId && typeof manifest.badgesByPinId === 'object'
            ? manifest.badgesByPinId
            : {};
        const manifestBadges = badgesByPinId[normalizedPinId];
        const fallbackBadges = fallbackIndex.byPinId[normalizedPinId] || fallbackIndex.byStateName[stateNameKey];
        return (Array.isArray(manifestBadges) ? manifestBadges.map(normalizeBadge).filter(Boolean) : [])
            .concat(Array.isArray(fallbackBadges) ? fallbackBadges : []);
    }

    async function getBadgesForPin(pinId) {
        return getBadgesForPlace({ id: pinId });
    }

    window.BARK.services.badgeImages = {
        getDisplayImageUrl,
        getBadgesForPlace,
        getBadgesForPin,
        getStateNameKey,
        loadManifest,
        normalizePinId,
        shouldProxyImageUrl
    };
})();
