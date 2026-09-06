import React from 'react';
import { useAuth } from '@/context/AuthContext';
import MessagesPanel from '@/components/docflow/MessagesPanel';

/**
 * The client's thread with their accountant.
 *
 * Questions asked from a checklist card land on that document's own thread;
 * this is the general one, for everything that is not about a single file.
 */
const PortalMessages: React.FC = () => {
  const { me } = useAuth();
  const advisorName = me?.kind === 'client' ? me.providerName : null;

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Messages</h1>
          <div className="df-client-meta">
            <span>Private between you and {advisorName || 'your accountant'}</span>
          </div>
        </div>
      </div>

      <div className="df-section">
        <div className="df-section-body">
          <MessagesPanel meKind="client" title="Your thread" subtitle={advisorName || 'Your accountant'} />
        </div>
      </div>
    </div>
  );
};

export default PortalMessages;
