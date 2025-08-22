
import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, File, Plus, X, FileText } from 'lucide-react';
import { Document } from '@/types/dashboard';

interface DocumentUploadProps {
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  selectedDocument?: Document | null;
  onClearSelection?: () => void;
}

const DocumentUpload = ({ onFileUpload, selectedDocument, onClearSelection }: DocumentUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
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

  const handleDownload = () => {
    if (selectedDocument?.url) {
      const link = document.createElement('a');
      link.href = selectedDocument.url;
      link.download = selectedDocument.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
          
          {/* Document Viewer */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="h-96 overflow-auto">
              {selectedDocument.name.toLowerCase().endsWith('.pdf') ? (
                selectedDocument.url ? (
                  <iframe
                    src={selectedDocument.url}
                    className="w-full h-full border-0"
                    title={`PDF Viewer - ${selectedDocument.name}`}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center bg-gray-50">
                    <div className="text-center">
                      <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600 font-medium">PDF Viewer</p>
                      <p className="text-sm text-gray-500 mt-2">
                        {selectedDocument.name}
                      </p>
                      <Button variant="outline" className="mt-4" onClick={handleDownload}>
                        Download to View
                      </Button>
                    </div>
                  </div>
                )
              ) : selectedDocument.name.toLowerCase().includes('bank') || selectedDocument.name.toLowerCase().includes('statement') ? (
                <div className="p-6 font-mono text-sm">
                  <div className="border-b border-gray-200 pb-4 mb-4">
                    <h3 className="font-bold text-lg text-gray-800">FIRST NATIONAL BANK</h3>
                    <p className="text-gray-600">Account Statement - June 2024</p>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span>Account Number:</span>
                      <span className="font-semibold">****-****-****-1234</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Account Type:</span>
                      <span>Checking Account</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Statement Period:</span>
                      <span>June 1 - June 30, 2024</span>
                    </div>
                  </div>
                  
                  <div className="mt-6">
                    <h4 className="font-semibold text-gray-800 mb-3">Recent Transactions</h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between bg-gray-50 p-2 rounded">
                        <span>06/28 - Direct Deposit - Salary</span>
                        <span className="text-green-600 font-semibold">+$4,500.00</span>
                      </div>
                      <div className="flex justify-between bg-gray-50 p-2 rounded">
                        <span>06/27 - Business Setup - Legal Fees</span>
                        <span className="text-red-600">-$1,200.00</span>
                      </div>
                      <div className="flex justify-between bg-gray-50 p-2 rounded">
                        <span>06/25 - Business Setup - Registration</span>
                        <span className="text-red-600">-$450.00</span>
                      </div>
                      <div className="flex justify-between bg-gray-50 p-2 rounded">
                        <span>06/20 - Grocery Store</span>
                        <span className="text-red-600">-$89.34</span>
                      </div>
                      <div className="flex justify-between bg-gray-50 p-2 rounded">
                        <span>06/15 - Investment Transfer</span>
                        <span className="text-red-600">-$2,000.00</span>
                      </div>
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between font-semibold">
                        <span>Current Balance:</span>
                        <span className="text-blue-600">$8,760.66</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : selectedDocument.name.toLowerCase().includes('tax') ? (
                <div className="p-6 font-mono text-sm">
                  <div className="border-b border-gray-200 pb-4 mb-4">
                    <h3 className="font-bold text-lg text-gray-800">U.S. INDIVIDUAL INCOME TAX RETURN</h3>
                    <p className="text-gray-600">Form 1040 - Tax Year 2023</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <h4 className="font-semibold text-gray-800">Personal Information</h4>
                      <div className="space-y-2 text-xs">
                        <div><span className="text-gray-600">Name:</span> Sarah Johnson</div>
                        <div><span className="text-gray-600">SSN:</span> ***-**-****</div>
                        <div><span className="text-gray-600">Filing Status:</span> Single</div>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <h4 className="font-semibold text-gray-800">Income Summary</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span>Wages (W-2):</span>
                          <span>$68,500</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Interest Income:</span>
                          <span>$285</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Capital Gains:</span>
                          <span>$1,250</span>
                        </div>
                        <div className="flex justify-between font-semibold border-t pt-2">
                          <span>Total Income:</span>
                          <span>$70,035</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <div className="flex justify-between font-semibold text-lg">
                      <span>Tax Owed:</span>
                      <span className="text-red-600">$8,420</span>
                    </div>
                    <div className="flex justify-between text-sm mt-2">
                      <span>Amount Paid:</span>
                      <span className="text-green-600">$9,100</span>
                    </div>
                    <div className="flex justify-between font-semibold text-lg mt-2 text-blue-600">
                      <span>Refund Due:</span>
                      <span>$680</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  <div className="border-b border-gray-200 pb-4 mb-4">
                    <h3 className="font-bold text-lg text-gray-800">Investment Goals & Risk Assessment</h3>
                    <p className="text-gray-600">Client Questionnaire - Updated June 2024</p>
                  </div>
                  
                  <div className="space-y-4 text-sm">
                    <div>
                      <h4 className="font-semibold text-gray-800 mb-2">Primary Investment Objectives:</h4>
                      <ul className="list-disc list-inside space-y-1 text-gray-700 ml-4">
                        <li>Long-term growth for retirement (target: age 65)</li>
                        <li>Diversified portfolio with moderate risk tolerance</li>
                        <li>Annual return target: 7-9%</li>
                        <li>Emergency fund: 6 months expenses</li>
                      </ul>
                    </div>
                    
                    <div>
                      <h4 className="font-semibold text-gray-800 mb-2">Risk Tolerance Assessment:</h4>
                      <div className="bg-gray-50 p-3 rounded">
                        <p><span className="font-medium">Score:</span> 6/10 (Moderate)</p>
                        <p><span className="font-medium">Time Horizon:</span> 25+ years</p>
                        <p><span className="font-medium">Liquidity Needs:</span> Low to moderate</p>
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-semibold text-gray-800 mb-2">Current Financial Situation:</h4>
                      <div className="space-y-1 text-gray-700">
                        <p>Annual Income: $68,500</p>
                        <p>Monthly Expenses: $3,200</p>
                        <p>Current Savings: $15,000</p>
                        <p>401(k) Balance: $28,500</p>
                      </div>
                    </div>
                    
                    <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mt-4">
                      <p className="text-sm text-yellow-800">
                        <span className="font-medium">Advisor Note:</span> Client needs to update risk tolerance based on recent job promotion and increased income.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div 
          className="border-2 border-dashed border-blue-200 rounded-2xl p-8 text-center hover:border-blue-300 hover:bg-blue-50/50 transition-all duration-200"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
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
              accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFileUpload}
              ref={fileInputRef}
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
