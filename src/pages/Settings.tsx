import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { I } from '@/components/docflow/icons';
import SecurityCard from '@/components/docflow/SecurityCard';

/**
 * Account settings: who you are signed in as, and the security card (two-step
 * verification, recovery codes, password, live sessions).
 *
 * The request presets that used to live here became real checklists in C3.2 —
 * they are edited under Templates, where they can carry instructions, an
 * optional flag and a due offset that a drag-into-a-bin list never could.
 */
const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { me } = useAuth();
  const isProvider = me?.kind === 'provider';

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Settings</h1>
          <div className="df-client-meta">
            <span>Your account</span>
            <span className="df-dot-sep" />
            <span>Security and sessions</span>
          </div>
        </div>
      </div>

      <div className="df-section">
        <div className="df-section-head">
          <div>
            <div className="df-section-title">Account</div>
            <div className="df-section-sub">How you appear to your clients</div>
          </div>
        </div>
        <div className="df-section-body">
          <div className="df-dl">
            <div className="df-row" style={{ gridTemplateColumns: '180px 1fr' }}>
              <span className="df-field-label">Name</span>
              <span>{me?.name ?? '—'}</span>
            </div>
            <div className="df-row" style={{ gridTemplateColumns: '180px 1fr' }}>
              <span className="df-field-label">Email</span>
              <span>{me?.email ?? '—'}</span>
            </div>
            {me?.kind === 'provider' && (
              <div className="df-row" style={{ gridTemplateColumns: '180px 1fr' }}>
                <span className="df-field-label">Firm</span>
                <span>{me.firmName || '—'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <SecurityCard id="security" />

      {isProvider && (
        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">Checklists</div>
              <div className="df-section-sub">The lists an engagement is built from</div>
            </div>
            <div className="df-right">
              <button className="df-btn df-sm" onClick={() => navigate('/templates')}>
                <I.Folder size={12} /> Open Templates
              </button>
            </div>
          </div>
          <div className="df-section-body">
            <div className="df-small df-muted">
              Document request presets moved to Templates, where each line can carry instructions the client reads, an
              optional flag and a default due date.
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Settings;
