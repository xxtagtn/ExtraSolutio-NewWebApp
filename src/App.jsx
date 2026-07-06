import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout/Layout.jsx';
import { useAuth } from './hooks/useAuth.jsx';
import Login from './pages/Login.jsx';
import { BALANCETE_PATH, DEFAULT_AUTHENTICATED_PATH } from './utils/navigation.js';
import { PERMISSIONS, hasPermission } from './utils/accessPermissions.js';

const Accounting = lazy(() => import('./pages/Accounting.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Budgets = lazy(() => import('./pages/Budgets.jsx'));
const Calendar = lazy(() => import('./pages/Calendar.jsx'));
const Clients = lazy(() => import('./pages/Clients.jsx'));
const Collaborators = lazy(() => import('./pages/Collaborators.jsx'));
const Communication = lazy(() => import('./pages/Communication.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const PendingActions = lazy(() => import('./pages/PendingActions.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const QrCheck = lazy(() => import('./pages/QrCheck.jsx'));
const ServiceDetail = lazy(() => import('./pages/ServiceDetail.jsx'));
const Services = lazy(() => import('./pages/Services.jsx'));
const TimeValidation = lazy(() => import('./pages/TimeValidation.jsx'));

function ProtectedRoute({ children }) {
  const { authenticated } = useAuth();
  return authenticated ? children : <Navigate to="/login" replace />;
}

function AccessDenied() {
  return (
    <div className="page">
      <p className="notice">Sem permissões para aceder a esta página.</p>
    </div>
  );
}

function RequirePermission({ permission, children }) {
  const { user } = useAuth();
  return hasPermission(user, permission) ? children : <AccessDenied />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="route-loading">A carregar...</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/qr/:token" element={<QrCheck />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to={DEFAULT_AUTHENTICATED_PATH} replace />} />
          <Route path="dashboard" element={<RequirePermission permission={PERMISSIONS.DASHBOARD_VIEW}><PendingActions /></RequirePermission>} />
          <Route path="actions" element={<Navigate to="/dashboard" replace />} />
          <Route path="collaborators" element={<RequirePermission permission={PERMISSIONS.COLLABORATORS_VIEW}><Collaborators /></RequirePermission>} />
          <Route path="clients" element={<RequirePermission permission={PERMISSIONS.CLIENTS_VIEW}><Clients /></RequirePermission>} />
          <Route path="services" element={<RequirePermission permission={PERMISSIONS.SERVICES_VIEW}><Services /></RequirePermission>} />
          <Route path="services/:serviceId" element={<RequirePermission permission={PERMISSIONS.SERVICES_VIEW}><ServiceDetail /></RequirePermission>} />
          <Route path="communication" element={<RequirePermission permission={PERMISSIONS.COMMUNICATION_VIEW}><Communication /></RequirePermission>} />
          <Route path="time-validation" element={<RequirePermission permission={PERMISSIONS.TIME_VALIDATION_VIEW}><TimeValidation /></RequirePermission>} />
          <Route path="calendar" element={<RequirePermission permission={PERMISSIONS.CALENDAR_VIEW}><Calendar /></RequirePermission>} />
          <Route path="budgets" element={<RequirePermission permission={PERMISSIONS.BUDGETS_VIEW}><Budgets /></RequirePermission>} />
          <Route path="finance" element={<RequirePermission permission={PERMISSIONS.FINANCE_VIEW}><Accounting /></RequirePermission>} />
          <Route path="accounting" element={<Navigate to="/finance" replace />} />
          <Route path={BALANCETE_PATH.replace(/^\//, '')} element={<RequirePermission permission={PERMISSIONS.BALANCETE_VIEW}><Dashboard /></RequirePermission>} />
          <Route path="profile" element={<Profile />} />
          <Route path="admin" element={<RequirePermission permission={PERMISSIONS.ADMIN_VIEW}><Admin /></RequirePermission>} />
        </Route>
        <Route path="*" element={<Navigate to={DEFAULT_AUTHENTICATED_PATH} replace />} />
      </Routes>
    </Suspense>
  );
}
