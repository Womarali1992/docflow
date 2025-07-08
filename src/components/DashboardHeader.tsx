
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
    <header className="bg-white border-b-2 border-blue-300 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-md flex items-center justify-center">
              <FileText className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-blue-900">WealthLink Portal</h1>
              <p className="text-sm text-blue-600">Professional Client Management</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 hover:bg-blue-100 border-2 border-blue-300">
              <Bell className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 hover:bg-blue-100 border-2 border-blue-300">
              <Settings className="h-4 w-4" />
            </Button>
            <Badge 
              variant={userRole === 'advisor' ? 'default' : 'secondary'}
              className={userRole === 'advisor' ? 'bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-700' : 'bg-blue-100 text-blue-800 border-2 border-blue-400'}
            >
              {userRole === 'advisor' ? 'Financial Advisor' : 'Client'}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={onRoleSwitch}
              className="border-2 border-blue-400 text-blue-700 hover:bg-blue-100"
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
