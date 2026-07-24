import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Bell, Settings, User, LayoutDashboard, Menu, X } from 'lucide-react';
import { UserRole } from '@/types/dashboard';
import { useNavigate } from 'react-router-dom';

interface DashboardHeaderProps {
  userRole: UserRole;
  onRoleSwitch: () => void;
}

const navItemClass =
  'text-blue-700 hover:text-blue-800 hover:bg-blue-50 rounded-lg';

const DashboardHeader = ({ userRole, onRoleSwitch }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const isAdvisor = userRole === 'advisor';

  const Logo = ({ size }: { size: 'sm' | 'lg' }) => {
    const isLarge = size === 'lg';
    return (
      <div className="flex items-center space-x-3">
        <div
          className={`bg-blue-600 rounded-lg flex items-center justify-center shadow-sm ${
            isLarge ? 'w-10 h-10' : 'w-9 h-9'
          }`}
        >
          <FileText className={isLarge ? 'h-5 w-5 text-white' : 'h-4 w-4 text-white'} />
        </div>
        <div>
          <h1
            className={`font-semibold text-blue-900 leading-tight ${
              isLarge ? 'text-xl' : 'text-base'
            }`}
          >
            Sarah Johnson C.P.A.
          </h1>
          <p className="text-xs text-gray-500">Professional Client Management</p>
        </div>
      </div>
    );
  };

  return (
    <header className="bg-white border-b border-blue-200 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
        {/* Mobile Layout */}
        <div className="md:hidden">
          <div className="flex items-center justify-between">
            <Logo size="sm" />

            <div className="flex items-center space-x-2">
              <Badge
                variant={isAdvisor ? 'default' : 'secondary'}
                className={`text-xs ${isAdvisor ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
              >
                {isAdvisor ? 'Advisor' : 'Client'}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-blue-700 hover:bg-blue-50"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              >
                {isMobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Mobile Menu */}
          {isMobileMenuOpen && (
            <div className="mt-3 pt-3 border-t border-blue-200 space-y-1">
              <Button
                variant="ghost"
                size="sm"
                className={`w-full justify-start ${navItemClass}`}
                onClick={() => {
                  navigate('/overview');
                  setIsMobileMenuOpen(false);
                }}
              >
                <LayoutDashboard className="h-4 w-4 mr-2" /> Overview
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`w-full justify-start ${navItemClass}`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <Bell className="h-4 w-4 mr-2" /> Notifications
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`w-full justify-start ${navItemClass}`}
                onClick={() => {
                  navigate('/settings');
                  setIsMobileMenuOpen(false);
                }}
              >
                <Settings className="h-4 w-4 mr-2" /> Settings
              </Button>
              <div className="pt-2 mt-1 border-t border-blue-200">
                <Button
                  size="sm"
                  onClick={() => {
                    onRoleSwitch();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <User className="h-4 w-4 mr-2" /> Switch Role
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Desktop Layout */}
        <div className="hidden md:flex items-center justify-between">
          <Logo size="lg" />

          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              className={navItemClass}
              onClick={() => navigate('/overview')}
            >
              <LayoutDashboard className="h-4 w-4 mr-1" /> Overview
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={navItemClass}
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={navItemClass}
              onClick={() => navigate('/settings')}
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </Button>

            <div className="flex items-center space-x-3 pl-4 ml-2 border-l border-blue-200">
              <div className="flex items-center space-x-2">
                <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="h-4 w-4 text-blue-600" />
                </div>
                <Badge
                  variant={isAdvisor ? 'default' : 'secondary'}
                  className={isAdvisor ? 'bg-blue-600 hover:bg-blue-700' : ''}
                >
                  {isAdvisor ? 'Financial Advisor' : 'Client'}
                </Badge>
              </div>
              <Button
                size="sm"
                onClick={onRoleSwitch}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Switch Role
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
