import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { stagePath } from '@/utils/stage';

interface Props {
  kind: 'provider' | 'client';
  children: React.ReactNode;
}

/**
 * Gates the app screens: no session → /login; a session that still owes its
 * second factor → /mfa or /mfa/enroll; the wrong kind of user → their own home.
 */
export const RouteGuard: React.FC<Props> = ({ kind, children }) => {
  const { me, stage, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="df-root" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="df-muted" style={{ fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  if (!me) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  const owed = stagePath(stage);
  if (owed) {
    return <Navigate to={owed} state={{ from: location.pathname + location.search }} replace />;
  }

  if (me.kind !== kind) {
    // Redirect to their natural home
    return <Navigate to={me.kind === 'provider' ? '/' : `/client/${me.id}`} replace />;
  }

  return <>{children}</>;
};

/**
 * Gates the /mfa screens themselves: they need a session, and each screen only
 * serves its own stage (an active session goes home, a pre-auth one cannot
 * enroll, an unenrolled one cannot verify).
 */
export const MfaGate: React.FC<{ stage: 'preauth' | 'mfa_enroll'; children: React.ReactNode }> = ({ stage: wanted, children }) => {
  const { me, stage, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!me || !stage) return <Navigate to="/login" replace />;
  if (stage === 'active') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from || (me.kind === 'provider' ? '/' : `/client/${me.id}`)} replace />;
  }
  if (stage !== wanted) return <Navigate to={stagePath(stage)!} state={location.state} replace />;
  return <>{children}</>;
};
