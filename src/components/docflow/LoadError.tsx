import React from 'react';
import { I } from './icons';

/**
 * A read that did not come back.
 *
 * Distinct from the error boundary: nothing crashed, the server just did not
 * answer this one question — so the rest of the screen still works and the only
 * thing on offer is to ask again. The error text is deliberately not shown; it
 * is in the console for whoever is debugging, and "Not found" on a client's
 * screen tells them nothing they can act on.
 */
const LoadError: React.FC<{ what: string; onRetry?: () => void }> = ({ what, onRetry }) => (
  <div className="df-empty">
    <div>Could not load {what}.</div>
    <div className="df-small df-muted" style={{ marginTop: 4 }}>
      This is usually the connection. Nothing has been changed.
    </div>
    {onRetry && (
      <button className="df-btn df-sm" style={{ marginTop: 12 }} onClick={onRetry}>
        <I.Refresh size={12} /> Try again
      </button>
    )}
  </div>
);

export default LoadError;
