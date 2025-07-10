
import React from 'react';
import { Button } from '@/components/ui/button';
import { Upload, File, Plus, X, FileText } from 'lucide-react';
import { Document } from '@/types/dashboard';

interface DocumentUploadProps {
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  selectedDocument?: Document | null;
  onClearSelection?: () => void;
}

const DocumentUpload = ({ onFileUpload, selectedDocument, onClearSelection }: DocumentUploadProps) => {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Create a fake event for the file upload handler
      const event = {
        target: { files }
      } as React.ChangeEvent<HTMLInputElement>;
      onFileUpload(event);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <Upload className="h-4 w-4 text-blue-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900">
          {selectedDocument ? 'Selected Document' : 'Document Upload'}
        </h3>
        {selectedDocument && onClearSelection && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClearSelection}
            className="ml-auto text-slate-500 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      
      {selectedDocument ? (
        <div className="border border-blue-200 rounded-2xl p-6 bg-blue-50/30">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <FileText className="h-6 w-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-gray-800">{selectedDocument.name}</h4>
              <p className="text-sm text-gray-600">
                {selectedDocument.size} • Uploaded by {selectedDocument.uploadedBy}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {selectedDocument.uploadedAt.toLocaleDateString()} • {selectedDocument.folder}
              </p>
            </div>
          </div>
          <div className="text-sm text-gray-600 bg-white/50 rounded-lg p-3">
            <p className="font-medium mb-1">Document Details:</p>
            <p>Use the messaging panel to discuss this document with your advisor or client.</p>
          </div>
        </div>
      ) : (
        <div 
          className="border-2 border-dashed border-blue-200 rounded-2xl p-8 text-center hover:border-blue-300 hover:bg-blue-50/50 transition-all duration-200"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <File className="h-8 w-8 text-blue-600" />
          </div>
          
          <h4 className="text-lg font-semibold text-gray-800 mb-2">Upload Your Documents</h4>
          <p className="text-gray-600 mb-6 max-w-sm mx-auto">
            Drag and drop files here, or click the button below to browse and select files from your device
          </p>
          
          <label className="cursor-pointer">
            <input
              type="file"
              className="hidden"
              multiple
              onChange={onFileUpload}
            />
            <Button className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-6 py-2 font-medium shadow-lg hover:shadow-xl transition-all duration-200">
              <Plus className="h-4 w-4 mr-2" />
              Choose Files
            </Button>
          </label>
          
          <p className="text-xs text-gray-500 mt-4">
            Supports PDF, DOC, DOCX, XLS, XLSX files up to 10MB
          </p>
        </div>
      )}
    </div>
  );
};

export default DocumentUpload;
