import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import DocFlowLayout from "@/components/docflow/Layout";
import ClientLayout from "@/components/docflow/ClientLayout";
import { MfaGate, RouteGuard } from "@/components/RouteGuard";
import Index from "./pages/Index";
import Mfa from "./pages/Mfa";
import MfaEnroll from "./pages/MfaEnroll";
import Invite from "./pages/Invite";
import Forgot from "./pages/Forgot";
import Reset from "./pages/Reset";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import FinancialOverview from "./pages/FinancialOverview";
import Client from "./pages/Client";
import Clients from "./pages/Clients";
import Engagement from "./pages/Engagement";
import Templates from "./pages/Templates";
import ClientPortal from "./pages/ClientPortal";
import DocumentsPage from "./pages/Documents";
import DocumentPage from "./pages/Document";
import Login from "./pages/Login";

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/mfa" element={<MfaGate stage="preauth"><Mfa /></MfaGate>} />
        <Route path="/mfa/enroll" element={<MfaGate stage="mfa_enroll"><MfaEnroll /></MfaGate>} />
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset/:token" element={<Reset />} />

        <Route element={<RouteGuard kind="provider"><DocFlowLayout /></RouteGuard>}>
          <Route path="/" element={<Index />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/overview" element={<FinancialOverview />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:clientId" element={<Client />} />
          <Route path="/engagements/:engagementId" element={<Engagement />} />
          <Route path="/templates" element={<Templates />} />
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
);

export default App;
