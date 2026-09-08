import React, { Suspense, useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import PageLoading from './PageLoading';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import TweaksBar from './TweaksBar';
import ErrorBoundary from './ErrorBoundary';
import ConnectionBanner from './ConnectionBanner';
import './styles.css';

const DocFlowLayout: React.FC = () => {
  const [theme, setTheme] = useState<'sand' | 'graphite' | 'forest'>('sand');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Auto-close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const rootClass = [
    'df-root',
    `df-theme-${theme}`,
    density === 'compact' ? 'df-density-compact' : '',
    drawerOpen ? 'df-drawer-open' : '',
  ].filter(Boolean).join(' ');

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
      <TweaksBar theme={theme} setTheme={setTheme} density={density} setDensity={setDensity} />
    </div>
  );
};

export default DocFlowLayout;
