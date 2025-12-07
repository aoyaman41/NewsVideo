import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout';
import { ProjectListPage } from './pages/ProjectListPage';
import { SettingsPage } from './pages/SettingsPage';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route element={<MainLayout />}>
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
