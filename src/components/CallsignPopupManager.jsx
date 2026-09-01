/**
 * CallsignPopupManager — singleton context provider for callsign popups.
 *
 * Renders a <CallsignPopup> whenever a callsign is requested. Provides
 * a hook (useCallsignPopup) so any component can request/show a popup.
 *
 * Usage in any component:
 *   const { showPopup } = useCallsignPopup();
 *   <CallsignLink call={spot.call} onClick={(e) =>
 *     showPopup(spot.call, e.currentTarget)
 *   } />
 */
import { createContext, useContext, useState, useCallback, useRef } from 'react';
import CallsignPopup from './CallsignPopup.jsx';
import { POPUP_HEIGHT_ESTIMATE } from '../hooks/app/usePopupPosition.js';

const CallsignPopupContext = createContext(null);

// deLocation — optional { lat, lon } of the user's DE location, forwarded to
// the popup so it can warm the nearby web-SDR receiver directory.
export function CallsignPopupProvider({ children, deLocation }) {
  const [popupState, setPopupState] = useState({ open: false, call: null, anchorEl: null, location: null, spot: null });
  const popupHeightRef = useRef(POPUP_HEIGHT_ESTIMATE); // initial estimate, updated by popup after render

  // spot — optional { freq, mode } (freq in kHz) from surfaces that have spot
  // context in hand; enables the popup's 🎧 listen action.
  const showPopup = useCallback((call, anchorEl, location, spot) => {
    setPopupState({ open: true, call, anchorEl, location, spot: spot ?? null });
  }, []);

  const hidePopup = useCallback(() => {
    setPopupState({ open: false, call: null, anchorEl: null, location: null, spot: null });
  }, []);

  return (
    <CallsignPopupContext.Provider value={{ showPopup, hidePopup }}>
      {children}
      {popupState.open && popupState.call && (
        <div aria-live="polite">
          <CallsignPopup
            anchorRef={popupState.anchorEl}
            call={popupState.call}
            location={popupState.location}
            spot={popupState.spot}
            deLocation={deLocation}
            onClose={hidePopup}
            popupHeightRef={popupHeightRef}
          />
        </div>
      )}
    </CallsignPopupContext.Provider>
  );
}

export function useCallsignPopup() {
  const ctx = useContext(CallsignPopupContext);
  if (!ctx) {
    throw new Error('useCallsignPopup must be used within a CallsignPopupProvider');
  }
  return ctx;
}

export default CallsignPopupProvider;
