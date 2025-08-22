import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { Badge } from '@/components/ui/badge';
import { mockClients } from '@/utils/mockData';

const DocumentPage = () => {
	const { documentId } = useParams<{ documentId: string }>();
	const { documents } = useDocumentsStore();
	const doc = documents.find((d) => d.id === documentId);
	const client = doc?.clientId ? mockClients.find((c) => c.id === doc.clientId) : undefined;

	if (!doc) {
		return (
			<div className="max-w-3xl mx-auto p-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-slate-900">Document Not Found</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-slate-600 text-sm">
							We couldn't find that document. Go back to{' '}
							<Link to="/overview" className="text-blue-600 hover:underline">Overview</Link>.
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="max-w-3xl mx-auto p-6 space-y-6">
			<Card>
				<CardHeader>
					<CardTitle className="text-slate-900">{doc.name}</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-sm text-slate-700">Folder: {doc.folder}</div>
					<div className="text-xs text-slate-500 mt-1">Uploaded: {doc.uploadedAt.toLocaleString()} by {doc.uploadedBy || '—'}</div>
					{client && (
						<div className="mt-2 text-sm">
							Client:{' '}
							<Link to={`/clients/${client.id}`} className="text-blue-600 hover:underline">{client.name}</Link>
						</div>
					)}
					<div className="mt-3 flex gap-2">
						{doc.requestFrequency && (
							<Badge className="bg-slate-100 text-slate-800 border-slate-200">{doc.requestFrequency}</Badge>
						)}
						{doc.dueDate && (
							<Badge className="bg-blue-100 text-blue-800 border-blue-200">Due {doc.dueDate.toLocaleDateString()}</Badge>
						)}
					</div>
					{doc.url && (
						<div className="mt-4">
							<a href={doc.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open file</a>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
};

export default DocumentPage;



