
import React from 'react';
import { Button } from '@/components/ui/button';
import { Upload, File, Plus } from 'lucide-react';

interface DocumentUploadProps {
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const DocumentUpload = ({ onFileUpload }: DocumentUploadProps) => {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <Upload className="h-4 w-4 text-blue-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900">Document Upload</h3>
      </div>
      
      <div className="border-2 border-dashed border-blue-200 rounded-2xl p-8 text-center hover:border-blue-300 hover:bg-blue-50/50 transition-all duration-200">
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
    </div>
  );
};

export default DocumentUpload;
