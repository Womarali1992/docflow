import React from 'react';
import { useParams } from 'react-router-dom';
import DocFlowDashboard from '@/components/docflow/DocFlowDashboard';

const Client = () => {
	const { clientId } = useParams<{ clientId: string }>();
	return <DocFlowDashboard initialClientId={clientId} />;
};

export default Client;


