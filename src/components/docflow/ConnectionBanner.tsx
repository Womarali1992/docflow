import React, { useEffect, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { I } from './icons';

/**
 * "You are offline."
 *
 * The one state a document portal must never fake. A client on a train who
 * taps Upload and sees nothing happen will assume it worked; React Query's
 * `onlineManager` already knows the browser lost the network, so the app says
 * so plainly and says what it will do about it — queries resume by themselves
 * when the connection is back, and an upload has to be started again because
 * its bytes were mid-flight.
 */
const ConnectionBanner: React.FC = () => {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => onlineManager.subscribe((isOnline) => {
    setOnline(isOnline);
    if (!isOnline) setWasOffline(true);
  }), []);

  // Once back, say so briefly rather than leaving a "reconnected" bar forever.
  useEffect(() => {
    if (!online || !wasOffline) return;
    const t = setTimeout(() => setWasOffline(false), 4000);
    return () => clearTimeout(t);
  }, [online, wasOffline]);

  if (online && !wasOffline) return null;

  return (
    <div className={'df-connection' + (online ? ' df-connection-back' : '')} role="status" aria-live="polite">
      {online ? (
        <>
          <I.Check size={13} /> Back online — everything is up to date again.
        </>
      ) : (
        <>
          <I.Refresh size={13} /> You are offline. Nothing is lost; the app catches up on its own when the
          connection returns. An upload in progress will need starting again.
        </>
      )}
    </div>
  );
};

export default ConnectionBanner;
