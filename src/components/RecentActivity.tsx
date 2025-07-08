
import React from 'react';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, FileText, User } from 'lucide-react';
import { Activity } from '@/types/dashboard';

interface RecentActivityProps {
  activities: Activity[];
}

const RecentActivity = ({ activities }: RecentActivityProps) => {
  return (
    <>
      <CardHeader className="bg-gradient-to-r from-blue-100 to-sky-100">
        <CardTitle className="text-blue-800 flex items-center gap-2">
          <User className="h-5 w-5 text-blue-600" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="flex gap-4 overflow-x-auto pb-2">
          {activities.map((activity) => (
            <div key={activity.id} className="flex-shrink-0 w-56 h-56 p-4 rounded-lg border border-blue-300 bg-gradient-to-br from-blue-100 to-sky-100 hover:shadow-md transition-all">
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${
                    activity.type === 'message' ? 'bg-blue-200 border-blue-400' :
                    activity.type === 'document' ? 'bg-green-200 border-green-400' : 'bg-purple-200 border-purple-400'
                  }`}>
                    {activity.type === 'message' && <MessageSquare className="h-4 w-4 text-blue-600" />}
                    {activity.type === 'document' && <FileText className="h-4 w-4 text-green-600" />}
                    {activity.type === 'update' && <User className="h-4 w-4 text-purple-600" />}
                  </div>
                </div>
                <div className="flex-1 flex flex-col justify-between">
                  <p className="font-medium text-blue-800 text-sm leading-tight mb-3">{activity.description}</p>
                  <div className="space-y-2">
                    <Badge variant="outline" className="border border-blue-400 text-blue-700 bg-blue-50 text-xs w-full justify-center">
                      {activity.user}
                    </Badge>
                    <div className="group relative">
                      <Badge 
                        variant="secondary" 
                        className="bg-blue-200 text-blue-800 border border-blue-300 text-xs cursor-pointer w-full justify-center"
                      >
                        {activity.timestamp.toLocaleDateString()}
                      </Badge>
                      <div className="absolute bottom-full left-0 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                        {activity.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </>
  );
};

export default RecentActivity;
