import React, { Suspense, useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import PageLoading from './PageLoading';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import ErrorBoundary from './ErrorBoundary';
import ConnectionBanner from './ConnectionBanner';
import './styles.css';

const DocFlowLayout: React.FC = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Auto-close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  /* One look. The floating theme/density picker this used to carry was a
     design-review tool that shipped to every screen (2026-10-28 audit). */
  const rootClass = ['df-root', 'df-theme-sand', drawerOpen ? 'df-drawer-open' : ''].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      <div className="df-app">
        <Sidebar />
        <div className="df-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
        <main className="df-main">
          <Topbar onMenuClick={() => setDrawerOpen(true)} />
          <ConnectionBanner />
          {/* Scoped to the screen: a failed page leaves the nav usable. */}
          <ErrorBoundary key={location.pathname} where="this screen">
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
};

export default DocFlowLayout;
