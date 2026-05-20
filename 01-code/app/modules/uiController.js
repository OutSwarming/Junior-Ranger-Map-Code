/**
 * uiController.js — Navigation, Slide Panel, Filter Panel, Modals, iOS Fixes
 * Loaded TWELFTH in the boot sequence.
 */
window.BARK = window.BARK || {};

window.BARK.initUI = function initUI() {
let keyboardFocusContext = null;

// ====== iOS SAFARI MAGNIFIER PROTECTION ======
document.addEventListener('contextmenu', function (e) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
});

function isTextEntryElement(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;

    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['email', 'number', 'password', 'search', 'tel', 'text', 'url'].includes(type);
}

function isAppTabActive() {
    return Boolean(document.querySelector('.ui-view.active'));
}

function syncAppTabMode() {
    document.body.classList.toggle('app-tab-active', isAppTabActive());
}

function closeMapOnlySurfaces() {
    const panel = document.getElementById('slide-panel');
    if (panel) {
        panel.classList.remove('open', 'panel-dragging', 'panel-expanded');
        panel.removeAttribute('data-sheet-mode');
        panel.style.removeProperty('height');
    }
    document.body.classList.remove('mobile-sheet-high');
}

function settleAppViewportAfterKeyboard() {
    requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;

        const activeView = document.querySelector('.ui-view.active');
        if (!activeView) return;

        const maxScroll = Math.max(0, activeView.scrollHeight - activeView.clientHeight);
        if (keyboardFocusContext && keyboardFocusContext.view === activeView) {
            activeView.scrollTop = Math.min(keyboardFocusContext.scrollTop, maxScroll);
            return;
        }

        if (activeView.scrollTop > maxScroll) activeView.scrollTop = maxScroll;
    });
}

function scheduleAppViewportSettle() {
    settleAppViewportAfterKeyboard();
    setTimeout(settleAppViewportAfterKeyboard, 120);
    setTimeout(settleAppViewportAfterKeyboard, 320);
}

function dismissKeyboardTransientUi() {
    const activeElement = document.activeElement;

    if (typeof window.BARK.suppressInlinePlannerSuggestions === 'function') {
        window.BARK.suppressInlinePlannerSuggestions(700);
    } else if (typeof window.BARK.hideAllInlinePlannerSuggestions === 'function') {
        window.BARK.hideAllInlinePlannerSuggestions();
    }

    if (isTextEntryElement(activeElement) && typeof activeElement.blur === 'function') {
        activeElement.blur();
    }

    if (isAppTabActive()) closeMapOnlySurfaces();
    scheduleAppViewportSettle();
}

// ====== iOS KEYBOARD LAYOUT FIX ======
if (window.visualViewport) {
    let initialHeight = window.visualViewport.height;

    window.visualViewport.addEventListener('resize', () => {
        const isKeyboardOpen = (initialHeight - window.visualViewport.height) > window.screen.height * 0.2;
        const wasKeyboardOpen = document.body.classList.contains('keyboard-open');

        if (!isKeyboardOpen && wasKeyboardOpen) {
            dismissKeyboardTransientUi();
        }

        document.body.classList.toggle('keyboard-open', isKeyboardOpen);

        if (isKeyboardOpen && window.innerWidth < 768) {
            closeMapOnlySurfaces();
        }
    });

    window.addEventListener('orientationchange', () => {
        setTimeout(() => { initialHeight = window.visualViewport.height; }, 500);
    });
}

// ====== DOM ELEMENTS ======
const slidePanel = document.getElementById('slide-panel');
const closeSlideBtn = document.getElementById('close-slide-panel');
const slidePanelHandle = document.querySelector('.panel-drag-handle');
const navItems = document.querySelectorAll('.nav-item');
const uiViews = document.querySelectorAll('.ui-view');
const filterPanel = document.getElementById('filter-panel');
const bottomNav = document.querySelector('.glass-nav');
const leafletControls = document.querySelectorAll('.leaflet-control-container');
const MOBILE_SHEET_TOP_GAP = 8;
const MOBILE_SHEET_MODES = ['low', 'medium', 'high'];
const MOBILE_SHEET_DEFAULT_MODE = 'medium';
const MOBILE_SHEET_FLICK_MIN_DISTANCE = 18;
const MOBILE_SHEET_FLICK_VELOCITY = 0.62;

function findScrollableAncestorWithin(target, root) {
    let el = target;
    while (el && el !== document && root.contains(el)) {
        const style = window.getComputedStyle(el);
        const canScrollY = /(auto|scroll)/.test(style.overflowY || '') &&
            el.scrollHeight > el.clientHeight + 1;
        if (canScrollY) return el;
        el = el.parentElement;
    }
    return null;
}

function canScrollInDirection(el, deltaY) {
    if (!el || !Number.isFinite(deltaY) || Math.abs(deltaY) < 1) return false;
    if (deltaY > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    return el.scrollTop > 1;
}

function bindFixedSurfaceScrollGuard(root) {
    if (!root || root._barkScrollGuardBound) return;
    root._barkScrollGuardBound = true;
    let lastTouchY = null;

    root.addEventListener('touchstart', (event) => {
        lastTouchY = event.touches && event.touches.length === 1
            ? event.touches[0].clientY
            : null;
    }, { passive: true });

    const guardScroll = (event) => {
        let deltaY = event.deltaY || 0;
        if (event.type === 'touchmove') {
            if (!event.touches || event.touches.length !== 1 || lastTouchY === null) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            deltaY = lastTouchY - event.touches[0].clientY;
            lastTouchY = event.touches[0].clientY;
        }

        const scrollable = findScrollableAncestorWithin(event.target, root);
        if (scrollable && canScrollInDirection(scrollable, deltaY)) {
            event.stopPropagation();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
    };

    root.addEventListener('wheel', guardScroll, { passive: false, capture: true });
    root.addEventListener('touchmove', guardScroll, { passive: false, capture: true });
}

function resetSlidePanelHeight() {
    if (!slidePanel) return;
    slidePanel.classList.remove('panel-dragging', 'panel-expanded');
    slidePanel.removeAttribute('data-sheet-mode');
    slidePanel.style.removeProperty('height');
    document.body.classList.remove('mobile-sheet-high');
}

function isMobileSheetViewport() {
    return window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
}

function closeSlidePanel(options = {}) {
    if (!slidePanel) return;
    slidePanel.classList.remove('open');
    resetSlidePanelHeight();
    if (options.clearPin === true && typeof window.BARK.clearActivePin === 'function') {
        window.BARK.clearActivePin();
    }
}

function getStylePixelValue(element, property, fallback = 0) {
    if (!element) return fallback;
    const value = parseFloat(window.getComputedStyle(element)[property]);
    return Number.isFinite(value) ? value : fallback;
}

function getCompactLowSheetHeight(viewportHeight, highHeight) {
    const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const handleHeight = slidePanelHandle ? slidePanelHandle.getBoundingClientRect().height : 36;
    const actionRow = slidePanel ? slidePanel.querySelector('.panel-primary-actions') : null;
    const actionRowHeight = actionRow
        ? Math.max(62, Math.ceil(actionRow.getBoundingClientRect().height + 6))
        : 66;
    const panelPaddingTop = getStylePixelValue(slidePanel, 'paddingTop', 6);
    const panelPaddingBottom = getStylePixelValue(slidePanel, 'paddingBottom', 0);
    const content = slidePanel ? slidePanel.querySelector('.panel-content') : null;
    const contentPaddingBottom = getStylePixelValue(content, 'paddingBottom', 18);
    const compactTitleFontSize = Math.min(31, Math.max(25, viewportWidth * 0.07));
    const compactTitleHeight = Math.ceil(compactTitleFontSize * 1.1);
    const compactHeight = Math.ceil(
        panelPaddingTop +
        panelPaddingBottom +
        handleHeight +
        compactTitleHeight +
        actionRowHeight +
        contentPaddingBottom
    );

    return Math.min(highHeight, Math.max(156, Math.min(196, compactHeight)));
}

function getMobileSheetMetrics() {
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const navHeight = bottomNav ? bottomNav.getBoundingClientRect().height : 75;
    const searchRow = filterPanel ? filterPanel.querySelector('.search-bar-row') : null;
    const filterRect = searchRow
        ? searchRow.getBoundingClientRect()
        : (filterPanel ? filterPanel.getBoundingClientRect() : null);
    const layoutBottom = searchRow && filterPanel
        ? filterPanel.offsetTop + searchRow.offsetTop + searchRow.offsetHeight
        : null;
    const controlBottom = Number.isFinite(layoutBottom) && layoutBottom > 0
        ? layoutBottom
        : (filterRect ? filterRect.bottom : null);
    const topLimit = Number.isFinite(controlBottom) && controlBottom > 0
        ? Math.min(viewportHeight * 0.42, Math.max(0, controlBottom + MOBILE_SHEET_TOP_GAP))
        : Math.max(88, viewportHeight * 0.14);
    const highHeight = Math.max(280, viewportHeight - navHeight - topLimit);
    const lowHeight = getCompactLowSheetHeight(viewportHeight, highHeight);
    const mediumTarget = Math.max(lowHeight + 96, viewportHeight * 0.42);
    const mediumHeight = Math.min(highHeight, Math.max(lowHeight + 72, Math.min(mediumTarget, highHeight - 72)));
    const closeThreshold = Math.max(112, Math.min(150, lowHeight * 0.76));
    return {
        maxHeight: highHeight,
        defaultHeight: mediumHeight,
        lowHeight,
        mediumHeight,
        highHeight,
        closeThreshold,
        modeHeights: {
            low: lowHeight,
            medium: mediumHeight,
            high: highHeight
        }
    };
}

function normalizeSheetMode(mode) {
    return MOBILE_SHEET_MODES.includes(mode) ? mode : MOBILE_SHEET_DEFAULT_MODE;
}

function getSheetModeAfterFlick(startMode, direction) {
    const currentIndex = MOBILE_SHEET_MODES.indexOf(normalizeSheetMode(startMode));
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0) return 'closed';
    if (nextIndex >= MOBILE_SHEET_MODES.length) return MOBILE_SHEET_MODES[MOBILE_SHEET_MODES.length - 1];
    return MOBILE_SHEET_MODES[nextIndex];
}

function syncSheetChromeForMode(mode) {
    document.body.classList.toggle('mobile-sheet-high', mode === 'high');
}

function setSlidePanelMode(mode, options = {}) {
    if (!slidePanel || !isMobileSheetViewport()) return;
    const nextMode = normalizeSheetMode(mode);
    const metrics = getMobileSheetMetrics();
    slidePanel.dataset.sheetMode = nextMode;
    slidePanel.classList.remove('panel-dragging');
    slidePanel.classList.toggle('panel-expanded', nextMode === 'high');
    syncSheetChromeForMode(nextMode);

    const height = metrics.modeHeights[nextMode] || metrics.mediumHeight;
    slidePanel.style.height = `${Math.round(height)}px`;
    if (options.resetScroll !== false) {
        const panelScrollContainer = slidePanel.querySelector('.panel-content');
        if (panelScrollContainer) panelScrollContainer.scrollTop = 0;
    }
}

window.BARK.setSlidePanelMode = setSlidePanelMode;

function snapSlidePanelToDefaultHeight() {
    setSlidePanelMode(MOBILE_SHEET_DEFAULT_MODE);
}

window.BARK.resetSlidePanelSheet = function resetSlidePanelSheet(options = {}) {
    if (!slidePanel) return;
    if (options.snapToDefault === true) {
        snapSlidePanelToDefaultHeight();
        return;
    }
    resetSlidePanelHeight();
};

function bindSlidePanelDrag() {
    if (!slidePanel || !slidePanelHandle || slidePanelHandle._barkDragBound) return;
    slidePanelHandle._barkDragBound = true;
    const panelContent = slidePanel.querySelector('.panel-content');

    let dragState = null;
    let pendingHeight = null;
    let heightFrame = null;
    let suppressHandleClick = false;
    let contentGesture = null;

    const applySheetHeight = (height) => {
        slidePanel.style.height = `${Math.round(height)}px`;
    };

    const cancelPendingHeight = () => {
        if (heightFrame) cancelAnimationFrame(heightFrame);
        heightFrame = null;
        pendingHeight = null;
    };

    const setSheetHeight = (height, options = {}) => {
        pendingHeight = height;

        if (options.immediate === true) {
            cancelPendingHeight();
            pendingHeight = height;
            applySheetHeight(pendingHeight);
            pendingHeight = null;
            return;
        }

        if (heightFrame) return;
        heightFrame = requestAnimationFrame(() => {
            heightFrame = null;
            applySheetHeight(pendingHeight);
            pendingHeight = null;
        });
    };

    const getNearestModeForHeight = (height, metrics) => {
        return MOBILE_SHEET_MODES.reduce((closestMode, candidateMode) => {
            const candidateDistance = Math.abs((metrics.modeHeights[candidateMode] || 0) - height);
            const closestDistance = Math.abs((metrics.modeHeights[closestMode] || 0) - height);
            return candidateDistance < closestDistance ? candidateMode : closestMode;
        }, MOBILE_SHEET_DEFAULT_MODE);
    };

    const syncSheetModeForHeight = (height, metrics) => {
        const visualMode = getNearestModeForHeight(height, metrics);
        slidePanel.dataset.sheetMode = visualMode;
        slidePanel.classList.toggle('panel-expanded', visualMode === 'high');
        syncSheetChromeForMode(visualMode);
    };

    const getEventTime = (event) => {
        return Number.isFinite(event.timeStamp) && event.timeStamp > 0
            ? event.timeStamp
            : performance.now();
    };

    const dragMove = (event) => {
        if (!dragState) return;

        const clientY = event.touches && event.touches[0] ? event.touches[0].clientY : event.clientY;
        if (!Number.isFinite(clientY)) return;

        const eventTime = getEventTime(event);
        const elapsed = Math.max(1, eventTime - dragState.lastMoveTime);
        const instantVelocity = (dragState.lastY - clientY) / elapsed;
        dragState.velocity = (dragState.velocity * 0.35) + (instantVelocity * 0.65);
        dragState.lastY = clientY;
        dragState.lastMoveTime = eventTime;
        dragState.currentY = clientY;
        const deltaY = dragState.startY - clientY;
        let nextHeight = Math.min(
            dragState.maxHeight,
            Math.max(dragState.minHeight, dragState.startHeight + deltaY)
        );

        if (dragState.allowScrollHandoff && panelContent && deltaY > 0) {
            const expansionToHigh = Math.max(0, dragState.metrics.highHeight - dragState.startHeight);
            if (nextHeight >= dragState.metrics.highHeight - 1 && deltaY > expansionToHigh) {
                nextHeight = dragState.metrics.highHeight;
                panelContent.scrollTop = Math.max(0, dragState.startScrollTop + deltaY - expansionToHigh);
            }
        }

        dragState.currentHeight = nextHeight;
        setSheetHeight(nextHeight);
        syncSheetModeForHeight(nextHeight, dragState.metrics);
        if (event.cancelable) event.preventDefault();
    };

    const finishDrag = () => {
        if (!dragState) return;

        const state = dragState;
        dragState = null;
        slidePanel.classList.remove('panel-dragging');
        if (
            state.pointerId !== null &&
            state.pointerId !== undefined &&
            typeof slidePanelHandle.hasPointerCapture === 'function' &&
            typeof slidePanelHandle.releasePointerCapture === 'function'
        ) {
            try {
                if (slidePanelHandle.hasPointerCapture(state.pointerId)) {
                    slidePanelHandle.releasePointerCapture(state.pointerId);
                }
            } catch (_error) {
                // The pointer may already be released after interrupted gestures.
            }
        }
        document.removeEventListener('pointermove', dragMove);
        document.removeEventListener('pointerup', finishDrag);
        document.removeEventListener('pointercancel', finishDrag);
        document.removeEventListener('touchmove', dragMove, true);
        document.removeEventListener('touchend', finishDrag, true);
        document.removeEventListener('touchcancel', finishDrag, true);
        if (panelContent) {
            panelContent.removeEventListener('touchmove', handleContentTouchMove, true);
            panelContent.removeEventListener('touchend', finishContentGesture, true);
            panelContent.removeEventListener('touchcancel', finishContentGesture, true);
        }
        contentGesture = null;

        const metrics = getMobileSheetMetrics();
        const movedDown = state.currentY - state.startY;
        const totalDrag = Math.abs(state.currentY - state.startY);
        const currentHeight = state.currentHeight;
        if (totalDrag > 6) {
            suppressHandleClick = true;
            setTimeout(() => { suppressHandleClick = false; }, 250);
        }

        if ((state.startMode === 'low' && movedDown > 86) || currentHeight < metrics.closeThreshold) {
            cancelPendingHeight();
            closeSlidePanel({ clearPin: true });
            return;
        }

        const flickDirection = (
            totalDrag >= MOBILE_SHEET_FLICK_MIN_DISTANCE &&
            Math.abs(state.velocity) >= MOBILE_SHEET_FLICK_VELOCITY
        )
            ? (state.velocity > 0 ? 1 : -1)
            : 0;
        const flickMode = flickDirection ? getSheetModeAfterFlick(state.startMode, flickDirection) : null;
        if (flickMode === 'closed') {
            cancelPendingHeight();
            closeSlidePanel({ clearPin: true });
            return;
        }

        const nextMode = flickMode || getNearestModeForHeight(currentHeight, metrics);
        const keepScrollPosition = Boolean(
            state.allowScrollHandoff &&
            nextMode === 'high' &&
            panelContent &&
            panelContent.scrollTop > 0
        );
        cancelPendingHeight();
        setSlidePanelMode(nextMode, { resetScroll: !keepScrollPosition });
    };

    const startDrag = (clientY, pointerId = null, options = {}) => {
        if (!Number.isFinite(clientY) || !isMobileSheetViewport() || !slidePanel.classList.contains('open')) {
            return false;
        }
        const metrics = getMobileSheetMetrics();
        const rect = slidePanel.getBoundingClientRect();
        const startHeight = Number.isFinite(options.startHeight) ? options.startHeight : rect.height;
        const startTime = performance.now();
        dragState = {
            startY: clientY,
            currentY: clientY,
            lastY: clientY,
            lastMoveTime: startTime,
            velocity: 0,
            startHeight,
            currentHeight: startHeight,
            minHeight: Math.max(120, metrics.lowHeight * 0.48),
            maxHeight: metrics.highHeight,
            pointerId,
            metrics,
            startMode: slidePanel.dataset.sheetMode || MOBILE_SHEET_DEFAULT_MODE,
            source: options.source || 'handle',
            allowScrollHandoff: options.allowScrollHandoff === true,
            startScrollTop: Number.isFinite(options.startScrollTop) ? options.startScrollTop : 0
        };

        slidePanel.classList.add('panel-dragging');
        return true;
    };

    const finishContentGesture = () => {
        if (dragState && dragState.source === 'content') {
            finishDrag();
        }
        contentGesture = null;
        if (panelContent) {
            panelContent.removeEventListener('touchmove', handleContentTouchMove, true);
            panelContent.removeEventListener('touchend', finishContentGesture, true);
            panelContent.removeEventListener('touchcancel', finishContentGesture, true);
        }
    };

    function handleContentTouchMove(event) {
        if (!contentGesture || !event.touches || event.touches.length !== 1) return;

        const clientY = event.touches[0].clientY;
        const clientX = event.touches[0].clientX;
        const totalY = clientY - contentGesture.startY;
        const totalX = clientX - contentGesture.startX;
        const absY = Math.abs(totalY);
        const absX = Math.abs(totalX);
        const currentMode = normalizeSheetMode(slidePanel.dataset.sheetMode);
        const fingerMovedUp = clientY < contentGesture.lastY;
        const fingerMovedDown = clientY > contentGesture.lastY;
        contentGesture.lastX = clientX;
        contentGesture.lastY = clientY;

        if (!contentGesture.verticalIntent) {
            if (absX > absY && absX > 8) {
                contentGesture.horizontalIntent = true;
                return;
            }
            if (contentGesture.horizontalIntent || absY < 8) return;
            contentGesture.verticalIntent = true;
        }

        if (dragState && dragState.source === 'content') {
            dragMove(event);
            return;
        }

        if (currentMode !== 'high') {
            if (startDrag(contentGesture.startY, null, {
                source: 'content',
                allowScrollHandoff: true,
                startScrollTop: 0
            })) {
                dragMove(event);
            }
            return;
        }

        if (fingerMovedUp) {
            return;
        }

        if (fingerMovedDown && panelContent && panelContent.scrollTop <= 1) {
            if (startDrag(contentGesture.startY, null, {
                source: 'content',
                startHeight: getMobileSheetMetrics().highHeight,
                startScrollTop: 0
            })) {
                dragMove(event);
            }
        }
    }

    if (window.PointerEvent) {
        slidePanelHandle.addEventListener('pointerdown', (event) => {
            if (!startDrag(event.clientY, event.pointerId)) return;

            if (typeof slidePanelHandle.setPointerCapture === 'function') {
                try {
                    slidePanelHandle.setPointerCapture(event.pointerId);
                } catch (_error) {
                    // Synthetic or interrupted gestures may not have an active pointer to capture.
                }
            }
            document.addEventListener('pointermove', dragMove, { passive: false });
            document.addEventListener('pointerup', finishDrag);
            document.addEventListener('pointercancel', finishDrag);
            if (event.cancelable) event.preventDefault();
        });
    } else {
        slidePanelHandle.addEventListener('touchstart', (event) => {
            if (!event.touches || event.touches.length !== 1) return;
            if (!startDrag(event.touches[0].clientY)) return;

            // The fixed-panel scroll guard also listens to touchmove in capture
            // phase. Capture here first so legacy touch-only browsers do not
            // lose the drag before it reaches this sheet handler.
            document.addEventListener('touchmove', dragMove, { passive: false, capture: true });
            document.addEventListener('touchend', finishDrag, true);
            document.addEventListener('touchcancel', finishDrag, true);
            if (event.cancelable) event.preventDefault();
        }, { passive: false });
    }

    if (panelContent) {
        panelContent.addEventListener('touchstart', (event) => {
            if (!isMobileSheetViewport() || !slidePanel.classList.contains('open')) return;
            if (!event.touches || event.touches.length !== 1) return;

            contentGesture = {
                startX: event.touches[0].clientX,
                startY: event.touches[0].clientY,
                lastX: event.touches[0].clientX,
                lastY: event.touches[0].clientY,
                verticalIntent: false,
                horizontalIntent: false
            };
            panelContent.addEventListener('touchmove', handleContentTouchMove, { passive: false, capture: true });
            panelContent.addEventListener('touchend', finishContentGesture, true);
            panelContent.addEventListener('touchcancel', finishContentGesture, true);
        }, { passive: true });
    }

    slidePanelHandle.addEventListener('click', (event) => {
        if (!isMobileSheetViewport() || !slidePanel.classList.contains('open') || dragState) return;
        if (suppressHandleClick) {
            event.preventDefault();
            return;
        }

        const currentMode = normalizeSheetMode(slidePanel.dataset.sheetMode);
        const nextMode = currentMode === 'low' ? 'medium' : (currentMode === 'medium' ? 'high' : 'medium');
        setSlidePanelMode(nextMode);
        event.preventDefault();
    });
}

if (slidePanel && window.MutationObserver) {
    const slidePanelObserver = new MutationObserver(() => {
        if (isAppTabActive() && slidePanel.classList.contains('open')) {
            slidePanel.classList.remove('open');
        }
    });

    slidePanelObserver.observe(slidePanel, { attributes: true, attributeFilter: ['class'] });
}

document.addEventListener('focusin', (e) => {
    if (!isTextEntryElement(e.target) || !isAppTabActive()) return;
    const activeView = document.querySelector('.ui-view.active');
    keyboardFocusContext = activeView
        ? { view: activeView, scrollTop: activeView.scrollTop }
        : null;
    closeMapOnlySurfaces();
});

document.addEventListener('focusout', (e) => {
    if (!isTextEntryElement(e.target) || !isAppTabActive()) return;
    setTimeout(() => {
        if (isTextEntryElement(document.activeElement)) return;
        scheduleAppViewportSettle();
    }, 120);
}, true);

function initUIEventListeners() {
    const bindClick = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    };
    const bindDisplayModalDismiss = (id, surface) => {
        const modal = document.getElementById(id);
        const bindDismissableOverlay = window.BARK.DOM && window.BARK.DOM.bindDismissableOverlay;
        if (!modal || typeof bindDismissableOverlay !== 'function') return;
        bindDismissableOverlay({
            overlay: modal,
            surface,
            onDismiss: () => { modal.style.display = 'none'; }
        });
    };

    // ====== STATIC INLINE HANDLER REPLACEMENTS ======
    bindClick('auto-sort-day-btn', () => {
        if (typeof window.autoSortDay === 'function') window.autoSortDay();
    });
    bindClick('planner-load-btn', () => {
        if (typeof window.togglePlannerRoutes === 'function') window.togglePlannerRoutes();
    });
    bindClick('planner-routes-close-btn', () => {
        if (typeof window.togglePlannerRoutes === 'function') window.togglePlannerRoutes();
    });
    bindClick('share-single-expedition-btn', () => {
        if (typeof window.shareSingleExpedition === 'function') window.shareSingleExpedition();
    });
    bindClick('claim-reward-btn', () => {
        if (typeof window.claimRewardAndReset === 'function') window.claimRewardAndReset();
    });
    bindClick('fly-active-trail-btn', () => {
        if (typeof window.flyToActiveTrail === 'function') window.flyToActiveTrail();
    });
    bindClick('trail-brief-btn', () => {
        const modal = document.getElementById('trail-education-modal');
        if (modal) modal.style.display = 'flex';
    });
    bindClick('training-action-btn', () => {
        if (typeof window.handleTrainingClick === 'function') window.handleTrainingClick();
    });
    bindClick('cancel-training-btn', () => {
        if (typeof window.cancelTrainingWalk === 'function') window.cancelTrainingWalk();
    });
    bindClick('share-all-expeditions-btn', () => {
        if (typeof window.shareAllExpeditions === 'function') window.shareAllExpeditions();
    });
    bindClick('share-vault-btn', () => {
        if (typeof window.shareVaultCard === 'function') window.shareVaultCard();
    });
    bindClick('optimizer-modal-close-btn', () => {
        const modal = document.getElementById('optimizer-modal');
        if (modal) modal.style.display = 'none';
    });
    bindClick('execute-smart-optimization-btn', () => {
        if (typeof window.executeSmartOptimization === 'function') window.executeSmartOptimization();
    });
    bindClick('trail-education-close-btn', () => {
        const modal = document.getElementById('trail-education-modal');
        if (modal) modal.style.display = 'none';
    });

    bindDisplayModalDismiss('scoring-modal', '.scoring-modal-card');
    bindDisplayModalDismiss('optimizer-modal', '.scoring-modal-card');
    bindDisplayModalDismiss('trail-education-modal', '.scoring-modal-card');
}

initUIEventListeners();
syncAppTabMode();

// ====== PLANNER SCROLL: DISMISS INLINE SUGGESTIONS ======
// When the user scrolls the planner view without selecting a suggestion,
// hide the dropdown. This prevents the dropdown from extending the scroll
// height while the keyboard is open, which causes Safari's position:fixed
// nav bar to glitch.
const plannerViewEl = document.getElementById('planner-view');
if (plannerViewEl) {
    let dismissTimer = null;
    plannerViewEl.addEventListener('scroll', () => {
        clearTimeout(dismissTimer);
        dismissTimer = setTimeout(() => {
            ['start', 'end'].forEach(type => {
                const suggestBox = document.getElementById(`inline-suggest-${type}`);
                if (suggestBox) suggestBox.style.display = 'none';
            });
        }, 80);
    }, { passive: true });
}

// Stop Leaflet from stealing touches on the UI panels
if (slidePanel) {
    L.DomEvent.disableClickPropagation(slidePanel);
    L.DomEvent.disableScrollPropagation(slidePanel);
    bindSlidePanelDrag();
}
if (filterPanel) {
    L.DomEvent.disableClickPropagation(filterPanel);
    L.DomEvent.disableScrollPropagation(filterPanel);
    bindFixedSurfaceScrollGuard(filterPanel);
}
if (bottomNav) {
    L.DomEvent.disableClickPropagation(bottomNav);
    L.DomEvent.disableScrollPropagation(bottomNav);
    bindFixedSurfaceScrollGuard(bottomNav);
}

// Close panel and clear pin
if (closeSlideBtn) {
    closeSlideBtn.addEventListener('click', () => {
        closeSlidePanel({ clearPin: true });
    });
}

// ====== NAVIGATION LOGIC ======
navItems.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');

        if (typeof window.BARK.closeSettingsModal === 'function') {
            window.BARK.closeSettingsModal();
        }

        navItems.forEach(n => n.classList.remove('active'));
        btn.classList.add('active');

        if (targetId === 'map-view') {
            uiViews.forEach(v => v.classList.remove('active'));
            syncAppTabMode();
            closeMapOnlySurfaces();
            requestAnimationFrame(() => {
                if (filterPanel) filterPanel.style.display = 'flex';
                if (leafletControls.length) leafletControls[0].style.display = 'block';
                if (window.map) window.map.invalidateSize();
                if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
                    window.BARK.invalidateMarkerVisibility();
                }
                if (typeof window.syncState === 'function') {
                    window.BARK._pendingMarkerSync = false;
                    window.syncState();
                }
            });
        } else {
            uiViews.forEach(v => {
                if (v.id === targetId) v.classList.add('active');
                else v.classList.remove('active');
            });
            syncAppTabMode();
            if (filterPanel) filterPanel.style.display = 'none';
            closeSlidePanel();
            if (leafletControls.length) leafletControls[0].style.display = 'none';
        }
    });
});

// ====== MAP INTERACTION HANDLERS ======
if (window.map) {
    // Close panel when clicking on map
    map.on('click', () => {
        closeSlidePanel({ clearPin: true });
        document.getElementById('filter-panel').classList.add('collapsed');
    });

    // Auto-collapse filter when user pans
    map.on('movestart', () => {
        const fp = document.getElementById('filter-panel');
        if (fp && !fp.classList.contains('collapsed')) fp.classList.add('collapsed');
    });
}

// Toggle filter panel
const toggleFilterBtn = document.getElementById('toggle-filter-btn');
if (toggleFilterBtn) {
    toggleFilterBtn.addEventListener('click', () => {
        document.getElementById('filter-panel').classList.toggle('collapsed');
    });
}

// ====== VISITED FILTER DROPDOWN ======
const visitedFilterEl = document.getElementById('visited-filter');
if (visitedFilterEl) {
    visitedFilterEl.value = window.BARK.visitedFilterState;
    visitedFilterEl.addEventListener('change', (e) => {
        const requestedFilter = e.target.value;
        const authPremiumUi = window.BARK && window.BARK.authPremiumUi;
        const allowedFilter = authPremiumUi && typeof authPremiumUi.getAllowedVisitedFilter === 'function'
            ? authPremiumUi.getAllowedVisitedFilter(requestedFilter)
            : requestedFilter;

        if (allowedFilter !== requestedFilter) {
            e.target.value = allowedFilter;
            if (authPremiumUi && typeof authPremiumUi.openPremiumPrompt === 'function') {
                authPremiumUi.openPremiumPrompt('premium-visited-filter');
            }
        }

        window.BARK.visitedFilterState = allowedFilter;
        localStorage.setItem('barkVisitedFilter', window.BARK.visitedFilterState);
        window.syncState();
    });
}

// ====== SCORING MODAL ======
document.addEventListener('click', (e) => {
    const modal = document.getElementById('scoring-modal');
    if (!modal) return;
    if (e.target.closest('#scoring-info-btn')) modal.style.display = 'flex';
    if (e.target.closest('#close-scoring-modal') || e.target === modal) modal.style.display = 'none';
});

// ====== FEEDBACK PORTAL ======
const submitFeedbackBtn = document.getElementById('submit-feedback-btn');
function isFeedbackEnabled() {
    return !window.BARK ||
        typeof window.BARK.isLaunchFlagEnabled !== 'function' ||
        window.BARK.isLaunchFlagEnabled('feedbackEnabled');
}

function disableFeedbackPortal(message) {
    const portal = document.getElementById('feedback-portal');
    const textArea = document.getElementById('feedback-text');
    const copy = portal ? portal.querySelector('p') : null;
    if (portal) portal.dataset.launchDisabled = 'true';
    if (copy) copy.textContent = message;
    if (textArea) {
        textArea.value = '';
        textArea.placeholder = message;
        textArea.disabled = true;
    }
    if (submitFeedbackBtn) {
        submitFeedbackBtn.textContent = 'Feedback paused';
        submitFeedbackBtn.disabled = true;
    }
}

if (submitFeedbackBtn && !isFeedbackEnabled()) {
    const message = window.BARK && typeof window.BARK.getLaunchFlagMessage === 'function'
        ? window.BARK.getLaunchFlagMessage('feedbackEnabled')
        : 'In-app feedback is paused for beta safety. Use the email suggestion option above for now.';
    disableFeedbackPortal(message);
} else if (submitFeedbackBtn && typeof firebase !== 'undefined') {
    submitFeedbackBtn.addEventListener('click', async () => {
        const textArea = document.getElementById('feedback-text');
        const text = textArea ? textArea.value : '';
        if (!text || text.trim() === '') return;
        if (textArea && typeof textArea.blur === 'function') textArea.blur();
        dismissKeyboardTransientUi();

        const user = firebase.auth().currentUser;
        if (!user) {
            submitFeedbackBtn.textContent = 'Sign in to send';
            setTimeout(() => { submitFeedbackBtn.textContent = 'Submit Feedback'; }, 3000);
            return;
        }

        submitFeedbackBtn.textContent = 'Submitting...';
        submitFeedbackBtn.disabled = true;

        try {
            window.BARK.incrementRequestCount();
            const submitFeedback = firebase.functions().httpsCallable('submitFeedback');
            await submitFeedback({
                message: text,
                type: 'general',
                browser: {
                    userAgent: navigator.userAgent,
                    platform: navigator.platform,
                    language: navigator.language,
                    path: window.location ? window.location.pathname : '',
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight
                }
            });
            submitFeedbackBtn.textContent = 'Feedback Sent!';
            if (textArea) textArea.value = '';
            setTimeout(() => { submitFeedbackBtn.textContent = 'Submit Feedback'; submitFeedbackBtn.disabled = false; }, 3000);
        } catch (err) {
            console.error('Feedback error:', err);
            const code = String(err && err.code ? err.code : '').replace(/^functions\//, '');
            submitFeedbackBtn.textContent = code === 'resource-exhausted'
                ? 'Try again later'
                : code === 'unauthenticated'
                    ? 'Sign in to send'
                    : 'Error. Try again';
            submitFeedbackBtn.disabled = false;
        }
    });
}

// ====== UPDATE TOAST ======
const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
    refreshBtn.addEventListener('click', () => window.location.reload(true));
}
};
