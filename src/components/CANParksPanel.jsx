/**
 * CANParksPanel Component
 * Displays CANParks (canparks.ca — Canadian parks program) activations with
 * ON/OFF toggle. The program is young and often quiet, so the empty state
 * explains that spots appear when someone activates rather than looking
 * broken. Spots cross-listed with POTA show a muted "POTA CA-xxxx" chip
 * (rendered by ActivatePanel from spot.potaRef).
 */
import { useTranslation } from 'react-i18next';
import ActivatePanel from './ActivatePanel.jsx';

const _icon = () =>
  L.divIcon({
    className: '',
    html: `<span style="display:inline-block;width:12px;height:12px;background:#ff6b6b;border:1px solid rgba(0,0,0,0.4);border-radius:50%;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
export const mapDefs = {
  name: 'CANParks',
  get icon() {
    return _icon();
  },
  shape: '●',
  color: '#ff6b6b',
};
export const CANParksPanel = ({
  data,
  loading,
  lastUpdated,
  lastChecked,
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
  const { t } = useTranslation();
  return (
    <ActivatePanel
      mapDefs={mapDefs}
      data={data}
      loading={loading}
      lastUpdated={lastUpdated}
      lastChecked={lastChecked}
      showOnMap={showOnMap}
      onToggleMap={onToggleMap}
      showLabelsOnMap={showLabelsOnMap}
      onToggleLabelsOnMap={onToggleLabelsOnMap}
      onSpotClick={onSpotClick}
      onHoverSpot={onHoverSpot}
      filters={filters}
      onOpenFilters={onOpenFilters}
      filteredData={filteredData}
      emptyText={t('canparks.empty', {
        defaultValue: 'No CANParks activity right now — spots appear here when someone activates a Canadian park.',
      })}
    />
  );
};

export default CANParksPanel;
