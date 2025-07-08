
import React from 'react';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <>
      <CardHeader className="bg-gradient-to-r from-blue-100 to-sky-100">
        <CardTitle className="flex items-center justify-between text-blue-800">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Document Library
          </div>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-3 text-blue-400" />
            <Input
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 w-64 border border-blue-400 focus:border-blue-600"
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="flex gap-4 overflow-x-auto pb-2">
          {filteredDocuments.map((doc) => (
            <div key={doc.id} className="flex-shrink-0 w-56 h-56 p-4 border border-blue-300 rounded-lg bg-gradient-to-br from-blue-100 to-sky-100 hover:bg-blue-200 transition-colors">
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-300 border border-blue-400 rounded-lg flex items-center justify-center">
                    <FileText className="h-5 w-5 text-blue-700" />
                  </div>
                  <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-800 hover:bg-blue-200 border border-blue-300 ml-auto">
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="font-medium text-blue-800 text-sm mb-2 line-clamp-2">{doc.name}</h4>
                    <p className="text-xs text-blue-600 mb-1">{doc.size}</p>
                    <p className="text-xs text-blue-600 mb-3">{doc.uploadedAt.toLocaleDateString()}</p>
                  </div>
                  <div className="space-y-2">
                    <Badge variant="outline" className="border border-blue-400 text-blue-700 bg-blue-50 text-xs w-full justify-center">
                      {doc.folder}
                    </Badge>
                    <Badge variant="secondary" className="bg-blue-200 text-blue-800 border border-blue-300 text-xs w-full justify-center">
                      {doc.uploadedBy}
                    </Badge>
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

export default DocumentLibrary;
