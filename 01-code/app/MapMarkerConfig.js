/**
 * MapMarkerConfig.js
 * Exposes a generator function for creating Leaflet divIcons that adopt the premium 3D CSS.
 */

class MapMarkerConfig {
    static getAgencyKey(parkData = {}) {
        const agency = String(parkData.agency || parkData.rawAgency || '').trim().toLowerCase();

        if (agency.includes('blm') || agency.includes('bureau of land management')) return 'blm';
        if (agency.includes('army corps') || agency.includes('corps of engineer')) return 'army-corps';
        if (agency.includes('wildlife refuge') || agency.includes('fish & wildlife') || agency.includes('fish and wildlife')) return 'wildlife-refuge';
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
     * Generates a Leaflet L.marker with appropriate HTML structure and classes for CSS binding.
     * @param {Object} parkData - Data payload for the park (needs lat, lng, and parkCategory)
     * @param {Boolean} isVisited - True if the user has visited this park
     * @returns {L.marker} The constructed Leaflet marker instance
     */
    static createCustomMarker(parkData, isVisited) {
        const style = MapMarkerConfig.getPinStyle(parkData, isVisited);

        const stateClass = isVisited ? 'visited-marker visited-pin' : 'unvisited-marker';
        const catClass = style.categoryClass;
        const agencyClass = `agency-${style.agencyKey || 'other'}`;

        const markerHtml = `<div class="enamel-pin-wrapper jr-map-pin" aria-hidden="true"><span class="jr-pin-center"></span></div>`;

        // Initialize Leaflet divIcon
        const divIcon = L.divIcon({
            className: `custom-bark-marker ${stateClass} ${catClass} ${agencyClass}`,
            html: markerHtml,
            iconSize: [32, 44],
            iconAnchor: [16, 42],
            popupAnchor: [0, -40]
        });

        // Initialize and return the L.marker
        const marker = L.marker([parkData.lat, parkData.lng], { icon: divIcon });

        // Keep parkData securely bound for UI handlers downstream
        marker._parkData = parkData;

        return marker;
    }
}

// Export for usage
if (typeof window !== 'undefined') {
    window.MapMarkerConfig = MapMarkerConfig;
}
