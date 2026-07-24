import React, { useRef } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Client } from '@/types/dashboard';
import { formatDate } from '@/utils/dateUtils';

interface ClientHeaderProps {
  clients: Client[];
  currentClient: Client;
  onSelectClient: (clientId: string) => void;
}

const ClientHeader: React.FC<ClientHeaderProps> = ({
  clients,
  currentClient,
  onSelectClient,
}) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    toast({
      title: files.length > 1 ? 'Files Selected' : 'File Selected',
      description: files.length > 1 ? `${files.length} files chosen.` : `${files[0].name}`,
    });
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    toast({
      title: 'File Drop',
      description: 'File upload functionality would be implemented here',
    });
  };

  const initials = currentClient.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const stats = [
    {
      label: 'Documents',
      value: currentClient.documentsCount,
      box: 'bg-indigo-900/10 ring-1 ring-indigo-900/30',
      value_color: 'text-indigo-900',
    },
    {
      label: 'Pending',
      value: currentClient.pendingUpdates,
      box: 'bg-orange-700/10 ring-1 ring-orange-700/30',
      value_color: 'text-orange-800',
    },
    {
      label: 'Messages',
      value: currentClient.unreadMessages,
      box: 'bg-green-800/10 ring-1 ring-green-800/30',
      value_color: 'text-green-800',
    },
  ];

  return (
    <Card className="mb-6 border-slate-300 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-slate-100 to-slate-50 border-b-4 border-indigo-900 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Upload zone (left) */}
          <div
            className="flex items-center justify-center gap-2 h-14 px-5 border-2 border-dashed border-blue-300 rounded-lg bg-white/70 hover:bg-white hover:border-blue-400 transition-colors cursor-pointer group"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-5 w-5 text-blue-600 group-hover:text-blue-700" />
            <span className="text-sm text-blue-700 font-medium">
              Drop files or click to upload
            </span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
            />
          </div>

          {/* Client identity nameplate (doubles as client switcher) */}
          <div className="flex flex-1 justify-center">
            <Select value={currentClient.id} onValueChange={onSelectClient}>
              <SelectTrigger
                className="h-auto w-auto gap-3 rounded-lg border border-transparent bg-transparent px-3 py-2 text-left hover:bg-white/60 hover:border-blue-200 focus:ring-blue-300 [&>svg]:text-blue-500"
                aria-label="Switch client"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-white font-semibold text-base shadow-sm">
                    {initials}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-blue-900 leading-tight">
                      {currentClient.name}
                    </h2>
                    <p className="text-sm text-blue-700">{currentClient.email}</p>
                    <p className="text-xs text-gray-500">
                      Last activity: {formatDate(currentClient.lastActivity)}
                    </p>
                  </div>
                </div>
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stats (right) */}
          <div className="flex items-center gap-3 pl-6 border-l border-blue-200">
            {stats.map((s) => (
              <div
                key={s.label}
                className={`min-w-[72px] rounded-lg px-4 py-2 text-center ${s.box}`}
              >
                <div className={`text-2xl font-bold ${s.value_color}`}>{s.value}</div>
                <div className="text-xs font-medium text-gray-600">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
};

export default ClientHeader;
