/**
 * MapMarkerConfig.js
 * Exposes a generator function for fast Leaflet image icons.
 */

class MapMarkerConfig {
    static getPinIconUrl(style = {}, options = {}) {
        const fill = style.pinColor || '#2563EB';
        const isVisited = options.isVisited === true || style.ringColor === '#22C55E';
        const isActive = options.isActive === true;
        const isPickupLocation = options.isPickupLocation === true;
        const stroke = isActive
            ? '#FBBF24'
            : isPickupLocation
                ? '#D97706'
            : (style.ringColor && style.ringColor !== fill ? style.ringColor : '#FFFFFF');
        const strokeWidth = isActive ? 3.75 : (isPickupLocation ? 3.35 : (stroke === '#FFFFFF' ? 2.25 : 3));
        const centerFill = isVisited ? '#22C55E' : '#FFFFFF';
        const centerRadius = isVisited ? 6.4 : 5.1;
        const visitedGlyph = isVisited
            ? '<path d="M16 11.1l1.5 3.1 3.4.5-2.45 2.4.58 3.38L16 18.86l-3.03 1.62.58-3.38-2.45-2.4 3.4-.5L16 11.1Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width=".45" stroke-linejoin="round"/>'
            : '';
        const cacheKey = `${fill}|${stroke}|${strokeWidth}|${centerFill}|${centerRadius}`;

        MapMarkerConfig._pinIconUrlCache = MapMarkerConfig._pinIconUrlCache || new Map();
        if (MapMarkerConfig._pinIconUrlCache.has(cacheKey)) {
            return MapMarkerConfig._pinIconUrlCache.get(cacheKey);
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44"><path d="M16 42S4 28.4 4 16.4C4 9.6 9.4 4 16 4s12 5.6 12 12.4C28 28.4 16 42 16 42Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/><circle cx="16" cy="16.5" r="${centerRadius}" fill="${centerFill}" stroke="#FFFFFF" stroke-width="${isVisited ? 1.2 : 0}"/>${visitedGlyph}</svg>`;
        const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
        MapMarkerConfig._pinIconUrlCache.set(cacheKey, url);
        return url;
    }

    static getIconSignature(parkData, isVisited = false, isActive = false) {
        const style = MapMarkerConfig.getPinStyle(parkData, isVisited);
        const pickupState = parkData && parkData._isPickupLocation ? 'pickup' : 'main';
        return `${style.agencyKey}|${isVisited ? 'visited' : 'open'}|${isActive ? 'active' : 'idle'}|${pickupState}`;
    }

    static createIcon(parkData, isVisited = false, isActive = false) {
        const style = MapMarkerConfig.getPinStyle(parkData, isVisited);
        const stateClass = isVisited ? 'visited-marker visited-pin' : 'unvisited-marker';
        const catClass = style.categoryClass;
        const agencyClass = `agency-${style.agencyKey || 'other'}`;
        const activeClass = isActive ? 'active-pin' : '';
        const pickupClass = parkData && parkData._isPickupLocation ? 'pickup-location-pin' : '';
        const iconSize = isActive ? [39, 54] : [32, 44];
        const iconAnchor = isActive ? [20, 51] : [16, 42];

        return L.icon({
            className: `custom-bark-marker jr-svg-pin ${stateClass} ${catClass} ${agencyClass} ${activeClass} ${pickupClass}`.trim(),
            iconUrl: MapMarkerConfig.getPinIconUrl(style, {
                isVisited,
                isActive,
                isPickupLocation: parkData && parkData._isPickupLocation
            }),
            iconSize,
            iconAnchor,
            popupAnchor: [0, -40]
        });
    }

    static getAgencyKey(parkData = {}) {
        const agency = String(parkData.agency || parkData.rawAgency || '').trim().toLowerCase();

        if (agency.includes('blm') || agency.includes('bureau of land management')) return 'blm';
        if (agency.includes('army corps') || agency.includes('corps of engineer')) return 'army-corps';
        if (agency.includes('wildlife refuge') || agency.includes('fish & wildlife') || agency.includes('fish and wildlife')) return 'wildlife-refuge';
        if (agency.includes('national forest') || agency.includes('forest service') || agency.includes('usfs')) return 'national-forest';
        if (agency.includes('state park') || agency.includes('state forest') || agency === 'state') return 'state-park';
        if (agency.includes('nps') || agency.includes('national park service')) return 'nps';

        const category = String(parkData.parkCategory || parkData.category || '').trim().toLowerCase();
        if (category === 'national') return 'nps';
        if (category === 'state') return 'state-park';
        return 'other';
    }

    static getAgencyPalette(parkData = {}) {
        const agencyKey = MapMarkerConfig.getAgencyKey(parkData);
        const palettes = {
            nps: { pinColor: '#2563EB', pinShadowColor: 'rgba(37, 99, 235, 0.42)' },
            'state-park': { pinColor: '#111827', pinShadowColor: 'rgba(17, 24, 39, 0.44)' },
            'army-corps': { pinColor: '#DC2626', pinShadowColor: 'rgba(220, 38, 38, 0.42)' },
            'wildlife-refuge': { pinColor: '#16A34A', pinShadowColor: 'rgba(22, 163, 74, 0.42)' },
            'national-forest': { pinColor: '#8B5E34', pinShadowColor: 'rgba(139, 94, 52, 0.44)' },
            blm: { pinColor: '#F97316', pinShadowColor: 'rgba(249, 115, 22, 0.42)' },
            other: { pinColor: '#FACC15', pinShadowColor: 'rgba(250, 204, 21, 0.45)' }
        };

        return {
            agencyKey,
            ...palettes[agencyKey]
        };
    }

    static getPinStyle(parkData, isVisited = false) {
        const palette = MapMarkerConfig.getAgencyPalette(parkData);
        const isNational = (parkData.parkCategory === 'National');
        return {
            label: 'JR',
            agencyKey: palette.agencyKey,
            ringColor: isVisited ? '#22C55E' : palette.pinColor,
            pinColor: palette.pinColor,
            pinShadowColor: isVisited ? 'rgba(34, 197, 94, 0.42)' : palette.pinShadowColor,
            categoryClass: isNational ? 'cat-national' : 'cat-state'
        };
    }

    /**
     * Generates a Leaflet L.marker with appropriate icon classes for CSS binding.
     * @param {Object} parkData - Data payload for the park (needs lat, lng, and parkCategory)
     * @param {Boolean} isVisited - True if the user has visited this park
     * @returns {L.marker} The constructed Leaflet marker instance
     */
    static createCustomMarker(parkData, isVisited) {
        const marker = L.marker([parkData.lat, parkData.lng], {
            icon: MapMarkerConfig.createIcon(parkData, isVisited)
        });

        // Keep parkData securely bound for UI handlers downstream
        marker._parkData = parkData;
        marker._barkIconSignature = MapMarkerConfig.getIconSignature(parkData, isVisited, false);

        return marker;
    }
}

// Export for usage
if (typeof window !== 'undefined') {
    window.MapMarkerConfig = MapMarkerConfig;
}
