
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FileText, Download, Search, Folder } from 'lucide-react';
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
            <FileText className="h-4 w-4 text-blue-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900">Document Library</h3>
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 w-64 border-gray-200 rounded-xl focus:border-blue-300 focus:ring-blue-300"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredDocuments.map((doc) => (
          <div key={doc.id} className="p-4 border border-gray-200 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all duration-200">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 bg-white rounded-lg shadow-sm flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <Button variant="ghost" size="sm" className="text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg p-2">
                <Download className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-800 line-clamp-2">{doc.name}</h4>
              <p className="text-xs text-gray-500">{doc.size}</p>
              <p className="text-xs text-gray-500">{doc.uploadedAt.toLocaleDateString()}</p>
              
              <div className="space-y-1 pt-2">
                <Badge variant="outline" className="text-xs bg-white border-gray-300 flex items-center gap-1">
                  <Folder className="h-3 w-3" />
                  {doc.folder}
                </Badge>
                <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                  {doc.uploadedBy}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DocumentLibrary;
