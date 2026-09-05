import type { Project } from './schema';

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function mergeProjectDraft(base: Project, draft: Project, remote: Project) {
  const conflicts: string[] = [];
  function merge(previous: unknown, local: unknown, latest: unknown, key: string): unknown {
    if (equal(local, previous)) return latest;
    if (equal(latest, previous) || equal(local, latest)) return local;
    if (
      Array.isArray(local) &&
      Array.isArray(latest) &&
      Array.isArray(previous) &&
      [...local, ...latest, ...previous].every(
        (item) => item && typeof item === 'object' && typeof item.id === 'string'
      )
    ) {
      const map = (items: Array<{ id: string }>) => new Map(items.map((item) => [item.id, item]));
      const oldMap = map(previous);
      const localMap = map(local);
      const remoteMap = map(latest);
      const oldOrder = previous.map((item) => item.id);
      const localOrder = local.map((item) => item.id);
      const remoteOrder = latest.map((item) => item.id);
      if (
        !equal(localOrder, oldOrder) &&
        !equal(remoteOrder, oldOrder) &&
        !equal(localOrder, remoteOrder)
      )
        conflicts.push(`${key}.order`);
      const primaryOrder = equal(localOrder, oldOrder) ? remoteOrder : localOrder;
      const order = [...new Set([...primaryOrder, ...remoteOrder, ...oldOrder])];
      return order
        .map((id) => merge(oldMap.get(id), localMap.get(id), remoteMap.get(id), `${key}[${id}]`))
        .filter((value) => value !== undefined);
    }
    if (
      local &&
      latest &&
      typeof local === 'object' &&
      typeof latest === 'object' &&
      !Array.isArray(local) &&
      !Array.isArray(latest)
    ) {
      const old = (previous ?? {}) as Record<string, unknown>;
      const left = local as Record<string, unknown>;
      const right = latest as Record<string, unknown>;
      return Object.fromEntries(
        [...new Set([...Object.keys(old), ...Object.keys(left), ...Object.keys(right)])]
          .map((field) => [field, merge(old[field], left[field], right[field], `${key}.${field}`)])
          .filter(([, value]) => value !== undefined)
      );
    }
    conflicts.push(key);
    return local;
  }
  const project = merge(base, draft, remote, 'project') as Project;
  project.revision = remote.revision;
  project.updatedAt = remote.updatedAt;
  return {
    project,
    conflicts: conflicts.filter(
      (field) => !['project.revision', 'project.updatedAt'].includes(field)
    ),
  };
}
