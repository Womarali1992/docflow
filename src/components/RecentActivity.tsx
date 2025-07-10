
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
        return <MessageSquare className="h-3.5 w-3.5 text-blue-600" />;
      case 'document':
        return <FileText className="h-3.5 w-3.5 text-emerald-600" />;
      case 'update':
        return <User className="h-3.5 w-3.5 text-purple-600" />;
      default:
        return <Clock className="h-3.5 w-3.5 text-slate-500" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'message':
        return 'text-blue-600 bg-blue-50';
      case 'document':
        return 'text-emerald-600 bg-emerald-50';
      case 'update':
        return 'text-purple-600 bg-purple-50';
      default:
        return 'text-slate-600 bg-slate-50';
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <div className="w-6 h-6 bg-blue-500/10 rounded-md flex items-center justify-center">
          <Clock className="h-3.5 w-3.5 text-blue-600" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900">Recent Activity</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {activities.map((activity) => (
          <div 
            key={activity.id} 
            className="group p-4 rounded-lg border border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm transition-all duration-200"
          >
            <div className="flex items-start gap-3">
              <div className={`w-7 h-7 rounded-md flex items-center justify-center ${getActivityColor(activity.type)}`}>
                {getActivityIcon(activity.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 font-medium leading-snug mb-2 line-clamp-2">
                  {activity.description}
                </p>
                <div className="flex items-center justify-between">
                  <Badge 
                    variant="secondary" 
                    className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 border-0 font-normal"
                  >
                    {activity.user}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    {activity.timestamp.toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RecentActivity;
