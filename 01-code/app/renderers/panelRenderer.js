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

function createMetaPill(icon, value, fallback) {
    const pill = document.createElement('div');
    pill.className = 'meta-pill';
    pill.textContent = icon ? `${icon} ${value || fallback}` : `${value || fallback}`;
    return pill;
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

function getPickupPosition(place = {}) {
    const source = `${place.name || ''} ${place.info || ''}`;
    const match = source.match(/\(?\s*(\d+)\s+of\s+(\d+)\s*\)?/i);
    if (!match) return null;

    const index = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isFinite(index) || !Number.isFinite(total) || total < 2) return null;
    return { index, total };
}

function getDisplayPlaceName(name) {
    return String(name || 'Unknown Park').replace(/^\s*\(?\d+\s+of\s+\d+\)?\s*/i, '').trim() || 'Unknown Park';
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

function createPanelButton({ text, className = '', href = '', onClick = null }) {
    const element = href ? document.createElement('a') : document.createElement('button');
    element.className = `panel-action-btn ${className}`.trim();
    element.textContent = text;
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

function buildPrimaryActions(place, bookLinks) {
    const container = document.getElementById('panel-primary-actions');
    if (!container) return;

    clearElement(container);
    container.appendChild(createPanelButton({
        text: 'Directions',
        className: 'primary',
        href: buildMapSearchUrl(place.name, place.lat, place.lng, 'google')
    }));

    const tripButton = createPanelButton({ text: 'Add To Trip' });
    syncTripButton(tripButton, place);
    tripButton.addEventListener('click', () => {
        if (typeof window.addStopToTrip === 'function' && window.addStopToTrip({
            id: place.id,
            name: place.name,
            lat: place.lat,
            lng: place.lng,
            state: place.state || ''
        })) {
            syncTripButton(tripButton, place);
        }
    });
    container.appendChild(tripButton);

    if (bookLinks.length > 0) {
        container.appendChild(createPanelButton({
            text: 'Book',
            href: bookLinks[0].url
        }));
    } else {
        container.appendChild(createPanelButton({
            text: 'Book',
            onClick: () => scrollPanelTo(document.getElementById('panel-book-section'))
        }));
    }

    container.appendChild(createPanelButton({
        text: 'Park Info',
        onClick: () => scrollPanelTo(document.getElementById('panel-info-section'))
    }));
}

function renderJuniorRangerSummary(place, pickupPosition) {
    const section = document.getElementById('panel-jr-summary');
    if (!section) return;

    clearElement(section);
    const title = document.createElement('div');
    title.className = 'panel-card-heading';
    title.innerHTML = '<span class="panel-card-title">Junior Ranger</span><span class="panel-card-chip">Program</span>';
    section.appendChild(title);

    const lines = [];
    lines.push(place.specialPrograms ? `Special program: ${place.specialPrograms}` : 'Site-specific Junior Ranger badge or booklet.');
    if (place.jrBooks) lines.push('Book information is listed below.');
    if (pickupPosition) lines.push(`This appears to be pickup location ${pickupPosition.index} of ${pickupPosition.total}.`);

    const copy = document.createElement('p');
    copy.className = 'panel-card-copy';
    copy.textContent = lines.join(' ');
    section.appendChild(copy);
}

function renderBookSection(place, bookLinks, websiteUrls) {
    const section = document.getElementById('panel-book-section');
    const count = document.getElementById('panel-book-count');
    const linksContainer = document.getElementById('panel-book-links');
    if (!section || !linksContainer) return;

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

function renderPickupSection(place, pickupPosition) {
    const section = document.getElementById('panel-pickup-section');
    const chip = document.getElementById('panel-pickup-chip');
    const copy = document.getElementById('panel-pickup-copy');
    const button = document.getElementById('show-pickup-spots-btn');
    if (!section || !copy) return;

    section.style.display = 'block';
    if (pickupPosition) {
        if (chip) chip.textContent = `${pickupPosition.index} of ${pickupPosition.total}`;
        copy.textContent = `This is one of ${pickupPosition.total} known places tied to this Junior Ranger badge or book. A future grouped map view can reveal the other pickup dots only while this park is selected.`;
        if (button) {
            button.style.display = 'inline-flex';
            button.disabled = true;
            button.textContent = 'Pickup Map Coming Next';
        }
    } else {
        if (chip) chip.textContent = 'Primary';
        copy.textContent = 'This pin is the listed Junior Ranger pickup or program location.';
        if (button) button.style.display = 'none';
    }
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
    button.title = 'Create a free account to save this to your B.A.R.K. profile.';
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
    getSafeHttpUrls,
    openFreeVisitLimitPaywall,
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

    if (!refreshOnly) document.getElementById('filter-panel').classList.add('collapsed');

    const d = marker._parkData;
    const pickupPosition = getPickupPosition(d);
    const displayName = getDisplayPlaceName(d.name);
    const bookLinks = getBookLinks(d);
    const websiteUrls = getSafeHttpUrls(d.website || '');

    if (titleEl) titleEl.textContent = displayName;
    const subtitleEl = document.getElementById('panel-subtitle');
    if (subtitleEl) {
        const subtitleParts = [getAgencyLabel(d.agency), d.state].filter(Boolean);
        subtitleEl.textContent = subtitleParts.length ? `${subtitleParts.join(' • ')} • Junior Ranger` : 'Junior Ranger program';
    }

    const metaContainer = document.getElementById('panel-meta-container');
    if (metaContainer) {
        clearElement(metaContainer);
        metaContainer.appendChild(createMetaPill('', d.swagType, 'Junior Ranger'));
        metaContainer.appendChild(createMetaPill('', d.specialPrograms ? 'Special Program' : 'Site Program', 'Site Program'));
        metaContainer.appendChild(createMetaPill('', pickupPosition ? `${pickupPosition.index} of ${pickupPosition.total} pickup spots` : d.state, 'Location'));
    }

    buildPrimaryActions(d, bookLinks);
    renderJuniorRangerSummary(d, pickupPosition);
    renderBookSection(d, bookLinks, websiteUrls);
    renderPickupSection(d, pickupPosition);

    const suggestEditBtn = document.getElementById('suggest-edit-btn');
    if (suggestEditBtn) {
        const subject = encodeURIComponent(`B.A.R.K. Map Edit: ${d.name}`);
        const body = encodeURIComponent(`Park Name: ${d.name}\nID: ${d.id}\n\n--- Please describe the update below ---\n`);
        suggestEditBtn.href = `mailto:usbarkrangers@gmail.com?subject=${subject}&body=${body}`;
    }

    // --- UPDATES & REPORTS ---
    if (d.info) {
        if (infoSection) infoSection.style.display = 'block';
        const container = document.getElementById('panel-info-container');
        const showMoreBtn = document.getElementById('show-more-info');
        setTextWithLineBreaks(infoEl, d.info);

        const hasManyLines = String(d.info || '').split(/\r?\n/).length > 5;

        if (d.info.length > 250 || hasManyLines) {
            if (container) container.classList.add('report-collapsed');
            if (showMoreBtn) {
                showMoreBtn.style.display = 'block';
                showMoreBtn.onclick = () => {
                    container.classList.remove('report-collapsed');
                    showMoreBtn.style.display = 'none';
                };
            }
        } else {
            if (container) container.classList.remove('report-collapsed');
            if (showMoreBtn) showMoreBtn.style.display = 'none';
        }
    } else {
        if (infoSection) infoSection.style.display = 'none';
        clearElement(infoEl);
    }

    const historySection = document.getElementById('panel-history-section');
    const historyEl = document.getElementById('panel-history');
    if (historySection && historyEl) {
        historySection.style.display = 'block';
        setTextWithLineBreaks(
            historyEl,
            d.historyTimelineInfo || 'Junior Ranger history notes have not been added for this location yet.'
        );
    }

    const videoUrl = getSafeHttpUrls(d.video || '')[0];
    const mediaLinks = document.getElementById('media-links');
    if (videoUrl) {
        if (mediaLinks) mediaLinks.style.display = 'flex';
        if (videoEl) {
            videoEl.style.display = 'block';
            configureExternalLink(videoEl, videoUrl);
        }
    } else {
        if (mediaLinks) mediaLinks.style.display = 'none';
        if (videoEl) { videoEl.style.display = 'none'; videoEl.removeAttribute('href'); }
    }

    if (picsEl) { picsEl.style.display = 'none'; clearElement(picsEl); }
    if (websitesContainer) {
        clearElement(websitesContainer);
        websitesContainer.style.display = 'none';
    }

    // --- MAP URLS & BUTTON RENDERING ---
    const stickyFooter = document.getElementById('panel-sticky-footer');
    if (stickyFooter) {
        stickyFooter.style.display = 'none';
        clearElement(stickyFooter);
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
                        return;
                    }

                    markVisitedBtn.classList.add('visited');
                    markVisitedText.textContent = '✓ Visited';
                    markVisitedBtn.disabled = false;
                    markVisitedBtn.style.cursor = 'pointer';
                    markVisitedBtn.style.opacity = '1';

                    window.syncState();
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
