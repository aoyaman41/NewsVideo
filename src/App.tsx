import { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout';

const ProjectListPage = lazy(async () => ({
  default: (await import('./pages/ProjectListPage')).ProjectListPage,
}));
const SettingsPage = lazy(async () => ({
  default: (await import('./pages/SettingsPage')).SettingsPage,
}));
const ArticleInputPage = lazy(async () => ({
  default: (await import('./pages/ArticleInputPage')).ArticleInputPage,
}));
const ScriptEditPage = lazy(async () => ({
  default: (await import('./pages/ScriptEditPage')).ScriptEditPage,
}));
const ImageManagePage = lazy(async () => ({
  default: (await import('./pages/ImageManagePage')).ImageManagePage,
}));
const AudioManagePage = lazy(async () => ({
  default: (await import('./pages/AudioManagePage')).AudioManagePage,
}));
const VideoManagePage = lazy(async () => ({
  default: (await import('./pages/VideoManagePage')).VideoManagePage,
}));

function App() {
  return (
    <HashRouter>
      <Suspense fallback={<div className="p-6 text-sm text-slate-500">ページを読み込み中...</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route element={<MainLayout />}>
            <Route path="/projects" element={<ProjectListPage />} />
            <Route path="/projects/:projectId/article" element={<ArticleInputPage />} />
            <Route path="/projects/:projectId/script" element={<ScriptEditPage />} />
            <Route path="/projects/:projectId/image" element={<ImageManagePage />} />
            <Route path="/projects/:projectId/audio" element={<AudioManagePage />} />
            <Route path="/projects/:projectId/video" element={<VideoManagePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}

export default App;
