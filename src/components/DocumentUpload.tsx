
import React from 'react';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';

interface DocumentUploadProps {
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const DocumentUpload = ({ onFileUpload }: DocumentUploadProps) => {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Upload className="h-4 w-4 text-gray-600" />
        <h3 className="font-medium text-gray-900">Document Upload</h3>
      </div>
      <div className="border-2 border-dashed border-gray-300 rounded p-6 text-center hover:border-gray-400 transition-colors">
        <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center mx-auto mb-3">
          <Upload className="h-5 w-5 text-gray-500" />
        </div>
        <h4 className="text-sm font-medium text-gray-800 mb-1">Upload Documents</h4>
        <p className="text-gray-500 mb-3 text-sm">Drag files here or click to browse</p>
        <label className="cursor-pointer">
          <input
            type="file"
            className="hidden"
            multiple
            onChange={onFileUpload}
          />
          <Button variant="outline" size="sm">
            Choose Files
          </Button>
        </label>
      </div>
    </div>
  );
};

export default DocumentUpload;
