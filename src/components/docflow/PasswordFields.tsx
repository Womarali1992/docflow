import React from 'react';
import { PASSWORD_MIN } from '@/utils/passwords';

/** New password + confirmation, with the policy stated where the user types. */
export const NewPasswordFields: React.FC<{
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
}> = ({ password, confirm, onPassword, onConfirm, disabled, autoFocus, label = 'New password' }) => {
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="df-muted" style={{ fontSize: 11.5 }}>{label} · at least {PASSWORD_MIN} characters</span>
        <input
          className="df-input"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          required
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="df-muted" style={{ fontSize: 11.5 }}>Repeat it</span>
        <input
          className="df-input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          disabled={disabled}
          required
          aria-invalid={mismatch || undefined}
        />
        {mismatch && <span className="df-danger" style={{ fontSize: 11.5 }}>The two passwords differ.</span>}
      </label>
    </>
  );
};
