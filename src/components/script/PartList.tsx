import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge, Button, useConfirm } from '../ui';
import type { Part } from '../../schemas';

interface PartListProps {
  parts: Part[];
  selectedPartId: string | null;
  onSelectPart: (partId: string) => void;
  onAddPart: () => void;
  onDeletePart: (partId: string) => Promise<void> | void;
  onReorderParts: (fromIndex: number, toIndex: number) => void;
}

interface SortablePartItemProps {
  part: Part;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  formatDuration: (seconds: number) => string;
}

function SortablePartItem({
  part,
  index,
  isSelected,
  onSelect,
  onDelete,
  formatDuration,
}: SortablePartItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: part.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`nv-focus-ring group relative cursor-pointer rounded-[var(--nv-radius-sm)] border transition-colors ${
        isSelected
          ? 'border-[var(--nv-color-accent)] bg-[var(--nv-color-accent)]/10'
          : 'border-transparent hover:border-[var(--nv-color-border)] hover:bg-[var(--nv-color-canvas)]'
      } ${isDragging ? 'z-50 bg-white shadow-[var(--nv-shadow-md)]' : ''}`}
      onClick={onSelect}
      tabIndex={0}
      aria-current={isSelected ? 'true' : undefined}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="flex items-start gap-2 px-2 py-2">
        <button
          type="button"
          className="nv-focus-ring mt-0.5 cursor-grab touch-none rounded-[var(--nv-radius-sm)] p-1 text-[var(--nv-color-muted)] transition-colors hover:bg-[var(--nv-color-canvas)] active:cursor-grabbing"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label={`シーン ${index + 1} を並べ替える(スペースキーで持ち上げ、矢印キーで移動)`}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-xs font-semibold text-[var(--nv-color-muted)] tabular-nums">
              {index + 1}
            </span>
            <h4 className="truncate text-sm font-semibold text-[var(--nv-color-text)]">
              {part.title || '(見出しなし)'}
            </h4>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-[var(--nv-color-muted)]">
            {part.summary || part.scriptText.slice(0, 50) || '台本が空です'}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge tone="neutral">{formatDuration(part.durationEstimateSec)}</Badge>
            {part.scriptModifiedByUser && <Badge tone="info">手直し済み</Badge>}
          </div>
        </div>

        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation();
            await onDelete();
          }}
          className="nv-focus-ring rounded-[var(--nv-radius-sm)] p-1 text-[var(--nv-color-muted)] transition-colors hover:bg-[var(--nv-color-danger)]/10 hover:text-[var(--nv-color-danger)]"
          title="シーンを削除"
          aria-label={`シーン ${index + 1}「${part.title}」を削除`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </li>
  );
}

export function PartList({
  parts,
  selectedPartId,
  onSelectPart,
  onAddPart,
  onDeletePart,
  onReorderParts,
}: PartListProps) {
  const { confirm } = useConfirm();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = parts.findIndex((p) => p.id === active.id);
      const newIndex = parts.findIndex((p) => p.id === over.id);
      onReorderParts(oldIndex, newIndex);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--nv-color-border)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--nv-color-text)]">シーン</h3>
            <p className="nv-help mt-0.5">
              {parts.length} シーン・約{' '}
              {formatDuration(parts.reduce((sum, p) => sum + p.durationEstimateSec, 0))}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={onAddPart}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            追加
          </Button>
        </div>
      </div>

      <div className="nv-scrollbar min-h-0 flex-1 overflow-auto p-2">
        {parts.length === 0 ? (
          <div className="rounded-[var(--nv-radius-sm)] border border-dashed border-[var(--nv-color-border)] p-6 text-center text-sm text-[var(--nv-color-muted)]">
            シーンがありません。「追加」から作れます。
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={parts.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {parts.map((part, index) => (
                  <SortablePartItem
                    key={part.id}
                    part={part}
                    index={index}
                    isSelected={selectedPartId === part.id}
                    onSelect={() => onSelectPart(part.id)}
                    onDelete={async () => {
                      const accepted = await confirm({
                        title: 'シーンを削除しますか?',
                        description: `「${part.title}」を削除します。このシーンの台本と、画像・音声の割り当てが外れます。`,
                        confirmLabel: '削除',
                        confirmVariant: 'danger',
                      });
                      if (!accepted) return;
                      await onDeletePart(part.id);
                    }}
                    formatDuration={formatDuration}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
