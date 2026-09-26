import { Outlet } from 'react-router-dom';
import { JobProgressBanner } from '../job/JobProgressBanner';
import { Sidebar } from './Sidebar';

export function MainLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--nv-color-canvas)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* 自動生成の進み具合は、どの画面にいても上部に出す */}
        <JobProgressBanner />
        <Outlet />
      </main>
    </div>
  );
}
