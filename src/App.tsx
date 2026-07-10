import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import DocFlowLayout from "@/components/docflow/Layout";
import ClientLayout from "@/components/docflow/ClientLayout";
import { RouteGuard } from "@/components/RouteGuard";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import FinancialOverview from "./pages/FinancialOverview";
import Client from "./pages/Client";
import ClientPortal from "./pages/ClientPortal";
import DocumentsPage from "./pages/Documents";
import DocumentPage from "./pages/Document";
import Login from "./pages/Login";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<RouteGuard kind="provider"><DocFlowLayout /></RouteGuard>}>
            <Route path="/" element={<Index />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/overview" element={<FinancialOverview />} />
            <Route path="/clients/:clientId" element={<Client />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/documents/:documentId" element={<DocumentPage />} />
          </Route>

          <Route element={<RouteGuard kind="client"><ClientLayout /></RouteGuard>}>
            <Route path="/client/:clientId" element={<ClientPortal />} />
          </Route>

          <Route element={<DocFlowLayout />}>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
