import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { FileText, X } from 'lucide-react';
import { DocumentRequest, RequestFrequency } from '@/types/dashboard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface RequestDocumentPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (request: Omit<DocumentRequest, 'id' | 'requestedAt' | 'status'>) => void;
  clientId: string;
  advisorName: string;
  initialDocumentName?: string;
}

const RequestDocumentPopup = ({
  isOpen,
  onClose,
  onSubmit,
  clientId,
  advisorName,
  initialDocumentName
}: RequestDocumentPopupProps) => {
  const [documentName, setDocumentName] = useState(initialDocumentName || '');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [frequency, setFrequency] = useState<RequestFrequency>('monthly');

  React.useEffect(() => {
    if (isOpen) {
      setDocumentName(initialDocumentName || '');
    }
  }, [isOpen, initialDocumentName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!documentName.trim()) {
      return;
    }

    setIsSubmitting(true);
    
    try {
      await onSubmit({
        documentName: documentName.trim(),
        description: description.trim() || undefined,
        requestedBy: advisorName,
        clientId,
        frequency
      });
      
      // Reset form
      setDocumentName('');
      setDescription('');
      setFrequency('monthly');
      onClose();
    } catch (error) {
      console.error('Error submitting document request:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setDocumentName('');
      setDescription('');
      setFrequency('monthly');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Request Document
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="documentName">Document Name *</Label>
            <Input
              id="documentName"
              value={documentName}
              onChange={(e) => setDocumentName(e.target.value)}
              placeholder="e.g., Tax Returns 2023, Bank Statement"
              required
              disabled={isSubmitting}
              className="focus:border-blue-300 focus:ring-blue-300"
            />
          </div>
          
          <div className="space-y-2">
            <Label>Frequency *</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as RequestFrequency)}>
              <SelectTrigger>
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any specific requirements or details about the document..."
              rows={3}
              disabled={isSubmitting}
              className="focus:border-blue-300 focus:ring-blue-300 resize-none"
            />
          </div>
          
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !documentName.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              {isSubmitting ? 'Requesting...' : 'Request Document'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RequestDocumentPopup;
