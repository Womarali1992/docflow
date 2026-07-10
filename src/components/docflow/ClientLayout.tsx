import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import ClientSidebar from './ClientSidebar';
import ClientTopbar from './ClientTopbar';
import TweaksBar from './TweaksBar';
import './styles.css';

const ClientLayout: React.FC = () => {
  const [theme, setTheme] = useState<'sand' | 'graphite' | 'forest'>('sand');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

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
        <ClientSidebar />
        <div className="df-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
        <main className="df-main">
          <ClientTopbar onMenuClick={() => setDrawerOpen(true)} />
          <Outlet />
        </main>
      </div>
      <TweaksBar theme={theme} setTheme={setTheme} density={density} setDensity={setDensity} />
    </div>
  );
};

export default ClientLayout;
