
import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Send } from 'lucide-react';
import { Message, UserRole } from '@/types/dashboard';

interface SecureMessagingProps {
  messages: Message[];
  userRole: UserRole;
  newMessage: string;
  onMessageChange: (value: string) => void;
  onSendMessage: () => void;
}

const SecureMessaging = ({ messages, userRole, newMessage, onMessageChange, onSendMessage }: SecureMessagingProps) => {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="h-4 w-4 text-gray-600" />
        <h3 className="font-medium text-gray-900">Secure Messaging</h3>
      </div>
      <div className="space-y-3 max-h-48 overflow-y-auto mb-4 bg-gray-50 rounded p-3">
        {messages.map((message) => (
          <div key={message.id} className={`flex gap-2 ${message.role === userRole ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs p-2 rounded text-sm ${
              message.role === userRole 
                ? 'bg-blue-600 text-white' 
                : 'bg-white text-gray-900 border border-gray-200'
            }`}>
              <div className="font-medium text-xs mb-1">{message.sender}</div>
              <p className="leading-relaxed">{message.content}</p>
              <div className={`text-xs mt-1 ${
                message.role === userRole ? 'text-blue-100' : 'text-gray-500'
              }`}>
                {message.timestamp.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex gap-2">
        <Textarea
          placeholder="Type your secure message..."
          value={newMessage}
          onChange={(e) => onMessageChange(e.target.value)}
          className="flex-1 text-sm"
          rows={2}
        />
        <Button 
          onClick={onSendMessage} 
          size="sm"
        >
          <Send className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};

export default SecureMessaging;
