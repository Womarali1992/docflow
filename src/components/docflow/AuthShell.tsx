import React from 'react';
import { I } from './icons';
import './styles.css';

/**
 * The card every sign-in step lives in (login, code, enrollment): the sand
 * theme, the brand mark, a one-line subtitle, and the caller's body.
 */
const AuthShell: React.FC<{ subtitle: string; width?: number; children: React.ReactNode }> = ({ subtitle, width = 400, children }) => (
  <div className="df-root df-theme-sand" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
    <div className="df-section" style={{ width, maxWidth: '92vw', margin: 0 }}>
      <div className="df-section-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="df-brand-mark">D</div>
          <div>
            <div className="df-brand-name" style={{ fontSize: 16 }}>DocFlow</div>
            <div className="df-brand-sub">{subtitle}</div>
          </div>
        </div>
      </div>
      <div className="df-section-body">{children}</div>
    </div>
  </div>
);

export default AuthShell;

/** A six-digit authenticator code field: numeric keyboard on phones, one-time-code autofill, digits only. */
export const CodeInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}> = ({ value, onChange, label = 'Authenticator code', autoFocus, disabled }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span className="df-muted" style={{ fontSize: 11.5 }}>{label}</span>
    <input
      className="df-input df-mono"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]*"
      maxLength={7}
      placeholder="123 456"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ''))}
      autoFocus={autoFocus}
      disabled={disabled}
      required
      style={{ fontSize: 18, letterSpacing: 4, textAlign: 'center' }}
    />
  </label>
);

/** The recovery codes, shown once, with a copy button. */
export const RecoveryCodeList: React.FC<{ codes: string[] }> = ({ codes }) => {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div>
      <div
        className="df-mono"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 18px',
          padding: '10px 12px',
          border: '1px solid var(--df-border)',
          borderRadius: 8,
          background: 'var(--df-bg)',
          fontSize: 13,
          userSelect: 'all',
        }}
      >
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="df-btn df-sm" onClick={copy}>
          {copied ? <><I.Check size={12} /> Copied</> : 'Copy codes'}
        </button>
      </div>
    </div>
  );
};

export const ErrorPill: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div className="df-pill df-danger" role="alert" style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: 11.5 }}>
      {message}
    </div>
  ) : null;
