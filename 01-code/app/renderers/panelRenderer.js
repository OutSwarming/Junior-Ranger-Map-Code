/**
 * panelRenderer.js - Marker click panel rendering.
 * Phase 2 move-only extraction from dataService.js.
 *
 * Future card architecture notes:
 *   This renderer currently assumes a clicked marker is an official BARK park
 *   with canonical data in marker._parkData. Long term, the slide panel should
 *   become a reusable card host that can render multiple card modes without
 *   competing panels:
 *
 *     1. OfficialParkCard
 *        Canonical BARK data: name, state, category, swag links, official info,
 *        official websites, check-in controls, and "add to trip".
 *
 *     2. TripPlaceCard
 *        User itinerary data for non-official places such as towns, hotels,
 *        restaurants, trailheads, or geocoded stops. This card can show name,
 *        coordinates, directions, remove-from-trip, and later per-trip notes.
 *
 *     3. MyVisitCard / MemoryCard
 *        User-owned content: personal notes, dog/BARK photos, visit dates,
 *        private/public visibility, and future review-style fields. This card
 *        should be lazy-loaded after the panel opens. Do not load photos or
 *        rich editors for every marker during map rendering.
 *
 *   Important separation:
 *     Official data should remain read-only from ParkRepo/CSV.
 *     Personal data should live in a user-owned service/collection and be
 *     composed into the panel at render time. Avoid copying personal notes or
 *     photo refs into marker fingerprints, allPoints, or saved route stops; it
 *     would cause unnecessary marker churn and blur official/user ownership.
 *
 *   Suggested future API:
 *     window.BARK.openPlaceCard({
 *       kind: 'official' | 'tripPlace',
 *       placeId,
 *       customPlaceId,
 *       tripStopId,
 *       focus: 'details' | 'memory' | 'photos' | 'notes'
 *     })
 */
window.BARK = window.BARK || {};

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function getPanelVisitEntry(place) {
    if (typeof window.BARK.getVisitedPlaceEntry === 'function') {
        return window.BARK.getVisitedPlaceEntry(place);
    }

    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function' && typeof vaultRepo.getVisit === 'function') {
        return vaultRepo.hasVisit(place) ? { id: place.id, record: vaultRepo.getVisit(place) } : null;
    }

    return null;
}

function clearElement(element) {
    if (!element) return;
    while (element.firstChild) element.removeChild(element.firstChild);
}

function setTextWithLineBreaks(element, value) {
    if (!element) return;
    clearElement(element);
    String(value || '').split(/\r?\n/).forEach((line, index) => {
        if (index > 0) element.appendChild(document.createElement('br'));
        element.appendChild(document.createTextNode(line));
    });
}

function setCollapsiblePanelText({ section, container, textElement, showMoreButton, text, showMoreLabel, visible = true }) {
    if (section) section.style.display = visible ? 'block' : 'none';
    if (!visible) {
        if (textElement) clearElement(textElement);
        if (container) container.classList.remove('report-collapsed');
        if (showMoreButton) {
            showMoreButton.style.display = 'none';
            showMoreButton.onclick = null;
        }
        return;
    }

    setTextWithLineBreaks(textElement, text);

    const value = String(text || '');
    const hasManyLines = value.split(/\r?\n/).length > 5;
    const shouldCollapse = value.length > 250 || hasManyLines;

    if (container) container.classList.toggle('report-collapsed', shouldCollapse);
    if (!showMoreButton) return;

    showMoreButton.textContent = showMoreLabel;
    showMoreButton.style.display = shouldCollapse ? 'block' : 'none';
    showMoreButton.onclick = shouldCollapse ? () => {
        if (container) container.classList.remove('report-collapsed');
        showMoreButton.style.display = 'none';
    } : null;
}

function getSafeHttpUrls(value) {
    if (!value || typeof value !== 'string') return [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = value.match(urlRegex) || [];

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
        .filter(Boolean);
}

function getUniqueHttpUrls(value) {
    const seen = new Set();
    return getSafeHttpUrls(value).filter(url => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
    });
}

function getLabeledHttpLinks(value, fallbackPrefix) {
    const source = String(value || '');
    const urls = getUniqueHttpUrls(source);
    return urls.map((url, index) => {
        const urlIndex = source.indexOf(url);
        const prefix = urlIndex > -1
            ? source.slice(0, urlIndex).split(/\r?\n/).pop().replace(/[:\-\s]+$/, '').trim()
            : '';
        return {
            url,
            label: prefix || `${fallbackPrefix} ${index + 1}`
        };
    });
}

function configureExternalLink(link, href) {
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
}

function createExternalLink(href, className, text) {
    const link = document.createElement('a');
    configureExternalLink(link, href);
    link.className = className;
    link.textContent = text;
    return link;
}

function createMetaPill(icon, value, fallback, href = '') {
    const pill = href ? document.createElement('a') : document.createElement('div');
    pill.className = 'meta-pill';
    pill.textContent = icon ? `${icon} ${value || fallback}` : `${value || fallback}`;
    if (href) {
        configureExternalLink(pill, href);
        pill.dataset.metaLink = 'book';
        pill.setAttribute('aria-label', `Open ${value || fallback}`);
    }
    return pill;
}

function cleanMetaLabel(value) {
    return String(value || '')
        .replace(/\.(pdf|docx?)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getMetaSearchTokens(value) {
    const stopWords = new Set([
        'a', 'an', 'and', 'book', 'badge', 'explorer', 'jr', 'junior', 'program', 'ranger', 'tag', 'the'
    ]);
    return cleanMetaLabel(value)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .map(token => token.replace(/s$/, ''))
        .filter(token => token && !stopWords.has(token));
}

function addUniqueLabel(labels, seen, label, url = '') {
    const cleaned = cleanMetaLabel(label);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    labels.push({ label: cleaned, url });
}

function getComparableMetaLabel(value) {
    return cleanMetaLabel(value)
        .toLowerCase()
        .replace(/\s+tag$/i, '')
        .replace(/\s+book$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function findMatchingBookUrl(label, bookLinks) {
    const comparableLabel = getComparableMetaLabel(label);
    const directMatch = bookLinks.find(link => {
        const comparableBookLabel = getComparableMetaLabel(link && link.label);
        return comparableLabel && comparableBookLabel === comparableLabel;
    });
    if (directMatch) return directMatch.url;

    const labelTokens = getMetaSearchTokens(label);
    if (!labelTokens.length) return '';

    const exactMatch = bookLinks.find(link => {
        const bookTokens = getMetaSearchTokens(link && link.label);
        return labelTokens.every(token => bookTokens.includes(token));
    });
    if (exactMatch) return exactMatch.url;

    const partialMatch = bookLinks.find(link => {
        const bookTokens = getMetaSearchTokens(link && link.label);
        return labelTokens.some(token => bookTokens.includes(token));
    });
    return partialMatch ? partialMatch.url : '';
}

function getSpecialProgramLabels(value, bookLinks) {
    const labels = [];
    const seen = new Set();
    String(value || '')
        .split(/[|\n;]+/)
        .map(part => part.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim())
        .filter(Boolean)
        .forEach(part => addUniqueLabel(labels, seen, `${part} Tag`, findMatchingBookUrl(part, bookLinks)));
    return labels;
}

function metaLabelsOverlap(firstLabel, secondLabel) {
    const firstComparable = getComparableMetaLabel(firstLabel);
    const secondComparable = getComparableMetaLabel(secondLabel);
    if (firstComparable && secondComparable && firstComparable === secondComparable) return true;

    const firstTokens = getMetaSearchTokens(firstLabel);
    const secondTokens = getMetaSearchTokens(secondLabel);
    if (!firstTokens.length || !secondTokens.length) return false;
    return firstTokens.every(token => secondTokens.includes(token))
        || secondTokens.every(token => firstTokens.includes(token));
}

function getBookCatalogLabels(bookLinks, coveredLabels = []) {
    const labels = [];
    const seen = new Set();
    const genericLabels = new Set(['book', 'download book', 'online books', 'official website', 'website']);

    bookLinks.forEach(link => {
        const label = cleanMetaLabel(link && link.label);
        const key = label.toLowerCase();
        if (!label || genericLabels.has(key)) return;
        if (coveredLabels.some(coveredLabel => metaLabelsOverlap(label, coveredLabel))) return;
        addUniqueLabel(labels, seen, `${label} Book`, link.url);
    });

    return labels;
}

function getAgencyLabel(agency) {
    const value = String(agency || '').trim();
    if (!value) return 'Agency not listed';
    const normalized = value.toLowerCase();
    if (normalized === 'nps') return 'National Park Service';
    if (normalized.includes('blm')) return 'Bureau of Land Management';
    if (normalized.includes('usfs') || normalized.includes('forest service')) return 'National Forest';
    return value;
}

function stripOuterLocationParens(value) {
    const text = String(value || '').trim();
    return text.length > 2 && text.startsWith('(') && text.endsWith(')')
        ? text.slice(1, -1).trim()
        : text;
}

function getDisplayPlaceName(placeOrName) {
    const rawName = placeOrName && typeof placeOrName === 'object'
        ? placeOrName.name
        : placeOrName;
    const cleaned = String(rawName || 'Unknown Park').replace(/^\s*\(?\d+\s+of\s+\d+\)?\s*/i, '').trim();
    const displayName = placeOrName && typeof placeOrName === 'object' && placeOrName._isPickupLocation
        ? stripOuterLocationParens(cleaned)
        : cleaned;
    return displayName || 'Unknown Park';
}

function getBookLinks(place = {}) {
    const source = String(place.jrBooks || '');
    const urls = getSafeHttpUrls(source);
    return urls.map((url, index) => {
        const urlIndex = source.indexOf(url);
        const prefix = urlIndex > -1 ? source.slice(0, urlIndex).split(/\r?\n/).pop().replace(/[:\-\s]+$/, '').trim() : '';
        return {
            url,
            label: prefix || (urls.length > 1 ? `Junior Ranger Book ${index + 1}` : 'Download Book')
        };
    });
}

function getRenderableBookLinks(place = {}) {
    return place && place._isPickupLocation ? [] : getBookLinks(place);
}

function getBadgeDisplayImageUrl(imageUrl) {
    const badgeService = window.BARK.services && window.BARK.services.badgeImages;
    return badgeService && typeof badgeService.getDisplayImageUrl === 'function'
        ? badgeService.getDisplayImageUrl(imageUrl)
        : imageUrl;
}

function handleBadgeImageViewerKeydown(event) {
    if (event.key === 'Escape') closeBadgeImageViewer();
}

function closeBadgeImageViewer() {
    const viewer = document.getElementById('badge-image-viewer');
    if (!viewer) return;

    viewer.classList.remove('active');
    viewer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('badge-image-viewer-open');
    document.removeEventListener('keydown', handleBadgeImageViewerKeydown);

    const image = viewer.querySelector('.badge-image-viewer-image');
    if (image) {
        image.removeAttribute('src');
        image.alt = '';
    }
}

function ensureBadgeImageViewer() {
    let viewer = document.getElementById('badge-image-viewer');
    if (viewer) return viewer;

    viewer = document.createElement('div');
    viewer.id = 'badge-image-viewer';
    viewer.className = 'badge-image-viewer';
    viewer.setAttribute('aria-hidden', 'true');
    viewer.setAttribute('aria-label', 'Badge image preview');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('role', 'dialog');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'badge-image-viewer-close';
    closeButton.setAttribute('aria-label', 'Close badge image');
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', closeBadgeImageViewer);

    const stage = document.createElement('div');
    stage.className = 'badge-image-viewer-stage';

    const image = document.createElement('img');
    image.className = 'badge-image-viewer-image';
    image.alt = '';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';

    stage.appendChild(image);
    viewer.appendChild(closeButton);
    viewer.appendChild(stage);
    viewer.addEventListener('click', event => {
        if (event.target === viewer || event.target === stage) closeBadgeImageViewer();
    });

    document.body.appendChild(viewer);
    return viewer;
}

function openBadgeImageViewer(badge, index) {
    const sourceUrl = badge && (badge.imageUrl || badge.thumbnailUrl);
    if (!sourceUrl) return false;

    const viewer = ensureBadgeImageViewer();
    const image = viewer.querySelector('.badge-image-viewer-image');
    const closeButton = viewer.querySelector('.badge-image-viewer-close');
    const title = badge.title || `Badge ${index + 1}`;

    if (image) {
        image.src = getBadgeDisplayImageUrl(sourceUrl);
        image.alt = title;
    }

    viewer.classList.add('active');
    viewer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('badge-image-viewer-open');
    document.removeEventListener('keydown', handleBadgeImageViewerKeydown);
    document.addEventListener('keydown', handleBadgeImageViewerKeydown);

    if (closeButton && typeof closeButton.focus === 'function') {
        closeButton.focus({ preventScroll: true });
    }

    return true;
}

function createBadgeImageCard(badge, index) {
    const card = document.createElement('a');
    card.className = 'badge-image-card';
    card.href = getBadgeDisplayImageUrl(badge.imageUrl || badge.thumbnailUrl) || '#';
    card.setAttribute('aria-label', `Open ${badge.title || `Badge ${index + 1}`} image`);
    card.title = badge.title || `Badge ${index + 1}`;
    card.rel = 'noopener noreferrer';
    card.addEventListener('click', event => {
        if (openBadgeImageViewer(badge, index)) event.preventDefault();
    });

    const imageFrame = document.createElement('div');
    imageFrame.className = 'badge-image-frame';

    const image = document.createElement('img');
    const rawImageUrl = badge.thumbnailUrl || badge.imageUrl;
    image.src = getBadgeDisplayImageUrl(rawImageUrl);
    image.alt = badge.title || `Badge ${index + 1}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
        card.classList.add('badge-image-card-error');
        imageFrame.textContent = 'Image unavailable';
    }, { once: true });

    imageFrame.appendChild(image);
    card.appendChild(imageFrame);

    return card;
}

function getCsvBadgePictureBadges(place = {}) {
    return getLabeledHttpLinks(place.pics || '', 'Badge Picture').map((link, index) => ({
        id: `csv-picture-${index + 1}`,
        title: link.label || `Badge Picture ${index + 1}`,
        type: 'Badge Picture',
        imageUrl: link.url,
        thumbnailUrl: link.url,
        source: 'site-row'
    }));
}

function mergeBadgeImages(manifestBadges, csvBadges) {
    const seen = new Set();
    return manifestBadges.concat(csvBadges).filter(badge => {
        const key = badge && badge.imageUrl;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function renderBadgeGalleryImages(container, badges, place) {
    clearElement(container);
    container.className = 'badge-gallery badge-gallery-strip-wrap';
    container.dataset.pinId = place.id || '';
    container.style.display = badges.length ? 'block' : 'none';
    if (!badges.length) return;

    const strip = document.createElement('div');
    strip.className = 'badge-gallery-strip';
    badges.forEach((badge, index) => strip.appendChild(createBadgeImageCard(badge, index)));
    container.appendChild(strip);
}

function renderBadgeGallery(container, place = {}) {
    if (!container) return;
    const pinId = place.id || '';
    const csvBadges = getCsvBadgePictureBadges(place);
    container.dataset.pinId = pinId;

    if (csvBadges.length) {
        renderBadgeGalleryImages(container, csvBadges, place);
    } else {
        container.style.display = 'none';
        clearElement(container);
    }

    const badgeService = window.BARK.services && window.BARK.services.badgeImages;
    if (!badgeService || !pinId) return;

    const loadBadges = typeof badgeService.getBadgesForPlace === 'function'
        ? badgeService.getBadgesForPlace(place)
        : badgeService.getBadgesForPin(pinId);

    loadBadges.then(manifestBadges => {
        if (container.dataset.pinId !== pinId) return;
        const badges = mergeBadgeImages(manifestBadges, csvBadges);
        renderBadgeGalleryImages(container, badges, place);
    }).catch(error => {
        console.warn('[panelRenderer] Unable to load badge images for selected pin.', {
            pinId,
            name: place.name,
            error
        });
    });

    return csvBadges.length > 0;
}

function createPanelButton({ text, className = '', href = '', onClick = null, actionKey = '' }) {
    const element = href ? document.createElement('a') : document.createElement('button');
    element.className = `panel-action-btn ${className}`.trim();
    element.textContent = text;
    if (actionKey) element.dataset.panelAction = actionKey;
    if (href) configureExternalLink(element, href);
    if (!href) element.type = 'button';
    if (onClick) element.addEventListener('click', onClick);
    return element;
}

function scrollPanelTo(element) {
    if (!element) return;
    if (typeof window.BARK.setSlidePanelMode === 'function') {
        window.BARK.setSlidePanelMode('high', { resetScroll: false });
        setTimeout(() => element.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
        return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncTripButton(button, place) {
    if (!button) return;
    const tripDays = Array.isArray(window.BARK.tripDays) ? window.BARK.tripDays : [];
    const inTripDay = tripDays.findIndex(day => day && Array.isArray(day.stops) && day.stops.some(stop => stop.id === place.id));

    if (inTripDay > -1) {
        button.textContent = `In Trip Day ${inTripDay + 1}`;
        button.classList.add('is-added');
    } else {
        button.textContent = 'Add To Trip';
        button.classList.remove('is-added');
    }
}

function syncTripActionButtons(place) {
    document.querySelectorAll('[data-panel-action="add-trip"]').forEach(button => {
        syncTripButton(button, place);
    });
}

function syncVisitedActionButtons(place) {
    const isVisited = Boolean(getPanelVisitEntry(place));
    document.querySelectorAll('[data-panel-action="mark-visited"]').forEach(button => {
        button.textContent = isVisited ? 'Visited' : 'Mark as Visited';
        button.classList.toggle('is-added', isVisited);
    });
}

function getPickupLocations(place) {
    return Array.isArray(place && place.pickupLocations)
        ? place.pickupLocations.filter(location => location && location.id)
        : [];
}

function renderPanelActionSet(container, actions) {
    if (!container) return;
    clearElement(container);
    actions.forEach(action => {
        container.appendChild(createPanelButton(action));
    });
    container.scrollLeft = 0;
}

function buildPrimaryActions(place, bookLinks) {
    const container = document.getElementById('panel-primary-actions');
    const stickyFooter = document.getElementById('panel-sticky-footer');
    if (!container && !stickyFooter) return;

    const addTripToPanel = () => {
        if (typeof window.addStopToTrip === 'function' && window.addStopToTrip({
            id: place.id,
            name: place.name,
            lat: place.lat,
            lng: place.lng,
            state: place.state || ''
        })) {
            syncTripActionButtons(place);
        }
    };
    const clickPanelButton = (buttonId) => {
        const button = document.getElementById(buttonId);
        if (button && typeof button.click === 'function') button.click();
    };
    const pickupLocations = getPickupLocations(place);
    const isPickupGroupExpanded = typeof window.BARK.isPickupGroupExpanded === 'function'
        ? window.BARK.isPickupGroupExpanded(place.id)
        : false;
    const actions = [{
        text: 'Directions',
        className: 'primary',
        href: buildMapSearchUrl(place.name, place.lat, place.lng, 'google'),
        actionKey: 'directions'
    }];

    if (pickupLocations.length > 0) {
        actions.push({
            text: isPickupGroupExpanded ? 'Hide Pickup Pins' : `Show All (${pickupLocations.length})`,
            className: 'pickup-locations',
            onClick: () => {
                const nextExpanded = !(typeof window.BARK.isPickupGroupExpanded === 'function'
                    && window.BARK.isPickupGroupExpanded(place.id));
                const toggle = nextExpanded ? window.BARK.showPickupGroup : window.BARK.hidePickupGroup;
                if (typeof toggle === 'function') toggle(place.id);
                buildPrimaryActions(place, bookLinks);
            },
            actionKey: 'pickup-locations'
        });
    }

    actions.push({
        text: 'Park Info',
        onClick: () => scrollPanelTo(document.getElementById('panel-info-section')),
        actionKey: 'park-info'
    }, {
        text: 'Add To Trip',
        onClick: addTripToPanel,
        actionKey: 'add-trip'
    }, {
        text: 'Mark as Visited',
        onClick: () => clickPanelButton('mark-visited-btn'),
        actionKey: 'mark-visited'
    }, {
        text: 'Verified Check In',
        onClick: () => clickPanelButton('verify-checkin-btn'),
        actionKey: 'verify-checkin'
    });

    renderPanelActionSet(container, actions);
    renderPanelActionSet(stickyFooter, actions);
    syncTripActionButtons(place);
    syncVisitedActionButtons(place);
}

function renderBookSection(place, bookLinks, websiteUrls) {
    const section = document.getElementById('panel-book-section');
    const count = document.getElementById('panel-book-count');
    const linksContainer = document.getElementById('panel-book-links');
    if (!section || !linksContainer) return;

    if (place && place._isPickupLocation) {
        section.style.display = 'none';
        clearElement(linksContainer);
        if (count) count.textContent = '';
        return;
    }

    section.style.display = 'block';
    clearElement(linksContainer);
    if (count) count.textContent = bookLinks.length ? `${bookLinks.length} Link${bookLinks.length === 1 ? '' : 's'}` : 'Needed';

    if (bookLinks.length > 0) {
        bookLinks.forEach(link => {
            linksContainer.appendChild(createExternalLink(link.url, 'panel-link-btn panel-link-btn-primary', link.label));
        });
    } else {
        const empty = document.createElement('p');
        empty.className = 'panel-card-copy panel-empty-copy';
        empty.textContent = place.jrBooks ? place.jrBooks : 'No downloadable Junior Ranger book is listed for this spot yet.';
        linksContainer.appendChild(empty);
    }

    websiteUrls.slice(0, 2).forEach((url, index) => {
        linksContainer.appendChild(createExternalLink(
            url,
            'panel-link-btn',
            index === 0 ? 'Official Website' : `Official Link ${index + 1}`
        ));
    });
}

function openFreeAccountPrompt(source) {
    const accountUi = window.BARK && window.BARK.authAccountUi;
    if (accountUi && typeof accountUi.openAccountPrompt === 'function') {
        accountUi.openAccountPrompt({ source });
        return;
    }

    const profileTab = document.querySelector('.nav-item[data-target="profile-view"]');
    if (profileTab) profileTab.click();
}

function openFreeVisitLimitPaywall(result = {}) {
    const paywall = window.BARK && window.BARK.paywall;
    if (paywall && typeof paywall.openPaywall === 'function') {
        paywall.openPaywall({ source: 'visited-place-limit' });
        return true;
    }

    const limit = result.limit || 5;
    alert(`Free plan limit reached. Free users can mark up to ${limit} parks visited. Adding more than ${limit} parks is a Premium feature.`);
    return false;
}

function setAccountLockedCheckinButton(button, textEl, label, source) {
    if (!button) return;
    button.disabled = false;
    button.classList.remove('visited');
    button.classList.add('account-locked');
    button.setAttribute('aria-disabled', 'true');
    button.title = 'Create a free account to save this to your Junior Ranger profile.';
    button.style.cursor = 'pointer';
    button.style.opacity = '';
    if (textEl) textEl.textContent = label;
    button.onmouseenter = null;
    button.onmouseleave = null;
    button.onclick = (event) => {
        event.preventDefault();
        openFreeAccountPrompt(source);
    };
}

function clearAccountLockedCheckinButton(button) {
    if (!button) return;
    button.classList.remove('account-locked');
    button.removeAttribute('aria-disabled');
    button.removeAttribute('title');
}

function buildMapSearchUrl(name, lat, lng, provider) {
    const numericLat = Number(lat);
    const numericLng = Number(lng);
    const hasCoords = Number.isFinite(numericLat) && Number.isFinite(numericLng);
    const label = String(name || 'Selected location');

    if (provider === 'apple') {
        const params = new URLSearchParams();
        params.set('q', label);
        if (hasCoords) params.set('ll', `${numericLat},${numericLng}`);
        return `http://maps.apple.com/?${params.toString()}`;
    }

    const query = hasCoords ? `${numericLat},${numericLng}` : label;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

window.BARK.panelRendererSafety = {
    getBookCatalogLabels,
    getBookLinks,
    getRenderableBookLinks,
    getSafeHttpUrls,
    getSpecialProgramLabels,
    openBadgeImageViewer,
    openFreeVisitLimitPaywall,
    closeBadgeImageViewer,
    setTextWithLineBreaks
};

function renderMarkerClickPanel(context) {
    const marker = context.marker;
    const slidePanel = context.slidePanel;
    const titleEl = context.titleEl;
    const infoSection = context.infoSection;
    const infoEl = context.infoEl;
    const websitesContainer = context.websitesContainer;
    const picsEl = context.picsEl;
    const videoEl = context.videoEl;
    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    const refreshOnly = context.refreshOnly === true;

    if (!refreshOnly && window.BARK.activePinMarker && window.BARK.activePinMarker._icon) {
        const previousMarker = window.BARK.activePinMarker;
        window.BARK.activePinMarker = null;
        previousMarker._icon.classList.remove('active-pin');
        if (window.BARK.markerManager && typeof window.BARK.markerManager.applyMarkerStyle === 'function') {
            window.BARK.markerManager.applyMarkerStyle(previousMarker);
        }
    }
    window.BARK.activePinMarker = marker;
    if (marker._icon) {
        marker._icon.classList.add('active-pin');
        if (window.BARK.markerManager && typeof window.BARK.markerManager.applyMarkerStyle === 'function') {
            window.BARK.markerManager.applyMarkerStyle(marker);
        }
    }

    const panelScrollContainer = document.querySelector('.panel-content');
    if (panelScrollContainer && !refreshOnly) panelScrollContainer.scrollTop = 0;
    if (!refreshOnly) {
        document.querySelectorAll('#panel-primary-actions, #panel-sticky-footer, #panel-meta-container').forEach(actionRail => {
            actionRail.scrollLeft = 0;
        });
    }

    if (!refreshOnly) document.getElementById('filter-panel').classList.add('collapsed');

    const d = marker._parkData;
    const displayName = getDisplayPlaceName(d);
    const bookLinks = getRenderableBookLinks(d);
    const websiteUrls = getSafeHttpUrls(d.website || '');

    if (titleEl) titleEl.textContent = displayName;
    const subtitleEl = document.getElementById('panel-subtitle');
    if (subtitleEl) {
        if (d._isPickupLocation && d._pickupParentName) {
            const subtitleParts = [`Pickup location for ${getDisplayPlaceName(d._pickupParentName)}`, d.state].filter(Boolean);
            subtitleEl.textContent = subtitleParts.join(' • ');
        } else {
            const subtitleParts = [getAgencyLabel(d.agency), d.state].filter(Boolean);
            subtitleEl.textContent = subtitleParts.length ? `${subtitleParts.join(' • ')} • Junior Ranger` : 'Junior Ranger program';
        }
    }

    const metaContainer = document.getElementById('panel-meta-container');
    if (metaContainer) {
        clearElement(metaContainer);
        if (d._isPickupLocation) {
            metaContainer.scrollLeft = 0;
        } else {
            if (d.swagType && d.swagType !== 'Special Programs') {
                metaContainer.appendChild(createMetaPill('', d.swagType, 'Junior Ranger'));
            }
            const specialProgramLabels = getSpecialProgramLabels(d.specialPrograms, bookLinks);
            specialProgramLabels.forEach(({ label, url }) => {
                metaContainer.appendChild(createMetaPill('', label, label, url));
            });
            getBookCatalogLabels(bookLinks, specialProgramLabels.map(item => item.label)).forEach(({ label, url }) => {
                metaContainer.appendChild(createMetaPill('', label, label, url));
            });
            if (!d.specialPrograms) {
                metaContainer.appendChild(createMetaPill('', 'Site-Specific Book', 'Site-Specific Book', bookLinks[0] && bookLinks[0].url));
                metaContainer.appendChild(createMetaPill('', d.state, 'Location'));
            }
            metaContainer.scrollLeft = 0;
        }
    }

    buildPrimaryActions(d, bookLinks);
    renderBookSection(d, bookLinks, websiteUrls);

    const suggestEditBtn = document.getElementById('suggest-edit-btn');
    if (suggestEditBtn) {
        const subject = encodeURIComponent(`Junior Ranger Map Edit: ${d.name}`);
        const body = encodeURIComponent(`Park Name: ${d.name}\nID: ${d.id}\n\n--- Please describe the update below ---\n`);
        suggestEditBtn.href = `mailto:usbarkrangers@gmail.com?subject=${subject}&body=${body}`;
    }

    // --- UPDATES & REPORTS ---
    setCollapsiblePanelText({
        section: infoSection,
        container: document.getElementById('panel-info-container'),
        textElement: infoEl,
        showMoreButton: document.getElementById('show-more-info'),
        text: d.info,
        showMoreLabel: 'Show Full Info ▾',
        visible: Boolean(d.info)
    });

    const historySection = document.getElementById('panel-history-section');
    const historyEl = document.getElementById('panel-history');
    setCollapsiblePanelText({
        section: historySection,
        container: document.getElementById('panel-history-container'),
        textElement: historyEl,
        showMoreButton: document.getElementById('show-more-history'),
        text: d.historyTimelineInfo || 'Junior Ranger history notes have not been added for this location yet.',
        showMoreLabel: 'Show Full History ▾',
        visible: Boolean(historySection && historyEl)
    });

    const videoUrl = getSafeHttpUrls(d.video || '')[0];
    const mediaLinks = document.getElementById('media-links');
    renderBadgeGallery(picsEl, d);
    if (videoUrl) {
        if (mediaLinks) mediaLinks.style.display = 'flex';
    } else {
        if (mediaLinks) mediaLinks.style.display = 'none';
    }
    if (videoUrl) {
        if (videoEl) {
            videoEl.style.display = 'block';
            configureExternalLink(videoEl, videoUrl);
        }
    } else {
        if (videoEl) { videoEl.style.display = 'none'; videoEl.removeAttribute('href'); }
    }

    if (websitesContainer) {
        clearElement(websitesContainer);
        websitesContainer.style.display = 'none';
    }

    // --- VISITED SECTION ---
    const visitedSection = document.getElementById('panel-visited-section');
    const markVisitedBtn = document.getElementById('mark-visited-btn');
    const markVisitedText = document.getElementById('mark-visited-text');
    const verifyBtn = document.getElementById('verify-checkin-btn');
    const verifyBtnText = document.getElementById('verify-checkin-text');
    const checkinService = window.BARK.services && window.BARK.services.checkin;

    if (visitedSection && markVisitedBtn && markVisitedText && verifyBtn) {
        if (firebaseService && firebaseService.getCurrentUser()) {
            visitedSection.style.display = 'grid';
            clearAccountLockedCheckinButton(markVisitedBtn);
            clearAccountLockedCheckinButton(verifyBtn);

            const visitedEntry = getPanelVisitEntry(d);

            if (visitedEntry) {
                const cachedObj = visitedEntry.record;

                markVisitedBtn.classList.add('visited');
                markVisitedText.textContent = '✓ Visited';

                if (cachedObj.verified) {
                    markVisitedBtn.disabled = true;
                    markVisitedBtn.style.cursor = 'default';
                    markVisitedBtn.style.opacity = '0.7';
                } else {
                    markVisitedBtn.disabled = false;
                    markVisitedBtn.style.cursor = 'pointer';
                    markVisitedBtn.style.opacity = '1';
                }

                if (window.allowUncheck && !cachedObj.verified) {
                    markVisitedBtn.style.background = '#4CAF50';
                    markVisitedBtn.onmouseenter = () => markVisitedText.textContent = '✖ Remove Check-in';
                    markVisitedBtn.onmouseleave = () => markVisitedText.textContent = '✓ Visited';
                } else {
                    markVisitedBtn.onmouseenter = null;
                    markVisitedBtn.onmouseleave = null;
                }

                if (cachedObj.verified) {
                    verifyBtn.style.background = '#4CAF50';
                    verifyBtnText.textContent = 'Verified & Secured';
                    verifyBtn.disabled = true;
                    verifyBtn.style.cursor = 'default';
                    verifyBtn.style.opacity = '0.7';
                } else {
                    verifyBtn.style.background = '#FF9800';
                    verifyBtnText.textContent = 'Verified Check-In';
                    verifyBtn.disabled = false;
                    verifyBtn.style.cursor = 'pointer';
                    verifyBtn.style.opacity = '1';
                }
            } else {
                markVisitedBtn.classList.remove('visited');
                markVisitedText.textContent = 'Mark as Visited';
                markVisitedBtn.disabled = false;
                markVisitedBtn.style.cursor = 'pointer';
                markVisitedBtn.style.opacity = '1';
                markVisitedBtn.onmouseenter = null;
                markVisitedBtn.onmouseleave = null;

                verifyBtn.style.background = '#FF9800';
                verifyBtnText.textContent = 'Verified Check-In';
                verifyBtn.disabled = false;
                verifyBtn.style.cursor = 'pointer';
                verifyBtn.style.opacity = '1';
            }

            verifyBtn.onclick = async () => {
                if (!checkinService || typeof checkinService.verifyGpsCheckin !== 'function') {
                    alert("Check-in service is unavailable. Try again later.");
                    return;
                }
                verifyBtnText.textContent = 'Locating...';

                try {
                    const checkinResult = await checkinService.verifyGpsCheckin(d);
                    if (checkinResult.success) {
                        alert(`Check-in Verified! You earned 2 points.`);

                        verifyBtn.style.background = '#4CAF50';
                        verifyBtnText.textContent = 'Verified & Secured';
                        verifyBtn.disabled = true;
                        verifyBtn.style.cursor = 'default';
                        verifyBtn.style.opacity = '0.7';

                        markVisitedBtn.classList.add('visited');
                        markVisitedText.textContent = '✓ Visited';
                        markVisitedBtn.disabled = true;
                        markVisitedBtn.style.cursor = 'default';
                        markVisitedBtn.style.opacity = '0.7';

                        window.syncState();
                        window.BARK.updateStatsUI();
                        syncVisitedActionButtons(d);
                    } else {
                        const radiusKm = window.BARK.config && window.BARK.config.CHECKIN_RADIUS_KM;
                        if (checkinResult.error === 'OUT_OF_RANGE' && Number.isFinite(checkinResult.distance)) {
                            alert(`Out of Range! You are ${checkinResult.distance.toFixed(1)} km away. You must be within ${radiusKm} km to verify.`);
                        } else if (checkinResult.error === 'GEOLOCATION_UNSUPPORTED') {
                            alert("Geolocation is not supported by your browser.");
                        } else if (checkinResult.error === 'PERMISSION_DENIED') {
                            alert("Location permission denied. GPS is required for verified check-ins.");
                        } else if (checkinResult.error === 'LOCATION_FAILED') {
                            alert("Failed to get location. Try again later.");
                        } else if (checkinResult.error === 'FREE_VISIT_LIMIT') {
                            openFreeVisitLimitPaywall(checkinResult);
                        } else {
                            alert("Check-in could not be verified. Try again later.");
                        }
                        verifyBtnText.textContent = 'Verified Check-In';
                    }
                } catch (error) {
                    console.error("[panelRenderer] verify check-in failed:", error);
                    alert("Failed to get location. Try again later.");
                    verifyBtnText.textContent = 'Verified Check-In';
                }
            };

            markVisitedBtn.onclick = async () => {
                if (!checkinService || typeof checkinService.markAsVisited !== 'function') {
                    alert("Check-in service is unavailable. Try again later.");
                    return;
                }

                try {
                    const visitResult = await checkinService.markAsVisited(d);
                    if (!visitResult.success) {
                        if (visitResult.error === 'UNCHECK_LOCKED') {
                            alert("🛡️ Data Safety Lock Active\n\nTo prevent you from accidentally losing your 'Date Visited' history, unchecking parks is disabled by default.\n\nYou can turn off this safety feature by opening Settings (⚙️) and enabling 'Allow Uncheck Visited'.");
                        } else if (visitResult.error === 'FREE_VISIT_LIMIT') {
                            openFreeVisitLimitPaywall(visitResult);
                        } else if (visitResult.error !== 'ALREADY_VERIFIED') {
                            alert("Check-in service is unavailable. Try again later.");
                        }
                        return;
                    }

                    if (visitResult.action === 'removed') {
                        markVisitedBtn.classList.remove('visited');
                        markVisitedText.textContent = 'Mark as Visited';
                        markVisitedBtn.onmouseenter = null;
                        markVisitedBtn.onmouseleave = null;

                        window.syncState();
                        syncVisitedActionButtons(d);
                        return;
                    }

                    markVisitedBtn.classList.add('visited');
                    markVisitedText.textContent = '✓ Visited';
                    markVisitedBtn.disabled = false;
                    markVisitedBtn.style.cursor = 'pointer';
                    markVisitedBtn.style.opacity = '1';

                    window.syncState();
                    syncVisitedActionButtons(d);
                } catch (error) {
                    console.error("[panelRenderer] mark visited failed:", error);
                    alert("Check-in service is unavailable. Try again later.");
                }
            };
        } else {
            visitedSection.style.display = 'grid';
            verifyBtn.style.background = '#94a3b8';
            setAccountLockedCheckinButton(markVisitedBtn, markVisitedText, 'Mark as Visited', 'mark-visited');
            setAccountLockedCheckinButton(verifyBtn, verifyBtnText, 'Verified Check-In', 'verified-checkin');
        }
    }

    // --- SMART AUTO-PAN ---
    if (!refreshOnly && !window.stopAutoMovements) {
        const currentZoom = map.getZoom();
        const xOffset = window.innerWidth >= 768 ? -250 : 0;
        const yOffset = window.innerWidth < 768 ? 180 : 0;
        const targetPoint = map.project([d.lat, d.lng], currentZoom).add([xOffset, yOffset]);
        const targetLatLng = map.unproject(targetPoint, currentZoom);

        map.panTo(targetLatLng, {
            animate: !window.instantNav,
            duration: window.instantNav ? 0 : 0.5
        });
    }

    const mapIsActive = typeof window.BARK.isMapVisibleByDefaultViewState === 'function'
        ? window.BARK.isMapVisibleByDefaultViewState()
        : !document.querySelector('.ui-view.active');

    if (slidePanel) {
        if (mapIsActive) {
            if (!refreshOnly && typeof window.BARK.resetSlidePanelSheet === 'function') {
                window.BARK.resetSlidePanelSheet({ snapToDefault: true });
            }
            slidePanel.classList.add('open');
        } else {
            slidePanel.classList.remove('open');
        }
    }
}

window.BARK.renderMarkerClickPanel = renderMarkerClickPanel;
window.BARK.openBadgeImageViewer = openBadgeImageViewer;
window.BARK.closeBadgeImageViewer = closeBadgeImageViewer;
