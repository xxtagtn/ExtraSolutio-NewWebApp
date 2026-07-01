import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout/Layout.jsx';
import { useAuth } from './hooks/useAuth.jsx';
import Accounting from './pages/Accounting.jsx';
import Admin from './pages/Admin.jsx';
import Budgets from './pages/Budgets.jsx';
import Calendar from './pages/Calendar.jsx';
import Clients from './pages/Clients.jsx';
import Collaborators from './pages/Collaborators.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Login from './pages/Login.jsx';
import PendingActions from './pages/PendingActions.jsx';
import Profile from './pages/Profile.jsx';
import ServiceDetail from './pages/ServiceDetail.jsx';
import Services from './pages/Services.jsx';
import TimeValidation from './pages/TimeValidation.jsx';
import { BALANCETE_PATH, DEFAULT_AUTHENTICATED_PATH } from './utils/navigation.js';

function ProtectedRoute({ children }) {
  const { authenticated } = useAuth();
  return authenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to={DEFAULT_AUTHENTICATED_PATH} replace />} />
        <Route path="dashboard" element={<PendingActions />} />
        <Route path="actions" element={<Navigate to="/dashboard" replace />} />
        <Route path="collaborators" element={<Collaborators />} />
        <Route path="clients" element={<Clients />} />
        <Route path="services" element={<Services />} />
        <Route path="services/:serviceId" element={<ServiceDetail />} />
        <Route path="time-validation" element={<TimeValidation />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="finance" element={<Accounting />} />
        <Route path="accounting" element={<Navigate to="/finance" replace />} />
        <Route path={BALANCETE_PATH.replace(/^\//, '')} element={<Dashboard />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to={DEFAULT_AUTHENTICATED_PATH} replace />} />
    </Routes>
  );
}
