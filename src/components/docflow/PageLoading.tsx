import React from 'react';

/**
 * What fills the screen area while a route's code is fetched (H4).
 *
 * The nav, the topbar and the connection banner are already on screen — this
 * sits inside them, so the page does not blink back to nothing between routes.
 * The wording matches `RouteGuard`'s: on a slow connection the two waits look
 * like one wait, which is what they are to the person watching.
 */
const PageLoading: React.FC = () => (
  <div style={{ display: 'grid', placeItems: 'center', padding: '48px 0' }}>
    <div className="df-muted" style={{ fontSize: 13 }}>Loading…</div>
  </div>
);

export default PageLoading;
