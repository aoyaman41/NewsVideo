import { Suspense, lazy, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout';
import { JobNotifier } from './components/job/JobNotifier';
import { OnboardingGate } from './components/onboarding/OnboardingGate';
import { FeedbackProvider } from './components/ui';
import { ensureGenerationPreferencesMigrated } from './stores/generationPreferences';

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
const WelcomePage = lazy(async () => ({
  default: (await import('./components/onboarding/WelcomePage')).WelcomePage,
}));

function App() {
  // 以前の版が画面側(localStorage)に覚えていた進め方と予算を、起動後に 1 回だけ設定へ移す
  useEffect(() => {
    void ensureGenerationPreferencesMigrated();
  }, []);

  return (
    <HashRouter>
      <FeedbackProvider>
        <OnboardingGate />
        <JobNotifier />
        <Suspense
          fallback={
            <div className="p-6 text-sm text-[var(--nv-color-muted)]">ページを読み込み中...</div>
          }
        >
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/welcome" element={<WelcomePage />} />
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
      </FeedbackProvider>
    </HashRouter>
  );
}

export default App;
