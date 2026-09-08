import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import DocFlowLayout from "@/components/docflow/Layout";
import ClientLayout from "@/components/docflow/ClientLayout";
import { MfaGate, RouteGuard } from "@/components/RouteGuard";
import { lazy } from "react";

/**
 * The way in stays eager (H4).
 *
 * Signing in is the one thing every visit does and the one thing that must not
 * wait on a second round trip, so the auth screens and the two error pages are
 * part of the first chunk. Everything behind the guards is split: an advisor
 * never loads the portal's code, a client never loads the advisor's, and
 * neither pays for the review workspace until they open it. The layouts put a
 * `<Suspense>` around their `<Outlet />`, so the nav is already on screen while
 * a page arrives.
 */
import Login from "./pages/Login";
import Mfa from "./pages/Mfa";
import MfaEnroll from "./pages/MfaEnroll";
import Invite from "./pages/Invite";
import Forgot from "./pages/Forgot";
import Reset from "./pages/Reset";
import NotFound from "./pages/NotFound";

const Index = lazy(() => import("./pages/Index"));
const Settings = lazy(() => import("./pages/Settings"));
const SystemStatus = lazy(() => import("./pages/SystemStatus"));
const Client = lazy(() => import("./pages/Client"));
const Clients = lazy(() => import("./pages/Clients"));
const Engagement = lazy(() => import("./pages/Engagement"));
const Templates = lazy(() => import("./pages/Templates"));
const Review = lazy(() => import("./pages/Review"));
const Work = lazy(() => import("./pages/Work"));
const DocumentsPage = lazy(() => import("./pages/Documents"));
const DocumentPage = lazy(() => import("./pages/Document"));
const PortalHome = lazy(() => import("./pages/portal/Home"));
const PortalRequests = lazy(() => import("./pages/portal/Requests"));
const PortalDocuments = lazy(() => import("./pages/portal/Documents"));
const PortalShared = lazy(() => import("./pages/portal/Shared"));
const PortalMessages = lazy(() => import("./pages/portal/Messages"));
const PortalSecurity = lazy(() => import("./pages/portal/Security"));

const App = () => (
  <TooltipProvider>
    <Toaster />
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
          <Route path="/work" element={<Work />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/system" element={<SystemStatus />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:clientId" element={<Client />} />
          <Route path="/engagements/:engagementId" element={<Engagement />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/review/:documentId" element={<Review />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:documentId" element={<DocumentPage />} />
        </Route>

        <Route element={<RouteGuard kind="client"><ClientLayout /></RouteGuard>}>
          <Route path="/portal" element={<PortalHome />} />
          <Route path="/portal/requests" element={<PortalRequests />} />
          <Route path="/portal/documents" element={<PortalDocuments />} />
          <Route path="/portal/shared" element={<PortalShared />} />
          <Route path="/portal/messages" element={<PortalMessages />} />
          <Route path="/portal/security" element={<PortalSecurity />} />
          {/* The portal used to live under the client's own id; keep those links working. */}
          <Route path="/client/:clientId" element={<Navigate to="/portal" replace />} />
        </Route>

        <Route element={<DocFlowLayout />}>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
