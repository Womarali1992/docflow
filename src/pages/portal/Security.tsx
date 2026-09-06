import React from 'react';
import { useAuth } from '@/context/AuthContext';
import SecurityCard from '@/components/docflow/SecurityCard';

/**
 * The client's own security page: two-step verification, recovery codes,
 * password, and where they are signed in.
 *
 * The same card the advisor gets — a client's account holds their tax
 * documents, so it is protected the same way, and they can see and end their
 * own sessions without asking anyone.
 */
const PortalSecurity: React.FC = () => {
  const { me } = useAuth();

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Security</h1>
          <div className="df-client-meta">
            <span>{me?.email}</span>
          </div>
        </div>
      </div>

      <SecurityCard id="security" />
    </div>
  );
};

export default PortalSecurity;
