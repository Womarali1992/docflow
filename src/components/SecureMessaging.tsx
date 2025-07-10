
import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Send, Shield, FileText } from 'lucide-react';
import { Message, UserRole, Document } from '@/types/dashboard';

interface SecureMessagingProps {
  messages: Message[];
  userRole: UserRole;
  newMessage: string;
  onMessageChange: (value: string) => void;
  onSendMessage: () => void;
  selectedDocument?: Document | null;
}

const SecureMessaging = ({ 
  messages, 
  userRole, 
  newMessage, 
  onMessageChange, 
  onSendMessage,
  selectedDocument 
}: SecureMessagingProps) => {
  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <MessageSquare className="h-4 w-4 text-blue-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-gray-900">
            {selectedDocument ? 'Document Discussion' : 'Secure Messaging'}
          </h3>
          <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
            <Shield className="h-3 w-3" />
            End-to-end encrypted
          </div>
        </div>
      </div>

      {selectedDocument && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-800">Discussing:</span>
          </div>
          <p className="text-sm text-blue-700 truncate">{selectedDocument.name}</p>
        </div>
      )}
      
      <div className="flex-1 space-y-4 max-h-64 overflow-y-auto mb-4 bg-gray-50 rounded-xl p-4">
        {messages.map((message) => (
          <div key={message.id} className={`flex gap-3 ${message.role === userRole ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs px-4 py-3 rounded-2xl shadow-sm ${
              message.role === userRole 
                ? 'bg-blue-600 text-white rounded-br-md' 
                : 'bg-white text-gray-900 border border-gray-200 rounded-bl-md'
            }`}>
              <div className={`font-medium text-xs mb-1 ${
                message.role === userRole ? 'text-blue-100' : 'text-gray-500'
              }`}>
                {message.sender}
              </div>
              <p className="text-sm leading-relaxed">{message.content}</p>
              <div className={`text-xs mt-2 ${
                message.role === userRole ? 'text-blue-200' : 'text-gray-400'
              }`}>
                {message.timestamp.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex gap-3">
        <Textarea
          placeholder={selectedDocument 
            ? `Discuss ${selectedDocument.name}...` 
            : "Type your secure message..."
          }
          value={newMessage}
          onChange={(e) => onMessageChange(e.target.value)}
          className="flex-1 text-sm border-gray-200 rounded-xl resize-none focus:border-blue-300 focus:ring-blue-300"
          rows={2}
        />
        <Button 
          onClick={onSendMessage} 
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 shadow-lg hover:shadow-xl transition-all duration-200"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default SecureMessaging;
