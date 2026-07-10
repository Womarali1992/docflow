import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { AuthProvider } from '@/context/AuthContext'
import { ClientsProvider } from '@/context/ClientsContext'
import { DocumentsProvider } from '@/context/DocumentsContext'

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <ClientsProvider>
      <DocumentsProvider>
        <App />
      </DocumentsProvider>
    </ClientsProvider>
  </AuthProvider>
);
