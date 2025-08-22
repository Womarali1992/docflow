import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { DocumentsProvider } from '@/context/DocumentsContext'

createRoot(document.getElementById("root")!).render(
  <DocumentsProvider>
    <App />
  </DocumentsProvider>
);
