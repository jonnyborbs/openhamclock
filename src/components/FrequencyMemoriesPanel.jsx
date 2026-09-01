/**
 * FrequencyMemoriesPanel — user-defined named channels (dockable panel
 * `freq-memories`).
 *
 * Each memory is { id, label, freq_mhz, mode?, notes? }, persisted in
 * localStorage (openhamclock_freqMemories — synced/profiled/backed up like
 * other user state). Rows show label, frequency, mode, and a band chip;
 * clicking a row tunes the rig via RigContext.tuneTo (same path spot rows
 * use). Add/edit form validates the frequency and can grab freq+mode from a
 * connected rig. Reordering is simple up/down buttons.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRig } from '../contexts/RigContext.jsx';
import { getBandFromFreq } from '../utils/callsign.js';
import { getReadableBandColorForFreq } from '../utils/bandColors.js';
import {
  loadFreqMemories,
  saveFreqMemories,
  makeMemory,
  moveMemory,
  parseFreqMHz,
  formatMemoryFreq,
} from '../utils/freqMemories.js';

const MODE_OPTIONS = ['SSB', 'USB', 'LSB', 'CW', 'AM', 'FM', 'FT8', 'FT4', 'RTTY', 'PSK', 'DATA'];

const inputStyle = {
  padding: '4px 6px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
  minWidth: 0,
  width: '100%',
};

const iconBtnStyle = (disabled = false) => ({
  background: 'transparent',
  border: 'none',
  color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.35 : 0.8,
  padding: '1px 3px',
  fontSize: '10px',
  lineHeight: 1,
});

const blankForm = () => ({ label: '', freq_mhz: '', mode: '', notes: '' });

export const FrequencyMemoriesPanel = () => {
  const { t } = useTranslation();

  // Rig state is optional — resilient outside RigProvider (tests, storybooks).
  let rig = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    rig = useRig();
  } catch {
    rig = null;
  }
  const canTune = !!rig?.enabled;
  const rigFreqMHz = rig?.connected && rig.freq > 0 ? rig.freq / 1e6 : null;

  const [memories, setMemories] = useState(loadFreqMemories);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = adding
  const [form, setForm] = useState(blankForm);
  const [freqError, setFreqError] = useState(false);

  const persist = (next) => {
    setMemories(next);
    saveFreqMemories(next);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(blankForm());
    setFreqError(false);
    setShowForm(true);
  };

  const openEdit = (m) => {
    setEditingId(m.id);
    setForm({ label: m.label, freq_mhz: String(m.freq_mhz), mode: m.mode || '', notes: m.notes || '' });
    setFreqError(false);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(blankForm());
    setFreqError(false);
  };

  const handleSave = (e) => {
    e.preventDefault();
    const built = makeMemory(form);
    if (!built) {
      setFreqError(true);
      return;
    }
    if (editingId) {
      persist(memories.map((m) => (m.id === editingId ? { ...built, id: editingId } : m)));
    } else {
      persist([...memories, built]);
    }
    closeForm();
  };

  const handleDelete = (id) => persist(memories.filter((m) => m.id !== id));
  const handleMove = (id, delta) => persist(moveMemory(memories, id, delta));

  const handleGrabFromRig = () => {
    if (rigFreqMHz == null) return;
    setForm((f) => ({
      ...f,
      freq_mhz: formatMemoryFreq(rigFreqMHz),
      mode: rig?.mode ? String(rig.mode).toUpperCase() : f.mode,
    }));
    setFreqError(false);
  };

  const handleRowTune = (m) => {
    if (!canTune) return;
    rig.tuneTo(m.freq_mhz, m.mode || null);
  };

  const formValid = form.label.trim() !== '' && parseFreqMHz(form.freq_mhz) != null;

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--accent-primary)',
          fontWeight: '700',
        }}
      >
        <span>📻 {t('freqMemories.title', { defaultValue: 'FREQUENCIES' })}</span>
        <button
          onClick={showForm ? closeForm : openAdd}
          title={
            showForm
              ? t('freqMemories.cancel', { defaultValue: 'Cancel' })
              : t('freqMemories.add', { defaultValue: 'Add frequency' })
          }
          style={{
            background: 'transparent',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '10px',
            padding: '1px 7px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {showForm ? '✕' : '+'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSave}
          style={{
            marginBottom: '6px',
            padding: '6px',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            fontSize: '10px',
          }}
        >
          <input
            style={inputStyle}
            value={form.label}
            maxLength={40}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder={t('freqMemories.labelPlaceholder', { defaultValue: 'Name (e.g. 40m club net)' })}
            aria-label={t('freqMemories.labelPlaceholder', { defaultValue: 'Name (e.g. 40m club net)' })}
            autoFocus
          />
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              style={{
                ...inputStyle,
                flex: 1,
                borderColor: freqError ? 'var(--accent-red, #f44)' : 'var(--border-color)',
              }}
              value={form.freq_mhz}
              inputMode="decimal"
              onChange={(e) => {
                setForm((f) => ({ ...f, freq_mhz: e.target.value }));
                setFreqError(false);
              }}
              placeholder={t('freqMemories.freqPlaceholder', { defaultValue: 'MHz (e.g. 7.200)' })}
              aria-label={t('freqMemories.freqPlaceholder', { defaultValue: 'MHz (e.g. 7.200)' })}
              aria-invalid={freqError}
            />
            <select
              style={{ ...inputStyle, flex: '0 0 70px', width: 'auto' }}
              value={form.mode}
              onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
              aria-label={t('freqMemories.modeLabel', { defaultValue: 'Mode' })}
            >
              <option value="">{t('freqMemories.modeAny', { defaultValue: '(mode)' })}</option>
              {MODE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <input
            style={inputStyle}
            value={form.notes}
            maxLength={120}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder={t('freqMemories.notesPlaceholder', { defaultValue: 'Notes (optional)' })}
            aria-label={t('freqMemories.notesPlaceholder', { defaultValue: 'Notes (optional)' })}
          />
          {freqError && (
            <div style={{ color: 'var(--accent-red, #f44)', fontSize: '9px' }}>
              {t('freqMemories.invalidFreq', { defaultValue: 'Enter a name and a valid frequency in MHz' })}
            </div>
          )}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button
              type="submit"
              disabled={!formValid}
              style={{
                background: formValid ? 'rgba(0, 255, 136, 0.15)' : 'rgba(100,100,100,0.3)',
                border: `1px solid ${formValid ? 'var(--accent-green)' : '#666'}`,
                color: formValid ? 'var(--accent-green)' : '#888',
                padding: '2px 10px',
                borderRadius: '4px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                cursor: formValid ? 'pointer' : 'default',
              }}
            >
              {t('freqMemories.save', { defaultValue: 'Save' })}
            </button>
            {rigFreqMHz != null && (
              <button
                type="button"
                onClick={handleGrabFromRig}
                title={t('freqMemories.grabFromRigTooltip', {
                  defaultValue: 'Fill frequency and mode from the connected rig',
                })}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--accent-cyan)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                }}
              >
                {t('freqMemories.grabFromRig', { defaultValue: '⇊ From rig' })}
              </button>
            )}
          </div>
        </form>
      )}

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {memories.length === 0 && !showForm ? (
          <div style={{ color: 'var(--text-muted)', padding: '10px 4px', lineHeight: 1.5 }}>
            {t('freqMemories.empty', {
              defaultValue:
                'No saved frequencies yet. Add your favorite calling frequencies, nets, and repeaters with the + button — with rig control enabled, clicking a row tunes the radio.',
            })}
          </div>
        ) : (
          memories.map((m, idx) => {
            const band = getBandFromFreq(m.freq_mhz);
            const bandColor = getReadableBandColorForFreq(m.freq_mhz);
            return (
              <div
                key={m.id}
                onClick={() => handleRowTune(m)}
                title={
                  canTune
                    ? t('freqMemories.tuneTooltip', {
                        defaultValue: 'Tune rig to {{freq}} MHz',
                        freq: formatMemoryFreq(m.freq_mhz),
                      })
                    : m.notes || undefined
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 5px',
                  marginBottom: '2px',
                  borderRadius: '4px',
                  background: 'rgba(255,255,255,0.03)',
                  cursor: canTune ? 'pointer' : 'default',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: '600',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {m.label}
                  </div>
                  {m.notes && (
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: '9px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {m.notes}
                    </div>
                  )}
                </div>
                <span style={{ color: 'var(--accent-amber)', fontWeight: '600', whiteSpace: 'nowrap' }}>
                  {formatMemoryFreq(m.freq_mhz)}
                </span>
                {m.mode && <span style={{ color: 'var(--text-secondary)', fontSize: '9px' }}>{m.mode}</span>}
                {band !== 'other' && (
                  <span
                    style={{
                      color: bandColor,
                      border: `1px solid ${bandColor}`,
                      borderRadius: '3px',
                      padding: '0px 4px',
                      fontSize: '8px',
                      fontWeight: '700',
                      flexShrink: 0,
                    }}
                  >
                    {band}
                  </span>
                )}
                <span style={{ display: 'flex', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                  <button
                    style={iconBtnStyle(idx === 0)}
                    disabled={idx === 0}
                    onClick={() => handleMove(m.id, -1)}
                    title={t('freqMemories.moveUp', { defaultValue: 'Move up' })}
                    aria-label={t('freqMemories.moveUp', { defaultValue: 'Move up' })}
                  >
                    ▲
                  </button>
                  <button
                    style={iconBtnStyle(idx === memories.length - 1)}
                    disabled={idx === memories.length - 1}
                    onClick={() => handleMove(m.id, 1)}
                    title={t('freqMemories.moveDown', { defaultValue: 'Move down' })}
                    aria-label={t('freqMemories.moveDown', { defaultValue: 'Move down' })}
                  >
                    ▼
                  </button>
                  <button
                    style={iconBtnStyle()}
                    onClick={() => openEdit(m)}
                    title={t('freqMemories.edit', { defaultValue: 'Edit' })}
                    aria-label={t('freqMemories.edit', { defaultValue: 'Edit' })}
                  >
                    ✎
                  </button>
                  <button
                    style={iconBtnStyle()}
                    onClick={() => handleDelete(m.id)}
                    title={t('freqMemories.delete', { defaultValue: 'Delete' })}
                    aria-label={t('freqMemories.delete', { defaultValue: 'Delete' })}
                  >
                    ✕
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default FrequencyMemoriesPanel;
