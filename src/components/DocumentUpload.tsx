
import React from 'react';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';

interface DocumentUploadProps {
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const DocumentUpload = ({ onFileUpload }: DocumentUploadProps) => {
  return (
    <>
      <CardHeader className="bg-gradient-to-r from-blue-100 to-sky-100">
        <CardTitle className="text-blue-800 flex items-center gap-2">
          <Upload className="h-5 w-5 text-blue-600" />
          Document Upload
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="border border-dashed border-blue-400 rounded-lg p-8 text-center bg-gradient-to-br from-blue-100 to-sky-100 hover:border-blue-500 transition-colors">
          <div className="w-12 h-12 bg-blue-300 border border-blue-400 rounded-lg flex items-center justify-center mx-auto mb-4">
            <Upload className="h-6 w-6 text-blue-700" />
          </div>
          <h3 className="text-base font-medium text-blue-800 mb-2">Upload Documents</h3>
          <p className="text-blue-600 mb-4 text-sm">Drag files here or click to browse</p>
          <label className="cursor-pointer">
            <input
              type="file"
              className="hidden"
              multiple
              onChange={onFileUpload}
            />
            <Button variant="outline" className="border border-blue-400 text-blue-700 hover:bg-blue-100">
              Choose Files
            </Button>
          </label>
        </div>
      </CardContent>
    </>
  );
};

export default DocumentUpload;
