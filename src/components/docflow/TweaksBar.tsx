import React, { useState } from 'react';
import { I } from './icons';

interface Props {
  theme: 'sand' | 'graphite' | 'forest';
  setTheme: (v: 'sand' | 'graphite' | 'forest') => void;
  density: 'comfortable' | 'compact';
  setDensity: (v: 'comfortable' | 'compact') => void;
}

const TweaksBar: React.FC<Props> = ({ theme, setTheme, density, setDensity }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 50 }}>
      {open && (
        <div
          style={{
            marginBottom: 8,
            background: 'var(--df-panel)',
            border: '1px solid var(--df-border)',
            borderRadius: 'var(--df-radius)',
            boxShadow: 'var(--df-shadow-pop)',
            padding: 12,
            minWidth: 220,
            fontSize: 12.5,
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--df-ink-3)',
              marginBottom: 6,
            }}
          >
            Theme
          </div>
          <div className="df-seg" style={{ display: 'flex', marginBottom: 10 }}>
            {(['sand', 'graphite', 'forest'] as const).map(v => (
              <button
                key={v}
                className={theme === v ? 'df-active' : ''}
                onClick={() => setTheme(v)}
                style={{ textTransform: 'capitalize', flex: 1 }}
              >
                {v}
              </button>
            ))}
          </div>
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--df-ink-3)',
              marginBottom: 6,
            }}
          >
            Density
          </div>
          <div className="df-seg" style={{ display: 'flex' }}>
            {(['comfortable', 'compact'] as const).map(v => (
              <button
                key={v}
                className={density === v ? 'df-active' : ''}
                onClick={() => setDensity(v)}
                style={{ textTransform: 'capitalize', flex: 1 }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className="df-btn" style={{ boxShadow: 'var(--df-shadow-pop)' }} onClick={() => setOpen(o => !o)}>
        <I.Settings size={13} /> Tweaks
      </button>
    </div>
  );
};

export default TweaksBar;
