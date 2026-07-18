(function () {
    window.BARK = window.BARK || {};
    window.BARK.services = window.BARK.services || {};

    const BADGE_MANIFEST_URL = 'assets/data/badge-manifest.json?v=safefood-20260718-3';
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

    function normalizeCanonicalSiteText(value) {
        const designationPhrases = [
            'national historical park',
            'national historic site',
            'national historic trail',
            'national scenic trail',
            'national military park',
            'national battlefield park',
            'national battlefield',
            'national memorial',
            'national monument',
            'national conservation area',
            'national heritage area',
            'national park and preserve',
            'national park',
            'national preserve',
            'national reserve',
            'national recreation area',
            'national seashore',
            'national lakeshore',
            'national river and recreation area',
            'national river',
            'national wild and scenic river',
            'national forest',
            'national grassland',
            'national wildlife refuge',
            'wildlife refuge',
            'state historic park',
            'state historic site',
            'state historical park',
            'state park and historic site',
            'state park',
            'state recreation area',
            'outstanding natural area',
            'natural area',
            'nature center',
            'regional park',
            'historic site',
            'historical park',
            'visitor center',
            'ranger station',
            'memorial',
            'monument',
            'preserve',
            'reserve',
            'recreation area',
            'seashore',
            'lakeshore',
            'battlefield',
            'military park',
            'forest',
            'grassland',
            'park'
        ];
        const designationAbbreviations = new Set([
            'nhs', 'nhp', 'nht', 'nst', 'nmp', 'nbp', 'nb', 'nmem', 'nm', 'np',
            'npr', 'npres', 'pres', 'pr', 'nr', 'nra', 'ns', 'nl', 'nwr', 'nf',
            'ng', 'nca', 'nha', 'ona', 'nhl', 'sp', 'shs', 'shp', 'sra', 'vc', 'rs'
        ]);
        const stopWords = new Set([
            'the', 'and', 'of', 'jr', 'junior', 'ranger', 'badge', 'badges',
            'patch', 'plastic', 'wooden', 'wood', 'medal', 'token', 'pin',
            'sticker', 'certificate', 'program', 'book', 'booklet', 'activity',
            'guide', 'explorer', 'passport', 'picture', 'pix', 'photo', 'logo',
            'banner', 'page', 'header', 'national', 'park', 'service', 'state',
            'edition', 'ed', 'comes', 'with', 'attached', 'ribbon', 'unit',
            'units', 'site'
        ]);

        let normalized = normalizeLookupText(value).replace(/\b\d{2,}\b/g, ' ');
        designationPhrases.forEach(phrase => {
            normalized = normalized.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
        });
        return normalized
            .split(/\s+/)
            .filter(token => token && !stopWords.has(token) && !designationAbbreviations.has(token) && token.length > 1)
            .join(' ')
            .trim();
    }

    function getStateCanonicalNameKey(state, name) {
        const normalizedState = normalizeLookupText(state);
        const normalizedName = normalizeCanonicalSiteText(name);
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

    function dedupeBadgesByImageUrl(badges) {
        const seen = new Set();
        return (badges || []).filter(badge => {
            const key = badge && badge.imageUrl;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async function loadManifest() {
        if (!manifestPromise) {
            manifestPromise = fetch(BADGE_MANIFEST_URL, { cache: 'force-cache' })
                .then(response => response.ok ? response.json() : { badgesByPinId: {}, badgesByStateName: {}, badgesByStateCanonicalName: {} })
                .catch(error => {
                    console.warn('[badgeImageService] Badge manifest unavailable; using CSV badge pictures only.', error);
                    return { badgesByPinId: {}, badgesByStateName: {}, badgesByStateCanonicalName: {} };
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
        const stateCanonicalNameKey = getStateCanonicalNameKey(place.state, place.name || place.siteName);
        const [manifest, fallbackIndex] = await Promise.all([
            loadManifest(),
            loadFallbackBadgeIndex()
        ]);
        const badgesByPinId = manifest && manifest.badgesByPinId && typeof manifest.badgesByPinId === 'object'
            ? manifest.badgesByPinId
            : {};
        const badgesByStateName = manifest && manifest.badgesByStateName && typeof manifest.badgesByStateName === 'object'
            ? manifest.badgesByStateName
            : {};
        const badgesByStateCanonicalName = manifest && manifest.badgesByStateCanonicalName && typeof manifest.badgesByStateCanonicalName === 'object'
            ? manifest.badgesByStateCanonicalName
            : {};
        const manifestBadges = []
            .concat(Array.isArray(badgesByPinId[normalizedPinId]) ? badgesByPinId[normalizedPinId] : [])
            .concat(Array.isArray(badgesByStateName[stateNameKey]) ? badgesByStateName[stateNameKey] : [])
            .concat(Array.isArray(badgesByStateCanonicalName[stateCanonicalNameKey]) ? badgesByStateCanonicalName[stateCanonicalNameKey] : []);
        const fallbackBadges = fallbackIndex.byPinId[normalizedPinId] || fallbackIndex.byStateName[stateNameKey];
        return dedupeBadgesByImageUrl(
            (Array.isArray(manifestBadges) ? manifestBadges.map(normalizeBadge).filter(Boolean) : [])
                .concat(Array.isArray(fallbackBadges) ? fallbackBadges : [])
        );
    }

    async function getBadgesForPin(pinId) {
        return getBadgesForPlace({ id: pinId });
    }

    window.BARK.services.badgeImages = {
        getDisplayImageUrl,
        getBadgesForPlace,
        getBadgesForPin,
        getStateCanonicalNameKey,
        getStateNameKey,
        loadManifest,
        normalizePinId,
        shouldProxyImageUrl
    };
})();
