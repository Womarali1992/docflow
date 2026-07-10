import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  return (
    <div className="df-page" style={{ minHeight: 'calc(100vh - 52px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="df-section" style={{ width: 480, maxWidth: '90vw', margin: 0 }}>
        <div className="df-section-body" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div className="df-muted" style={{ fontSize: 12, fontWeight: 500, marginBottom: 12 }}>
            Error 404
          </div>
          <h1 className="df-client-name" style={{ marginBottom: 8 }}>Page not found</h1>
          <p className="df-muted" style={{ fontSize: 13, marginBottom: 20 }}>
            <span className="df-mono">{location.pathname}</span> doesn't exist or has been moved.
          </p>
          <Link className="df-btn df-primary" to="/" style={{ display: 'inline-flex' }}>
            Return to overview
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
