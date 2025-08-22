import React from 'react';
import { useParams } from 'react-router-dom';
import AdvisorDashboard from '@/components/AdvisorDashboard';

const Client = () => {
	const { clientId } = useParams<{ clientId: string }>();
	return <AdvisorDashboard initialClientId={clientId} />;
};

export default Client;


