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
import type { Part } from '../../schemas';

interface PartListProps {
  parts: Part[];
  selectedPartId: string | null;
  onSelectPart: (partId: string) => void;
  onAddPart: () => void;
  onDeletePart: (partId: string) => void;
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
      className={`group relative cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue-50 border-l-4 border-blue-600'
          : 'hover:bg-gray-50 border-l-4 border-transparent'
      } ${isDragging ? 'z-50 shadow-lg' : ''}`}
      onClick={onSelect}
    >
      <div className="p-3 flex items-start gap-2">
        {/* ドラッグハンドル */}
        <button
          className="mt-1 p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing touch-none"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">
              {index + 1}
            </span>
            <h4 className="text-sm font-medium text-gray-900 truncate">
              {part.title}
            </h4>
          </div>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
            {part.summary || part.scriptText.substring(0, 50) + '...'}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-400">
              {formatDuration(part.durationEstimateSec)}
            </span>
            {part.scriptModifiedByUser && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-1 rounded">
                編集済み
              </span>
            )}
          </div>
        </div>

        {/* 削除ボタン */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`パート「${part.title}」を削除しますか？`)) {
              onDelete();
            }
          }}
          className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
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
      {/* ヘッダー */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">パート一覧</h3>
          <button
            onClick={onAddPart}
            className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="パートを追加"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {parts.length} パート / 合計{' '}
          {formatDuration(parts.reduce((sum, p) => sum + p.durationEstimateSec, 0))}
        </p>
      </div>

      {/* パートリスト */}
      <div className="flex-1 overflow-auto">
        {parts.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
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
              <ul className="divide-y divide-gray-200">
                {parts.map((part, index) => (
                  <SortablePartItem
                    key={part.id}
                    part={part}
                    index={index}
                    isSelected={selectedPartId === part.id}
                    onSelect={() => onSelectPart(part.id)}
                    onDelete={() => onDeletePart(part.id)}
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
