
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, FileText, User, Clock } from 'lucide-react';
import { Activity } from '@/types/dashboard';

interface RecentActivityProps {
  activities: Activity[];
  onDocumentSelect: (documentName: string) => void;
}

const RecentActivity = ({ activities, onDocumentSelect }: RecentActivityProps) => {
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'message':
        return <MessageSquare className="h-4 w-4 text-blue-600" />;
      case 'document':
        return <FileText className="h-4 w-4 text-emerald-600" />;
      case 'update':
        return <User className="h-4 w-4 text-purple-600" />;
      default:
        return <Clock className="h-4 w-4 text-slate-500" />;
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

  const handleActivityClick = (activity: Activity) => {
    console.log('Activity clicked:', activity);
    if (activity.type === 'document') {
      // Extract document name from description - handle different patterns
      let documentName = '';
      
      if (activity.description.includes('uploaded')) {
        // Pattern: "DocumentName uploaded by user"
        documentName = activity.description.split(' uploaded')[0];
      } else if (activity.description.includes('shared')) {
        // Pattern: "DocumentName shared with client"
        documentName = activity.description.split(' shared')[0];
      } else {
        // Fallback: take first word
        documentName = activity.description.split(' ')[0];
      }
      
      console.log('Extracted document name:', documentName);
      onDocumentSelect(documentName);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
          <Clock className="h-4 w-4 text-blue-600" />
        </div>
        <h3 className="text-xl font-semibold text-slate-900">Recent Activity</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {activities.map((activity) => (
          <div 
            key={activity.id} 
            className={`group p-4 rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:shadow-lg transition-all duration-300 ${
              activity.type === 'document' ? 'cursor-pointer hover:bg-blue-50/50 hover:scale-[1.02]' : ''
            }`}
            onClick={() => handleActivityClick(activity)}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${getActivityColor(activity.type)} group-hover:scale-110 transition-transform duration-200`}>
                {getActivityIcon(activity.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800 font-medium leading-snug mb-3 line-clamp-2">
                  {activity.description}
                </p>
                <div className="flex items-center justify-between">
                  <Badge 
                    variant="secondary" 
                    className="text-xs px-2 py-1 bg-slate-100 text-slate-600 border-0 font-medium rounded-lg"
                  >
                    {activity.user}
                  </Badge>
                  <span className="text-xs text-slate-500 font-medium">
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
