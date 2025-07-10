
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
        return <MessageSquare className="h-4 w-4 text-blue-100" />;
      case 'document':
        return <FileText className="h-4 w-4 text-emerald-200" />;
      case 'update':
        return <User className="h-4 w-4 text-purple-200" />;
      default:
        return <Clock className="h-4 w-4 text-slate-300" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'message':
        return 'text-blue-100 bg-blue-800/30';
      case 'document':
        return 'text-emerald-100 bg-emerald-800/30';
      case 'update':
        return 'text-purple-100 bg-purple-800/30';
      default:
        return 'text-slate-200 bg-slate-700/30';
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
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
          <Clock className="h-4 w-4 text-white" />
        </div>
        <h3 className="text-xl font-semibold text-white">Recent Activity</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {activities.map((activity) => (
          <div 
            key={activity.id} 
            className={`group p-3 rounded-xl border border-white/20 bg-white/10 backdrop-blur-sm hover:border-white/30 hover:bg-white/20 transition-all duration-300 ${
              activity.type === 'document' ? 'cursor-pointer hover:scale-[1.02]' : ''
            }`}
            onClick={() => handleActivityClick(activity)}
          >
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getActivityColor(activity.type)} group-hover:scale-110 transition-transform duration-200`}>
                {getActivityIcon(activity.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium leading-snug mb-2 line-clamp-2">
                  {activity.description}
                </p>
                <div className="flex items-center justify-between">
                  <Badge 
                    variant="secondary" 
                    className="text-xs px-2 py-1 bg-white/20 text-white border-0 font-medium rounded-lg backdrop-blur-sm"
                  >
                    {activity.user}
                  </Badge>
                  <span className="text-xs text-blue-100 font-medium">
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
