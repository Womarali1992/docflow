import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, MessageSquare } from 'lucide-react';
import { getStatusBadgeColor } from '@/utils/documentUtils';
import { formatDate } from '@/utils/dateUtils';

interface ClientDocument {
  id: string;
  name: string;
  type: string;
  uploadedAt: Date;
  size: string;
  status: 'pending' | 'reviewed' | 'needs_update';
  hasUpdateRequest?: boolean;
  updateRequestedBy?: string;
  updateRequestedAt?: Date;
  updateRequestDescription?: string;
  requestedVersion?: string;
}

interface ClientDocumentCardProps {
  document: ClientDocument;
  isSelected: boolean;
  onMessageClick: () => void;
  onReviewClick: () => void;
  onRequestUpdateClick: () => void;
  onAddRequestClick: () => void;
}

const ClientDocumentCard: React.FC<ClientDocumentCardProps> = ({
  document,
  isSelected,
  onMessageClick,
  onReviewClick,
  onRequestUpdateClick,
  onAddRequestClick,
}) => {
  return (
    <div className={`p-4 border rounded-lg hover:bg-gray-50 transition-colors ${
      isSelected ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <FileText className="h-5 w-5 text-blue-600 flex-shrink-0" />
          <div className="min-w-0">
            <h4 className="font-medium text-gray-900 truncate">{document.name}</h4>
            <p className="text-sm text-gray-500">
              {document.size} • Uploaded {formatDate(document.uploadedAt)}
            </p>
            {document.hasUpdateRequest && (
              <div className="mt-2">
                <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-300">
                  Update requested for {document.requestedVersion} version
                </Badge>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge className={getStatusBadgeColor(document.status)}>
            {document.status.replace('_', ' ')}
          </Badge>
        </div>
      </div>
      
      <div className="flex flex-wrap gap-2 mt-3">
        <Button 
          size="sm" 
          variant={isSelected ? "default" : "outline"}
          onClick={onMessageClick}
        >
          <MessageSquare className="h-4 w-4 mr-1" />
          Messages
        </Button>
        
        <Button 
          size="sm" 
          variant="outline"
          onClick={onReviewClick}
        >
          Review
        </Button>
        
        {document.status === 'needs_update' && (
          <Button 
            size="sm" 
            variant="outline"
            onClick={onRequestUpdateClick}
          >
            Request Update
          </Button>
        )}
        
        <Button 
          size="sm" 
          variant="outline"
          onClick={onAddRequestClick}
        >
          Add Request
        </Button>
      </div>
    </div>
  );
};

export default ClientDocumentCard;
