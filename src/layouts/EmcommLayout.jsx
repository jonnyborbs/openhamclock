/**
 * EmComm Layout — Emergency Communications operations dashboard
 * Map with range rings + NWS/FEMA overlays, sidebar with structured panels
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { WorldMap } from '../components';
import { calculateDistance, formatDistance } from '../utils/geo.js';

// APRS symbol codes for emergency-related stations
const EMCOMM_SYMBOLS = new Set([
  '/o', // EOC
  '\\z', // Shelter
  '\\!', // Emergency
  '/+', // Red Cross
  '\\a', // ARES
  '\\y', // Skywarn
  'Eo', // EOC alternate
  'So', // Shelter alternate
]);

const SYMBOL_LABELS = {
  '/o': 'EOC',
  '\\z': 'Shelter',
  '\\!': 'Emergency',
  '/+': 'Red Cross',
  '\\a': 'ARES',
  '\\y': 'Skywarn',
};

const SEVERITY_COLORS = {
  Extreme: '#dc2626',
  Severe: '#ea580c',
  Moderate: '#d97706',
  Minor: '#ca8a04',
  Unknown: '#6b7280',
};

const SHELTER_STATUS_COLORS = {
  OPEN: '#22c55e',
  CLOSED: '#ef4444',
  FULL: '#f59e0b',
};

export default function EmcommLayout(props) {
  const {
    config,
    utcTime,
    utcDate,
    dxLocation,
    dxLocked,
    handleDXChange,
    handleToggleDxLock,
    mapLayers,
    toggleDXLabels,
    toggleSatellites,
    hoveredSpot,
    setHoveredSpot,
    filteredSatellites,
    filteredPskSpots,
    wsjtxMapSpots,
    dxClusterData,
    dxFilters,
    mapBandFilter,
    setMapBandFilter,
    aprsData,
    emcommData,
    setShowSettings,
  } = props;

  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(() => String(new Date().getUTCSeconds()).padStart(2, '0'));
  const [expandedAlert, setExpandedAlert] = useState(null);
  const mapInstanceRef = useRef(null);
  const overlayLayersRef = useRef([]);

  // UTC seconds ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(String(new Date().getUTCSeconds()).padStart(2, '0'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const { alerts = [], shelters = [], disasters = [], loading } = emcommData || {};
  const aprsStations = aprsData?.stations || [];

  // Filter APRS stations to emergency symbols
  const emcommStations = useMemo(() => {
    return aprsStations.filter((s) => s.symbol && EMCOMM_SYMBOLS.has(s.symbol));
  }, [aprsStations]);

  // Calculate distance from DE for shelters
  const sheltersWithDistance = useMemo(() => {
    if (!config.location?.lat || !config.location?.lon) return shelters;
    return shelters
      .map((s) => ({
        ...s,
        distance: s.lat && s.lon ? calculateDistance(config.location.lat, config.location.lon, s.lat, s.lon) : null,
      }))
      .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
  }, [shelters, config.location]);

  // Calculate distance for emcomm APRS stations
  const emcommStationsWithDistance = useMemo(() => {
    if (!config.location?.lat || !config.location?.lon) return emcommStations;
    return emcommStations
      .map((s) => ({
        ...s,
        distance: s.lat && s.lon ? calculateDistance(config.location.lat, config.location.lon, s.lat, s.lon) : null,
      }))
      .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
  }, [emcommStations, config.location]);

  // Sort alerts by severity
  const sortedAlerts = useMemo(() => {
    const order = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
    return [...alerts].sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));
  }, [alerts]);

  // Handle map ready — add range rings and overlays
  const handleMapReady = useCallback((map) => {
    mapInstanceRef.current = map;
  }, []);

  // Manage range rings and alert/shelter overlays
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || typeof window.L === 'undefined') return;
    const L = window.L;

    // Clear previous overlays
    overlayLayersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {
        /* ignore */
      }
    });
    overlayLayersRef.current = [];

    const de = config.location;
    if (!de?.lat || !de?.lon) return;

    // Range rings at 50, 100, 200 km
    [50, 100, 200].forEach((km) => {
      const ring = L.circle([de.lat, de.lon], {
        radius: km * 1000,
        fill: false,
        color: '#666',
        weight: 1,
        dashArray: '8,8',
        interactive: false,
      });
      ring.addTo(map);
      overlayLayersRef.current.push(ring);

      // Label
      const label = L.marker([de.lat + km / 111, de.lon], {
        icon: L.divIcon({
          className: '',
          html: `<span style="color:#888;font-size:10px;white-space:nowrap">${km}km</span>`,
          iconSize: [40, 14],
          iconAnchor: [20, 14],
        }),
        interactive: false,
      });
      label.addTo(map);
      overlayLayersRef.current.push(label);
    });

    // NWS Alert polygons
    alerts.forEach((alert) => {
      if (!alert.geometry?.coordinates) return;
      const color = SEVERITY_COLORS[alert.severity] || '#6b7280';
      try {
        const coords = alert.geometry.type === 'Polygon' ? [alert.geometry.coordinates] : alert.geometry.coordinates;
        coords.forEach((polyCoords) => {
          const latlngs = polyCoords[0].map(([lon, lat]) => [lat, lon]);
          const polygon = L.polygon(latlngs, {
            color,
            fillColor: color,
            fillOpacity: 0.15,
            weight: 2,
          });
          polygon.bindPopup(`<b>${alert.event}</b><br>${alert.headline || ''}`);
          polygon.addTo(map);
          overlayLayersRef.current.push(polygon);
        });
      } catch (e) {
        /* skip malformed geometry */
      }
    });

    // Shelter markers
    shelters.forEach((shelter) => {
      if (!shelter.lat || !shelter.lon) return;
      const color = SHELTER_STATUS_COLORS[shelter.status] || '#6b7280';
      const marker = L.circleMarker([shelter.lat, shelter.lon], {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: 0.6,
        weight: 2,
      });
      const pop = `<b>${shelter.name || 'Shelter'}</b><br>
        ${shelter.address || ''}, ${shelter.city || ''}<br>
        Status: ${shelter.status || 'Unknown'}<br>
        Capacity: ${shelter.currentPopulation || 0}/${shelter.evacuationCapacity || '?'}
        ${shelter.wheelchairAccessible ? ' ♿' : ''}${shelter.petFriendly ? ' 🐾' : ''}`;
      marker.bindPopup(pop);
      marker.addTo(map);
      overlayLayersRef.current.push(marker);
    });

    return () => {
      overlayLayersRef.current.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {
          /* ignore */
        }
      });
      overlayLayersRef.current = [];
    };
  }, [config.location, alerts, shelters]);

  // Click shelter to pan map
  const panToShelter = useCallback((shelter) => {
    const map = mapInstanceRef.current;
    if (map && shelter.lat && shelter.lon) {
      map.setView([shelter.lat, shelter.lon], 10, { animate: true });
    }
  }, []);

  // Time until expiry helper
  const expiresIn = useCallback((expiresStr) => {
    if (!expiresStr) return '';
    const diff = new Date(expiresStr) - new Date();
    if (diff <= 0) return 'Expired';
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  }, []);

  // Incident type icon
  const incidentIcon = useCallback((type) => {
    const icons = {
      Hurricane: '🌀',
      Tornado: '🌪️',
      Flood: '🌊',
      Fire: '🔥',
      'Severe Storm': '⛈️',
      Earthquake: '🏚️',
      'Snow/Ice': '❄️',
    };
    return icons[type] || '⚠️';
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'grid',
        gridTemplateRows: '44px 1fr',
        background: '#0a0a0a',
        fontFamily: 'JetBrains Mono, monospace',
        overflow: 'hidden',
        color: '#ccc',
      }}
    >
      {/* HEADER */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: '#111',
          borderBottom: '1px solid #333',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{ color: '#f59e0b', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
            onClick={() => setShowSettings(true)}
          >
            {config.callsign || 'N0CALL'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '16px', letterSpacing: '2px' }}>
            EMERGENCY COMMUNICATIONS
          </span>
          <span
            style={{
              color: '#888',
              fontSize: '9px',
              border: '1px solid #555',
              borderRadius: '3px',
              padding: '1px 4px',
              marginLeft: '4px',
            }}
          >
            BETA
          </span>
          {loading && <span style={{ color: '#888', fontSize: '11px', marginLeft: '8px' }}>Loading...</span>}
        </div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px' }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>
            {utcTime}:{seconds}
          </span>
          <span style={{ color: '#888', marginLeft: '6px', fontSize: '11px' }}>UTC</span>
        </div>
      </div>

      {/* MAIN: MAP + SIDEBAR */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', overflow: 'hidden' }}>
        {/* MAP */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <WorldMap
            deLocation={config.location}
            dxLocation={dxLocation}
            onDXChange={handleDXChange}
            dxLocked={dxLocked}
            potaSpots={[]}
            sotaSpots={[]}
            wwbotaSpots={[]}
            mySpots={[]}
            dxPaths={[]}
            dxFilters={dxFilters}
            mapBandFilter={mapBandFilter}
            onMapBandFilterChange={setMapBandFilter}
            satellites={[]}
            pskReporterSpots={[]}
            showDeDxMarkers={true}
            showDXPaths={false}
            showDXLabels={false}
            onToggleDXLabels={toggleDXLabels}
            showPOTA={false}
            showSOTA={false}
            showWWBOTA={false}
            showSatellites={false}
            showPSKReporter={false}
            showPSKPaths={false}
            wsjtxSpots={[]}
            showWSJTX={false}
            showDXNews={false}
            showAPRS={true}
            aprsStations={aprsData?.filteredStations}
            aprsWatchlistCalls={aprsData?.allWatchlistCalls}
            hoveredSpot={hoveredSpot}
            hideOverlays={true}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
            allUnits={config.allUnits}
            mouseZoom={config.mouseZoom}
            onMapReady={handleMapReady}
          />
        </div>

        {/* SIDEBAR */}
        <div
          style={{
            background: '#111',
            borderLeft: '1px solid #333',
            overflowY: 'auto',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* NWS Alerts Panel */}
          <PanelSection title="NWS Alerts" count={sortedAlerts.length} color="#dc2626">
            {sortedAlerts.length === 0 ? (
              <EmptyState text="No active alerts for your area" />
            ) : (
              sortedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    padding: '6px 8px',
                    borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity] || '#888'}`,
                    background: expandedAlert === alert.id ? '#1a1a1a' : 'transparent',
                    cursor: 'pointer',
                    marginBottom: '4px',
                  }}
                  onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: SEVERITY_COLORS[alert.severity], fontWeight: 600, fontSize: '12px' }}>
                      {alert.event}
                    </span>
                    <span style={{ color: '#888', fontSize: '10px' }}>{expiresIn(alert.expires)}</span>
                  </div>
                  <div style={{ color: '#aaa', fontSize: '11px', marginTop: '2px' }}>{alert.headline}</div>
                  {expandedAlert === alert.id && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#999', lineHeight: '1.4' }}>
                      {alert.description && (
                        <div style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>
                          {alert.description.substring(0, 500)}
                          {alert.description.length > 500 ? '...' : ''}
                        </div>
                      )}
                      {alert.instruction && (
                        <div style={{ color: '#f59e0b', fontStyle: 'italic' }}>
                          {alert.instruction.substring(0, 300)}
                        </div>
                      )}
                      <div style={{ color: '#666', marginTop: '4px' }}>{alert.areaDesc}</div>
                    </div>
                  )}
                </div>
              ))
            )}
          </PanelSection>

          {/* Disaster Declarations Panel */}
          <PanelSection title="Disaster Declarations" count={disasters.length} color="#f59e0b">
            {disasters.length === 0 ? (
              <EmptyState text="No recent disaster declarations" />
            ) : (
              disasters.map((d) => (
                <div
                  key={d.id || d.disasterNumber}
                  style={{
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '11px',
                    marginBottom: '2px',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>{incidentIcon(d.incidentType)}</span>
                  <div>
                    <div style={{ color: '#ddd' }}>{d.declarationTitle}</div>
                    <div style={{ color: '#888', fontSize: '10px' }}>
                      {d.incidentType} —{' '}
                      {d.declarationType === 'DR'
                        ? 'Major'
                        : d.declarationType === 'EM'
                          ? 'Emergency'
                          : d.declarationType}
                    </div>
                  </div>
                </div>
              ))
            )}
          </PanelSection>

          {/* Shelters Panel */}
          <PanelSection title="Nearby Shelters" count={sheltersWithDistance.length} color="#22c55e">
            {sheltersWithDistance.length === 0 ? (
              <EmptyState text="No open shelters nearby" />
            ) : (
              sheltersWithDistance.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: '4px 8px',
                    cursor: 'pointer',
                    marginBottom: '3px',
                    borderRadius: '3px',
                  }}
                  onClick={() => panToShelter(s)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1a')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ddd', fontSize: '12px', fontWeight: 500 }}>
                      {s.name || 'Unnamed Shelter'}
                    </span>
                    <span
                      style={{
                        color: SHELTER_STATUS_COLORS[s.status] || '#888',
                        fontSize: '10px',
                        fontWeight: 600,
                      }}
                    >
                      {s.status || '?'}
                    </span>
                  </div>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}
                  >
                    <span style={{ color: '#888', fontSize: '10px' }}>
                      {s.distance != null ? formatDistance(s.distance, config.allUnits?.dist || 'imperial') : ''}{' '}
                      {s.wheelchairAccessible ? '♿' : ''} {s.petFriendly ? '🐾' : ''}
                    </span>
                    <CapacityBar current={s.currentPopulation} max={s.evacuationCapacity} />
                  </div>
                </div>
              ))
            )}
          </PanelSection>

          {/* EmComm Stations Panel (APRS) */}
          <PanelSection title="EmComm Stations" count={emcommStationsWithDistance.length} color="#22d3ee">
            {emcommStationsWithDistance.length === 0 ? (
              <EmptyState text="No emergency APRS stations heard" />
            ) : (
              emcommStationsWithDistance.map((s) => {
                const ageStr = s.age < 1 ? 'now' : s.age < 60 ? `${s.age}m ago` : `${Math.floor(s.age / 60)}h ago`;
                return (
                  <div
                    key={s.call}
                    style={{
                      padding: '4px 8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '11px',
                      marginBottom: '2px',
                    }}
                  >
                    <div>
                      <span style={{ color: '#22d3ee', fontWeight: 600 }}>{s.ssid || s.call}</span>
                      <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>
                        {SYMBOL_LABELS[s.symbol] || 'EmComm'}
                      </span>
                    </div>
                    <div style={{ color: '#888', fontSize: '10px', textAlign: 'right' }}>
                      {s.distance != null && (
                        <span>{formatDistance(s.distance, config.allUnits?.dist || 'imperial')} </span>
                      )}
                      <span>{ageStr}</span>
                    </div>
                  </div>
                );
              })
            )}
          </PanelSection>
        </div>
      </div>
    </div>
  );
}

/** Collapsible panel section wrapper */
function PanelSection({ title, count, color, children }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ background: '#0d0d0d', borderRadius: '6px', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid #222',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#888', fontSize: '10px' }}>{collapsed ? '▶' : '▼'}</span>
          <span
            style={{
              color: color || '#ccc',
              fontWeight: 600,
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {title}
          </span>
        </div>
        {count > 0 && (
          <span
            style={{
              background: color || '#888',
              color: '#000',
              fontSize: '10px',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '8px',
              minWidth: '18px',
              textAlign: 'center',
            }}
          >
            {count}
          </span>
        )}
      </div>
      {!collapsed && <div style={{ padding: '4px 2px', maxHeight: '250px', overflowY: 'auto' }}>{children}</div>}
    </div>
  );
}

/** Capacity bar for shelters */
function CapacityBar({ current, max }) {
  if (!max || max <= 0) return null;
  const pct = Math.min(100, Math.round(((current || 0) / max) * 100));
  const color = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div
        style={{
          width: '40px',
          height: '6px',
          background: '#333',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px' }} />
      </div>
      <span style={{ color: '#888', fontSize: '9px' }}>
        {current || 0}/{max}
      </span>
    </div>
  );
}

/** Empty state placeholder */
function EmptyState({ text }) {
  return (
    <div style={{ padding: '12px 8px', color: '#555', fontSize: '11px', textAlign: 'center', fontStyle: 'italic' }}>
      {text}
    </div>
  );
}
