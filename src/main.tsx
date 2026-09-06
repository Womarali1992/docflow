import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import './index.css'
import { createQueryClient } from '@/api/queryClient'
import { AuthProvider } from '@/context/AuthContext'

// The query client sits outside AuthProvider: signing out clears the cache, so
// the session's lifecycle owner has to be inside the cache's provider.
const queryClient = createQueryClient()

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <App />
    </AuthProvider>
  </QueryClientProvider>
);
