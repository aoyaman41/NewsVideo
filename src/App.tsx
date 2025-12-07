import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout';
import { ProjectListPage } from './pages/ProjectListPage';
import { SettingsPage } from './pages/SettingsPage';
import { ArticleInputPage } from './pages/ArticleInputPage';
import { ScriptEditPage } from './pages/ScriptEditPage';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route element={<MainLayout />}>
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/:projectId/article" element={<ArticleInputPage />} />
          <Route path="/projects/:projectId/script" element={<ScriptEditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
