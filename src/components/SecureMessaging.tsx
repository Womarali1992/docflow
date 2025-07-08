
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card className="border-2 border-blue-300 bg-white shadow-lg">
      <CardHeader className="border-b-2 border-blue-200 bg-gradient-to-r from-blue-100 to-sky-100">
        <CardTitle className="text-blue-800 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-blue-600" />
          Secure Messaging
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="space-y-4 max-h-64 overflow-y-auto mb-6 bg-gradient-to-br from-blue-100 to-sky-100 rounded-lg p-4 border-2 border-blue-200">
          {messages.map((message) => (
            <div key={message.id} className={`flex gap-3 ${message.role === userRole ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-md p-4 rounded-lg border-2 ${
                message.role === userRole 
                  ? 'bg-blue-600 text-white border-blue-700' 
                  : 'bg-white text-blue-900 border-blue-300'
              }`}>
                <div className="font-medium text-sm mb-2">{message.sender}</div>
                <p className="text-sm leading-relaxed">{message.content}</p>
                <div className={`text-xs mt-2 ${
                  message.role === userRole ? 'text-blue-100' : 'text-blue-500'
                }`}>
                  {message.timestamp.toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
        
        <div className="flex gap-3">
          <Textarea
            placeholder="Type your secure message..."
            value={newMessage}
            onChange={(e) => onMessageChange(e.target.value)}
            className="flex-1 border-2 border-blue-400 focus:border-blue-600 focus:ring-blue-500"
            rows={2}
          />
          <Button 
            onClick={onSendMessage} 
            className="bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-700"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default SecureMessaging;
