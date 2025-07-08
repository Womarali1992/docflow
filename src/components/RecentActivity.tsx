
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, FileText, User } from 'lucide-react';
import { Activity } from '@/types/dashboard';

interface RecentActivityProps {
  activities: Activity[];
}

const RecentActivity = ({ activities }: RecentActivityProps) => {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <User className="h-4 w-4 text-gray-600" />
        <h3 className="font-medium text-gray-900">Recent Activity</h3>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {activities.map((activity) => (
          <div key={activity.id} className="flex-shrink-0 w-48 p-3 rounded border border-gray-200 bg-gray-50">
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  activity.type === 'message' ? 'bg-blue-100' :
                  activity.type === 'document' ? 'bg-green-100' : 'bg-purple-100'
                }`}>
                  {activity.type === 'message' && <MessageSquare className="h-3 w-3 text-blue-600" />}
                  {activity.type === 'document' && <FileText className="h-3 w-3 text-green-600" />}
                  {activity.type === 'update' && <User className="h-3 w-3 text-purple-600" />}
                </div>
              </div>
              <div className="flex-1 flex flex-col justify-between">
                <p className="text-sm text-gray-800 leading-tight mb-2">{activity.description}</p>
                <div className="space-y-1">
                  <Badge variant="outline" className="text-xs w-full justify-center">
                    {activity.user}
                  </Badge>
                  <div className="group relative">
                    <Badge 
                      variant="secondary" 
                      className="text-xs cursor-pointer w-full justify-center"
                    >
                      {activity.timestamp.toLocaleDateString()}
                    </Badge>
                    <div className="absolute bottom-full left-0 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                      {activity.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
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
