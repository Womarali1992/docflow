import React, { Suspense, useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import PageLoading from './PageLoading';
import ClientSidebar from './ClientSidebar';
import ClientTopbar from './ClientTopbar';
import ErrorBoundary from './ErrorBoundary';
import ConnectionBanner from './ConnectionBanner';
import './styles.css';

const ClientLayout: React.FC = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  /* One look. The floating theme/density picker this used to carry was a
     design-review tool that shipped to every screen (2026-10-28 audit). */
  /* `df-portal` lets the stylesheet colour things from the client's side (see "Line colours"). */
  const rootClass = ['df-root', 'df-theme-sand', 'df-portal', drawerOpen ? 'df-drawer-open' : ''].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      <div className="df-app">
        <ClientSidebar />
        <div className="df-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
        <main className="df-main">
          <ClientTopbar onMenuClick={() => setDrawerOpen(true)} />
          <ConnectionBanner />
          <ErrorBoundary key={location.pathname} where="your portal">
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
};

export default ClientLayout;
