import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Bell, Settings, User, LayoutDashboard } from 'lucide-react';
import { UserRole } from '@/types/dashboard';
import { useNavigate } from 'react-router-dom';
interface DashboardHeaderProps {
  userRole: UserRole;
  onRoleSwitch: () => void;
}
const DashboardHeader = ({
  userRole,
  onRoleSwitch
}: DashboardHeaderProps) => {
  const navigate = useNavigate();
  return <header className="bg-white border-b border-blue-100 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Sarah Johson C.P.A.</h1>
              <p className="text-sm text-blue-600 font-medium">Professional Client Management</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl" onClick={() => navigate('/overview')}>
              <LayoutDashboard className="h-4 w-4 mr-1" /> Overview
            </Button>
            <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl">
              <Bell className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl" onClick={() => navigate('/settings')}>
              <Settings className="h-4 w-4" />
            </Button>
            
            <div className="flex items-center space-x-3 pl-3 border-l border-blue-100">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="h-4 w-4 text-blue-600" />
                </div>
                <Badge variant={userRole === 'advisor' ? 'default' : 'secondary'} className={userRole === 'advisor' ? 'bg-blue-600 hover:bg-blue-700' : ''}>
                  {userRole === 'advisor' ? 'Financial Advisor' : 'Client'}
                </Badge>
              </div>
              <Button variant="outline" size="sm" onClick={onRoleSwitch} className="text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300 rounded-xl">
                Switch Role
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>;
};
export default DashboardHeader;