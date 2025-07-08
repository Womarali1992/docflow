
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FileText, Download, Search } from 'lucide-react';
import { Document } from '@/types/dashboard';

interface DocumentLibraryProps {
  documents: Document[];
  searchTerm: string;
  onSearchChange: (value: string) => void;
}

const DocumentLibrary = ({ documents, searchTerm, onSearchChange }: DocumentLibraryProps) => {
  const filteredDocuments = documents.filter(doc =>
    doc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.folder.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-600" />
          <h3 className="font-medium text-gray-900">Document Library</h3>
        </div>
        <div className="relative">
          <Search className="h-3 w-3 absolute left-2 top-2.5 text-gray-400" />
          <Input
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-7 w-48 h-8 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {filteredDocuments.map((doc) => (
          <div key={doc.id} className="flex-shrink-0 w-48 p-3 border border-gray-200 rounded bg-gray-50">
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
                  <FileText className="h-4 w-4 text-gray-600" />
                </div>
                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900 ml-auto p-1">
                  <Download className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <h4 className="text-sm font-medium text-gray-800 mb-1 line-clamp-2">{doc.name}</h4>
                  <p className="text-xs text-gray-500 mb-1">{doc.size}</p>
                  <p className="text-xs text-gray-500 mb-2">{doc.uploadedAt.toLocaleDateString()}</p>
                </div>
                <div className="space-y-1">
                  <Badge variant="outline" className="text-xs w-full justify-center">
                    {doc.folder}
                  </Badge>
                  <Badge variant="secondary" className="text-xs w-full justify-center">
                    {doc.uploadedBy}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DocumentLibrary;
