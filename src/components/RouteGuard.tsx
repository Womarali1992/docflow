import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

interface Props {
  kind: 'provider' | 'client';
  children: React.ReactNode;
}

export const RouteGuard: React.FC<Props> = ({ kind, children }) => {
  const { me, loading } = useAuth();
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

  if (me.kind !== kind) {
    // Redirect to their natural home
    return <Navigate to={me.kind === 'provider' ? '/' : `/client/${me.id}`} replace />;
  }

  return <>{children}</>;
};
