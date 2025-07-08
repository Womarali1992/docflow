
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, FileText, User, Clock } from 'lucide-react';
import { Activity } from '@/types/dashboard';

interface RecentActivityProps {
  activities: Activity[];
}

const RecentActivity = ({ activities }: RecentActivityProps) => {
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'message':
        return <MessageSquare className="h-4 w-4 text-blue-600" />;
      case 'document':
        return <FileText className="h-4 w-4 text-green-600" />;
      case 'update':
        return <User className="h-4 w-4 text-purple-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getActivityBg = (type: string) => {
    switch (type) {
      case 'message':
        return 'bg-blue-50';
      case 'document':
        return 'bg-green-50';
      case 'update':
        return 'bg-purple-50';
      default:
        return 'bg-gray-50';
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <Clock className="h-4 w-4 text-blue-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900">Recent Activity</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {activities.map((activity) => (
          <div 
            key={activity.id} 
            className={`p-4 rounded-xl border border-gray-100 ${getActivityBg(activity.type)} hover:shadow-md transition-all duration-200`}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center">
                {getActivityIcon(activity.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 font-medium line-clamp-2 mb-2">
                  {activity.description}
                </p>
              </div>
            </div>
            
            <div className="space-y-2">
              <Badge variant="outline" className="text-xs bg-white/80 border-gray-200">
                {activity.user}
              </Badge>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Clock className="h-3 w-3" />
                {activity.timestamp.toLocaleDateString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RecentActivity;
