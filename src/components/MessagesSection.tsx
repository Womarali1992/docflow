import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Document } from '@/types/dashboard';
import { formatDateTime } from '@/utils/dateUtils';
import { UI_LIMITS } from '@/constants/app';

interface Message {
  id: string;
  text: string;
  sender: 'advisor' | 'client';
  timestamp: Date;
  documentId: string;
}

interface MessagesSectionProps {
  selectedDocument: Document | undefined;
  messages: Message[];
  onSendMessage: (message: string) => void;
  onClose: () => void;
}

const MessagesSection: React.FC<MessagesSectionProps> = ({
  selectedDocument,
  messages,
  onSendMessage,
  onClose,
}) => {
  const [newMessage, setNewMessage] = useState('');
  const { toast } = useToast();

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      onSendMessage(newMessage.trim());
      setNewMessage('');
      toast({
        title: "Message Sent",
        description: "Your message has been sent to the client",
      });
    }
  };

  if (!selectedDocument) {
    return (
      <div className="mb-6 p-4 text-center text-gray-500 text-sm">
        Select a document to view messages
      </div>
    );
  }

  return (
    <Card className="mb-6 border-blue-200 shadow-lg relative z-10 bg-white">
      <CardHeader className="bg-gradient-to-r from-blue-100 to-blue-50 border-b border-blue-200">
        <CardTitle className="flex items-center gap-2 text-blue-900">
          <MessageSquare className="h-5 w-5" />
          Messages: {selectedDocument.name}
          {selectedDocument.folder === 'Reports' && (
            <Badge className="text-xs bg-green-100 text-green-700 border-green-300">
              Deliverable
            </Badge>
          )}
          <div className="ml-auto">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onClose}
              className="bg-white hover:bg-blue-50 border-blue-200 text-blue-700"
            >
              Close Messages
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-6">
        <div className={`flex flex-col h-[${UI_LIMITS.MESSAGE_HISTORY_HEIGHT}] md:h-${UI_LIMITS.MESSAGE_HISTORY_HEIGHT_MD}`}>
          {/* Message History */}
          <div className="flex-1 space-y-3 overflow-y-auto mb-4 pr-2">
            {messages.length > 0 ? (
              messages.map((message) => (
                <div 
                  key={message.id} 
                  className={`p-3 rounded-lg ${
                    message.sender === 'advisor' 
                      ? 'bg-blue-100 ml-4' 
                      : 'bg-gray-100 mr-4'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600">
                      {message.sender === 'advisor' ? 'You' : 'Client'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDateTime(message.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800">{message.text}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">
                No messages yet for this document.
              </p>
            )}
          </div>
          
          {/* New Message Input */}
          <div className="border-t pt-4 space-y-3">
            <Textarea 
              placeholder={`Type your message about ${selectedDocument.name}...`}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="min-h-[80px] resize-none"
            />
            <Button 
              size="sm" 
              className="w-full"
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
            >
              <Send className="h-4 w-4 mr-1" />
              Send Message
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MessagesSection;
