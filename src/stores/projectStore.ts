import { useCallback, useSyncExternalStore } from 'react';
import type { Project } from '../schemas';

type Entry = {
  project: Project | null;
  saved: Project | null;
  saving: boolean;
  error: string | null;
  lastSavedAt: string | null;
};
const empty: Entry = { project: null, saved: null, saving: false, error: null, lastSavedAt: null };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, Promise<void>>();
const read = (id: string) => entries.get(id) ?? empty;
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const comparable = (project: Project | null) =>
  JSON.stringify(project && { ...project, revision: 0, updatedAt: '' });

function update(id: string, project: Project | null) {
  const previous = read(id);
  if (project === previous.project) return;
  // A view may hold an older revision after an awaited generation request. Never silently overwrite it.
  if (project && previous.project && (project.revision ?? 0) < (previous.project.revision ?? 0)) {
    const isSameContent = comparable(project) === comparable(previous.project);
    if (isSameContent) return;
    entries.set(id, {
      ...previous,
      error: '保存後に古い画面データが返されました。現在の編集を維持しています。',
    });
    notify();
    return;
  }
  entries.set(id, { ...previous, project });
  notify();
  if (project && comparable(project) !== comparable(previous.saved)) {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        void flush(id).catch(() => {});
      }, 400)
    );
  }
}

async function flush(id: string): Promise<void> {
  clearTimeout(timers.get(id));
  const running = pending.get(id);
  if (running) {
    await running;
    return flush(id);
  }
  const state = read(id);
  if (!state.project || comparable(state.project) === comparable(state.saved)) return;
  const requested = state.project;
  entries.set(id, { ...state, saving: true, error: null });
  notify();
  const operation = (async () => {
    try {
      const result = await window.electronAPI.project.save(requested);
      const latest = read(id);
      // Preserve keystrokes entered while the IPC write was in flight.
      const project =
        latest.project === requested
          ? result.project
          : latest.project && {
              ...latest.project,
              revision: result.revision,
              updatedAt: result.savedAt,
            };
      requested.revision = result.revision;
      entries.set(id, {
        ...latest,
        project,
        saved: result.project,
        saving: false,
        error: null,
        lastSavedAt: result.savedAt,
      });
    } catch (error) {
      entries.set(id, {
        ...read(id),
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      notify();
    }
  })();
  pending.set(id, operation);
  try {
    await operation;
  } finally {
    pending.delete(id);
  }
  if (comparable(read(id).project) !== comparable(read(id).saved)) await flush(id);
}

export const projectClient = {
  async load(id: string): Promise<Project> {
    if (read(id).project) return read(id).project!;
    const project = await window.electronAPI.project.load(id);
    // A second concurrent reader must not replace edits made after the first response.
    if (!read(id).project) {
      entries.set(id, {
        ...empty,
        project,
        saved: structuredClone(project),
        lastSavedAt: project.updatedAt,
      });
      notify();
    }
    return read(id).project!;
  },
  async save(project: Project) {
    const state = read(project.id);
    if (
      state.project &&
      project !== state.project &&
      (project.revision ?? 0) < (state.project.revision ?? 0)
    ) {
      if (comparable(project) === comparable(state.project)) return;
      throw new Error('保存の競合を検出しました。現在の編集を保全しました。');
    }
    update(project.id, project);
    await flush(project.id);
    project.revision = read(project.id).project?.revision;
  },
  flush,
  async flushAll() {
    await Promise.all([...entries.keys()].map(flush));
  },
};

export function useProjectState(id: string | undefined) {
  const state = useSyncExternalStore(subscribe, () => read(id ?? ''));
  const setProject = useCallback(
    (value: Project | null | ((previous: Project | null) => Project | null)) => {
      if (id) update(id, typeof value === 'function' ? value(read(id).project) : value);
    },
    [id]
  );
  return [state.project, setProject] as const;
}

export function useProjectSaveStatus(id: string | undefined) {
  const state = useSyncExternalStore(subscribe, () => read(id ?? ''));
  return {
    ...state,
    dirty: comparable(state.project) !== comparable(state.saved),
    retry: () => (id ? flush(id) : Promise.resolve()),
  };
}

export function initializeProjectEvents() {
  return window.electronAPI.project.onChanged(async ({ id, revision }) => {
    const state = read(id);
    if (!state.project || pending.has(id) || revision === state.project.revision) return;
    if (comparable(state.project) !== comparable(state.saved)) return;
    try {
      const project = await window.electronAPI.project.load(id);
      const latest = read(id);
      if (comparable(latest.project) === comparable(latest.saved) && !pending.has(id)) {
        entries.set(id, {
          ...latest,
          project,
          saved: structuredClone(project),
          lastSavedAt: project.updatedAt,
        });
        notify();
      }
    } catch (error) {
      entries.set(id, { ...read(id), error: String(error) });
      notify();
    }
  });
}
