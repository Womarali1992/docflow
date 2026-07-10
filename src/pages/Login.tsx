import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/utils/errors';
import { I } from '@/components/docflow/icons';
import '@/components/docflow/styles.css';

const DEV = import.meta.env.DEV;
const DEV_CREDS = {
  provider: { email: 'sarah@meridiancpa.com', password: 'password123' },
  client: { email: 'sarah.johnson@meridian.co', password: 'client123' },
};

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [kind, setKind] = useState<'provider' | 'client'>('provider');
  const [email, setEmail] = useState(DEV ? DEV_CREDS.provider.email : '');
  const [password, setPassword] = useState(DEV ? DEV_CREDS.provider.password : '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setKindAndDefaults = (k: 'provider' | 'client') => {
    setKind(k);
    setError(null);
    if (DEV) {
      setEmail(DEV_CREDS[k].email);
      setPassword(DEV_CREDS[k].password);
    } else {
      setEmail('');
      setPassword('');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const me = await login(email, password, kind);
      const redirect = (location.state as { from?: string } | null)?.from;
      if (redirect) {
        navigate(redirect, { replace: true });
      } else if (me.kind === 'provider') {
        navigate('/', { replace: true });
      } else {
        navigate(`/client/${me.id}`, { replace: true });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="df-root df-theme-sand" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div className="df-section" style={{ width: 400, maxWidth: '92vw', margin: 0 }}>
        <div className="df-section-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="df-brand-mark">D</div>
            <div>
              <div className="df-brand-name" style={{ fontSize: 16 }}>DocFlow</div>
              <div className="df-brand-sub">Sign in to continue</div>
            </div>
          </div>
        </div>
        <div className="df-section-body">
          <div className="df-seg" style={{ display: 'flex', marginBottom: 14 }}>
            <button
              className={kind === 'provider' ? 'df-active' : ''}
              onClick={() => setKindAndDefaults('provider')}
              style={{ flex: 1 }}
              type="button"
            >
              Advisor
            </button>
            <button
              className={kind === 'client' ? 'df-active' : ''}
              onClick={() => setKindAndDefaults('client')}
              style={{ flex: 1 }}
              type="button"
            >
              Client
            </button>
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="df-muted" style={{ fontSize: 11.5 }}>Email</span>
              <input
                className="df-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="df-muted" style={{ fontSize: 11.5 }}>Password</span>
              <input
                className="df-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            {error && (
              <div
                className="df-pill df-danger"
                style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: 11.5 }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              className="df-btn df-primary"
              style={{ justifyContent: 'center', marginTop: 4 }}
              disabled={loading}
            >
              {loading ? 'Signing in…' : (
                <>
                  <I.Send size={13} /> Sign in as {kind === 'provider' ? 'advisor' : 'client'}
                </>
              )}
            </button>

            {DEV && (
              <div className="df-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Demo accounts pre-filled (dev only). Seeded credentials:{' '}
                {kind === 'provider' ? (
                  <>provider <span className="df-mono">sarah@meridiancpa.com / password123</span></>
                ) : (
                  <>client <span className="df-mono">sarah.johnson@meridian.co / client123</span></>
                )}.
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
