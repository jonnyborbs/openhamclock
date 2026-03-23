/**
 * WWBOTAPanel Component
 * Displays World Wide BOTA (Bunker On The Air) activations with ON/OFF toggle
 */
import ActivatePanel from './ActivatePanel.jsx';

const _icon = () =>
  L.divIcon({
    className: '',
    html: `<span style="display:inline-block;width:12px;height:12px;background:#8b7fff;border:1px solid rgba(0,0,0,0.4);border-radius:2px;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
export const mapDefs = {
  name: 'WWBOTA',
  get icon() {
    return _icon();
  },
  shape: '■',
  color: '#8b7fff',
};
export const WWBOTAPanel = ({
  data,
  loading,
  lastUpdated,
  connected,
  showOnMap,
  onToggleMap,
  showLabelsOnMap = true,
  onToggleLabelsOnMap,
  onSpotClick,
  onHoverSpot,
  filters,
  onOpenFilters,
  filteredData,
}) => {
  return (
    <ActivatePanel
      mapDefs={mapDefs}
      data={data}
      loading={loading}
      lastUpdated={lastUpdated}
      connected={connected}
      showOnMap={showOnMap}
      onToggleMap={onToggleMap}
      showLabelsOnMap={showLabelsOnMap}
      onToggleLabelsOnMap={onToggleLabelsOnMap}
      onSpotClick={onSpotClick}
      onHoverSpot={onHoverSpot}
      filters={filters}
      onOpenFilters={onOpenFilters}
      filteredData={filteredData}
    />
  );
};

export default WWBOTAPanel;
