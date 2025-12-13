import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState, type ReactNode } from 'react';
import type { ImageAsset, ImageAssetRef } from '../../schemas';
import { ImageCard } from './ImageCard';

const ASSIGNED_CONTAINER_ID = 'assigned-container';
const CANDIDATE_CONTAINER_ID = 'candidate-container';

const assignedItemId = (imageId: string) => `assigned:${imageId}`;
const candidateItemId = (imageId: string) => `candidate:${imageId}`;

function upsertPanelImages(
  refs: ImageAssetRef[],
  imageId: string,
  index: number
): ImageAssetRef[] {
  const existingIndex = refs.findIndex((r) => r.imageId === imageId);
  const existingRef: ImageAssetRef = existingIndex >= 0 ? refs[existingIndex] : { imageId };
  const without = existingIndex >= 0 ? refs.filter((r) => r.imageId !== imageId) : refs;
  const clampedIndex = Math.min(Math.max(index, 0), without.length);
  return [
    ...without.slice(0, clampedIndex),
    existingRef,
    ...without.slice(clampedIndex),
  ];
}

function removePanelImage(refs: ImageAssetRef[], imageId: string): ImageAssetRef[] {
  return refs.filter((r) => r.imageId !== imageId);
}

function isSameRefs(a: ImageAssetRef[], b: ImageAssetRef[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.imageId !== b[i]?.imageId) return false;
    if (a[i]?.displayDurationSec !== b[i]?.displayDurationSec) return false;
  }
  return true;
}

interface ImageAssignmentProps {
  panelImages: ImageAssetRef[];
  candidateImages: ImageAsset[];
  getImageById: (imageId: string) => ImageAsset | undefined;
  onChange: (next: ImageAssetRef[]) => void;
  onDeleteImage?: (imageId: string) => void;
}

interface DndItemData {
  type: 'candidate' | 'assigned';
  imageId: string;
}

function DropZone({
  id,
  children,
  isEmpty,
  emptyMessage,
}: {
  id: string;
  children: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border-2 border-dashed transition-colors ${
        isOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      {isEmpty ? (
        <div className="p-8 text-center text-sm text-gray-500">
          {emptyMessage || 'ここにドラッグ&ドロップ'}
        </div>
      ) : (
        <div className="p-4">{children}</div>
      )}
    </div>
  );
}

function SortableAssignedCard({
  imageId,
  image,
  isSelected,
  onRemove,
}: {
  imageId: string;
  image: ImageAsset | undefined;
  isSelected: boolean;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: assignedItemId(imageId),
    data: { type: 'assigned', imageId } satisfies DndItemData,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'z-50' : undefined}>
      {image ? (
        <div className="relative">
          <ImageCard
            image={image}
            isSelected={isSelected}
            onDelete={onRemove}
            isDraggable
          />
          <button
            className="absolute bottom-3 left-3 p-1.5 bg-white/90 text-gray-700 rounded-md shadow-sm hover:bg-white"
            title="ドラッグして順序を変更"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="relative rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-sm font-medium text-red-700">画像が見つかりません</div>
          <div className="text-xs text-red-600 mt-1 break-all">ID: {imageId}</div>
          <button
            onClick={onRemove}
            className="mt-3 px-3 py-1.5 text-sm bg-white text-red-700 border border-red-200 rounded-md hover:bg-red-50"
          >
            割り当て解除
          </button>
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  image,
  isAssigned,
  onClickAssign,
  onDelete,
}: {
  image: ImageAsset;
  isAssigned: boolean;
  onClickAssign: () => void;
  onDelete?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: candidateItemId(image.id),
    data: { type: 'candidate', imageId: image.id } satisfies DndItemData,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ImageCard
        image={image}
        isSelected={isAssigned}
        onSelect={onClickAssign}
        onDelete={onDelete}
        isDraggable
      />
    </div>
  );
}

export function ImageAssignment({
  panelImages,
  candidateImages,
  getImageById,
  onChange,
  onDeleteImage,
}: ImageAssignmentProps) {
  const [activeImageId, setActiveImageId] = useState<string | null>(null);

  const assignedIds = useMemo(
    () => panelImages.map((r) => r.imageId),
    [panelImages]
  );

  const uniqueCandidates = useMemo(() => {
    const seen = new Set<string>();
    const result: ImageAsset[] = [];
    for (const image of candidateImages) {
      if (seen.has(image.id)) continue;
      seen.add(image.id);
      result.push(image);
    }
    return result;
  }, [candidateImages]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DndItemData | undefined;
    setActiveImageId(data?.imageId ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveImageId(null);

    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as DndItemData | undefined;
    if (!activeData) return;

    const overId = String(over.id);
    const isOverAssignedContainer = overId === ASSIGNED_CONTAINER_ID;
    const isOverCandidateContainer = overId === CANDIDATE_CONTAINER_ID;
    const isOverAssignedItem = overId.startsWith('assigned:');

    const targetAssignedImageId = isOverAssignedItem ? overId.replace('assigned:', '') : null;
    const targetIndex =
      targetAssignedImageId != null ? assignedIds.indexOf(targetAssignedImageId) : assignedIds.length;

    if (activeData.type === 'candidate') {
      if (!isOverAssignedContainer && !isOverAssignedItem) return;
      const next = upsertPanelImages(panelImages, activeData.imageId, targetIndex);
      if (!isSameRefs(panelImages, next)) onChange(next);
      return;
    }

    // assigned -> candidate: remove
    if (activeData.type === 'assigned' && isOverCandidateContainer) {
      const next = removePanelImage(panelImages, activeData.imageId);
      if (!isSameRefs(panelImages, next)) onChange(next);
      return;
    }

    // assigned -> assigned: reorder
    if (activeData.type === 'assigned' && (isOverAssignedItem || isOverAssignedContainer)) {
      const oldIndex = assignedIds.indexOf(activeData.imageId);
      const newIndex = isOverAssignedContainer ? Math.max(panelImages.length - 1, 0) : targetIndex;

      if (oldIndex < 0 || newIndex < 0) return;
      if (oldIndex === newIndex) return;

      const next = arrayMove(panelImages, oldIndex, newIndex);
      if (!isSameRefs(panelImages, next)) onChange(next);
    }
  };

  const overlayImage = activeImageId ? getImageById(activeImageId) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">画像の割り当て</h3>
          <p className="text-sm text-gray-500">
            候補画像からドラッグして追加、並べ替え、または「割り当て解除」で外せます
          </p>
        </div>
        <div className="text-sm text-gray-600">
          使用中: <span className="font-medium">{panelImages.length}</span> 枚
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveImageId(null)}
      >
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Assigned */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">使用画像</h4>
              <span className="text-xs text-gray-500">並べ替え可</span>
            </div>

            <DropZone
              id={ASSIGNED_CONTAINER_ID}
              isEmpty={panelImages.length === 0}
              emptyMessage="候補画像をここにドラッグして割り当て"
            >
              <SortableContext
                items={assignedIds.map((id) => assignedItemId(id))}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {panelImages.map((ref) => (
                    <SortableAssignedCard
                      key={ref.imageId}
                      imageId={ref.imageId}
                      image={getImageById(ref.imageId)}
                      isSelected
                      onRemove={() => onChange(removePanelImage(panelImages, ref.imageId))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DropZone>
          </div>

          {/* Candidate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">候補画像</h4>
              <span className="text-xs text-gray-500">
                クリックでも追加できます
              </span>
            </div>

            <DropZone
              id={CANDIDATE_CONTAINER_ID}
              isEmpty={uniqueCandidates.length === 0}
              emptyMessage="候補画像がありません（先に画像を生成/インポートしてください）"
            >
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {uniqueCandidates.map((image) => (
                  <CandidateCard
                    key={image.id}
                    image={image}
                    isAssigned={assignedIds.includes(image.id)}
                    onClickAssign={() => {
                      if (assignedIds.includes(image.id)) return;
                      onChange(upsertPanelImages(panelImages, image.id, panelImages.length));
                    }}
                    onDelete={onDeleteImage ? () => onDeleteImage(image.id) : undefined}
                  />
                ))}
              </div>
            </DropZone>
          </div>
        </div>

        <DragOverlay>
          {overlayImage ? (
            <div className="w-56">
              <ImageCard image={overlayImage} isSelected isDraggable />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
