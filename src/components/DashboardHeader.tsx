
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Bell, Settings } from 'lucide-react';
import { UserRole } from '@/types/dashboard';

interface DashboardHeaderProps {
  userRole: UserRole;
  onRoleSwitch: () => void;
}

const DashboardHeader = ({ userRole, onRoleSwitch }: DashboardHeaderProps) => {
  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">WealthLink Portal</h1>
              <p className="text-sm text-gray-500">Professional Client Management</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
              <Bell className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">
              <Settings className="h-4 w-4" />
            </Button>
            <Badge variant={userRole === 'advisor' ? 'default' : 'secondary'}>
              {userRole === 'advisor' ? 'Financial Advisor' : 'Client'}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={onRoleSwitch}
              className="text-sm"
            >
              Switch Role
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
