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
import { Badge, Button, StatusChip, useConfirm } from '../ui';
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: part.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group relative cursor-pointer rounded-[10px] border transition-colors ${
        isSelected
          ? 'border-[var(--nv-color-accent)] bg-blue-50 shadow-[var(--nv-shadow-sm)]'
          : 'border-[var(--nv-color-border)] bg-white hover:bg-slate-50'
      } ${isDragging ? 'z-50 shadow-[var(--nv-shadow-md)]' : ''}`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3 p-3">
        <button
          className="mt-0.5 rounded-[8px] p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 cursor-grab active:cursor-grabbing touch-none"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label="並び替え"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge tone={isSelected ? 'info' : 'neutral'}>{index + 1}</Badge>
            <h4 className="truncate text-sm font-semibold text-slate-900">{part.title}</h4>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">
            {part.summary || part.scriptText.substring(0, 50) + '...'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{formatDuration(part.durationEstimateSec)}</Badge>
            {part.scriptModifiedByUser && (
              <StatusChip tone="warning" label="編集済み" />
            )}
          </div>
        </div>

        <button
          onClick={async (e) => {
            e.stopPropagation();
            await onDelete();
          }}
          className="rounded-[8px] p-1 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
          title="削除"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
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
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--nv-color-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">パート一覧</h3>
            <p className="mt-1 text-xs text-slate-500">
              {parts.length} パート / 合計{' '}
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

      <div className="nv-scrollbar flex-1 overflow-auto p-3">
        {parts.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-[var(--nv-color-border)] p-6 text-center text-sm text-slate-500">
            パートがありません
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={parts.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-2">
                {parts.map((part, index) => (
                  <SortablePartItem
                    key={part.id}
                    part={part}
                    index={index}
                    isSelected={selectedPartId === part.id}
                    onSelect={() => onSelectPart(part.id)}
                    onDelete={async () => {
                      const accepted = await confirm({
                        title: 'パートを削除しますか？',
                        description: `「${part.title}」を削除します。関連する原稿と設定もこの一覧から外れます。`,
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
