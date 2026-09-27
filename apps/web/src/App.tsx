import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AdminLayout from './pages/admin/AdminLayout';
import SetupWizardPage from './pages/setup/SetupWizardPage';
import { apiRequest } from './lib/api';
import { ConfigSaveProvider } from './lib/config-save-context';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // One-time first-run check: if no koris.json exists yet, send the user
  // into the setup wizard instead of letting the app boot on silent defaults.
  useEffect(() => {
    let cancelled = false;
    apiRequest<{ configured: boolean }>('/settings/status')
      .then((res) => {
        if (!cancelled && !res.configured && location.pathname !== '/setup') {
          navigate('/setup', { replace: true });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ConfigSaveProvider>
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/setup" element={<SetupWizardPage />} />
      <Route path="/admin/*" element={<AdminLayout />} />
    </Routes>
    </ConfigSaveProvider>
  );
}
