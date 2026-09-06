import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

/**
 * The old document details page. Reviewing happens in the workspace now
 * (C3.3), so this route only forwards — links in emails, activity rows and
 * anything a client bookmarked keep working.
 */
const DocumentPage: React.FC = () => {
  const { documentId } = useParams<{ documentId: string }>();
  if (!documentId) return <Navigate to="/clients" replace />;
  return <Navigate to={`/review/${documentId}`} replace />;
};

export default DocumentPage;
