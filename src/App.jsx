import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout/Layout.jsx';
import { useAuth } from './hooks/useAuth.jsx';
import Login from './pages/Login.jsx';
import { BALANCETE_PATH, DEFAULT_AUTHENTICATED_PATH } from './utils/navigation.js';
import { canAccessRole, ROLE_GROUPS, ROLES } from './utils/roles.js';

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
const ServiceDetail = lazy(() => import('./pages/ServiceDetail.jsx'));
const Services = lazy(() => import('./pages/Services.jsx'));
const TimeValidation = lazy(() => import('./pages/TimeValidation.jsx'));

function ProtectedRoute({ children }) {
  const { authenticated } = useAuth();
  return authenticated ? children : <Navigate to="/login" replace />;
}

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  return canAccessRole(user, roles) ? children : <Navigate to={DEFAULT_AUTHENTICATED_PATH} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="route-loading">A carregar...</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to={DEFAULT_AUTHENTICATED_PATH} replace />} />
          <Route path="dashboard" element={<PendingActions />} />
          <Route path="actions" element={<Navigate to="/dashboard" replace />} />
          <Route path="collaborators" element={<Collaborators />} />
          <Route path="clients" element={<RequireRole roles={ROLE_GROUPS.finance}><Clients /></RequireRole>} />
          <Route path="services" element={<RequireRole roles={ROLE_GROUPS.operations}><Services /></RequireRole>} />
          <Route path="services/:serviceId" element={<RequireRole roles={ROLE_GROUPS.operations}><ServiceDetail /></RequireRole>} />
          <Route path="communication" element={<RequireRole roles={ROLE_GROUPS.operations}><Communication /></RequireRole>} />
          <Route path="time-validation" element={<RequireRole roles={ROLE_GROUPS.operations}><TimeValidation /></RequireRole>} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="budgets" element={<RequireRole roles={ROLE_GROUPS.commercial}><Budgets /></RequireRole>} />
          <Route path="finance" element={<RequireRole roles={ROLE_GROUPS.finance}><Accounting /></RequireRole>} />
          <Route path="accounting" element={<Navigate to="/finance" replace />} />
          <Route path={BALANCETE_PATH.replace(/^\//, '')} element={<RequireRole roles={ROLE_GROUPS.finance}><Dashboard /></RequireRole>} />
          <Route path="profile" element={<Profile />} />
          <Route path="admin" element={<RequireRole roles={[ROLES.ADMIN]}><Admin /></RequireRole>} />
        </Route>
        <Route path="*" element={<Navigate to={DEFAULT_AUTHENTICATED_PATH} replace />} />
      </Routes>
    </Suspense>
  );
}
