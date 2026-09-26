import { useScrollMemory } from '../hooks/useScrollMemory';
import { useSceneSelection, rememberedScene } from '../stores/sceneSelection';
import { projectClient, useProjectState } from '../stores/projectStore';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header, WorkflowNav } from '../components/layout';
import { ImageGallery, SceneImages } from '../components/image';
import type { SlotTarget } from '../components/image/panelSlots';
import { normalizeTarget, placeImage } from '../components/image/panelSlots';
import {
  Badge,
  Button,
  Card,
  Details,
  EmptyState,
  ProgressBar,
  useConfirm,
  useToast,
} from '../components/ui';
import { SceneList } from '../components/common/SceneList';
import { StaleNotice } from '../components/common/StaleNotice';
import { ErrorNotice } from '../components/common/ErrorNotice';
import {
  describeError,
  describeFailures,
  type FriendlyError,
} from '../components/common/friendlyError';
import { JOB_ACTIVE_MESSAGE, useJobActive } from '../components/common/useJobActive';
import { useProjectCommit } from '../components/common/useProjectCommit';
import { runLimited } from '../components/common/runLimited';
import type { Project, ImageAssetRef, ImagePrompt, Part } from '../schemas';
import { createGeminiImageUsageRecordFromAssets, createOpenAIUsageRecord } from '../utils/usage';
import { partFreshness } from '../../shared/project/integrity';
import {
  IMAGE_ASPECT_RATIO_LABELS,
  IMAGE_STYLE_PRESET_LABELS,
} from '../../shared/project/imageStylePresets';

type BatchState = { phase: 'prompt' | 'image'; done: number; total: number };

function latestPromptFor(project: Project, partId: string): ImagePrompt | undefined {
  let latest: ImagePrompt | undefined;
  for (const prompt of project.prompts) {
    if (prompt.partId !== partId) continue;
    if (!latest || prompt.createdAt >= latest.createdAt) latest = prompt;
  }
  return latest;
}

function styleOptions(project: Project) {
  return {
    stylePreset: project.presentationProfile.imageStylePreset,
    aspectRatio: project.presentationProfile.aspectRatio,
    styleReferenceImageIds: project.presentationProfile.styleReferenceImageIds,
    styleReferenceNote: project.presentationProfile.styleReferenceNote,
  };
}

function needsPrompt(project: Project, part: Part): boolean {
  return !latestPromptFor(project, part.id) || partFreshness(project, part).prompt !== 'current';
}

/** 作り始めたときと比べて、台本か画像の並びが変わったか(変わったら、できた画像は候補に足すだけにする) */
function sceneSnapshot(part: Part): string {
  return JSON.stringify({ script: part.scriptText, images: part.panelImages });
}

function appendUsage(project: Project, record: Project['usage'][number] | null) {
  return record ? [...(project.usage ?? []), record] : (project.usage ?? []);
}

export function ImageManagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();

  const [project, setProject] = useProjectState(projectId);
  const [selectedPartId, setSelectedPartId] = useSceneSelection(projectId);
  const scrollRef = useScrollMemory(`${projectId}:ImageManagePage`);
  const commit = useProjectCommit(projectId);
  const jobActive = useJobActive(projectId, project);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState<{ partId: string; label: string } | null>(null);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const batchCancelRef = useRef(false);
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [target, setTarget] = useState<{ partId: string; slot: SlotTarget } | null>(null);

  const reportError = useCallback(
    (err: unknown, title: string) => {
      console.error(title, err);
      const friendly = describeError(err, title);
      setError(friendly);
      toast.error(friendly.message, friendly.title);
    },
    [toast]
  );

  useEffect(() => {
    const loadProject = async () => {
      if (!projectId) return;
      try {
        setIsLoading(true);
        const loadedProject = await projectClient.load(projectId);
        setProject(loadedProject);
        if (loadedProject.parts.length > 0) {
          setSelectedPartId(rememberedScene(projectId, loadedProject.parts));
        }
      } catch (err) {
        console.error('Failed to load project:', err);
        setLoadError(describeError(err, '読み込めませんでした').message);
      } finally {
        setIsLoading(false);
      }
    };
    void loadProject();
  }, [projectId, setProject, setSelectedPartId]);

  const selectedPart = project?.parts.find((p) => p.id === selectedPartId) ?? null;

  // シーンを切り替えたら、指示の入力欄は閉じる
  useEffect(() => {
    setInstructionOpen(false);
    setInstruction('');
  }, [selectedPartId]);

  const imageById = useMemo(() => {
    const map = new Map<string, Project['images'][number]>();
    if (!project) return map;
    for (const image of [...project.images, ...project.article.importedImages]) {
      map.set(image.id, image);
    }
    return map;
  }, [project]);
  const getImageById = useCallback((imageId: string) => imageById.get(imageId), [imageById]);

  // 候補: このシーン用に作った画像 + 記事に取り込んだ画像 + いま使っている画像
  const candidateImages = useMemo(() => {
    if (!project || !selectedPart) return [];
    const promptIds = new Set(
      project.prompts.filter((p) => p.partId === selectedPart.id).map((p) => p.id)
    );
    const generated = project.images.filter(
      (img) => img.metadata.promptId && promptIds.has(img.metadata.promptId)
    );
    const used = selectedPart.panelImages
      .map((ref) => imageById.get(ref.imageId))
      .filter((img): img is NonNullable<typeof img> => Boolean(img));
    return [...generated, ...used, ...project.article.importedImages];
  }, [imageById, project, selectedPart]);

  const batchTargets = useMemo(() => {
    if (!project) return { parts: [] as Part[], missing: 0, stale: 0 };
    let missing = 0;
    let stale = 0;
    const parts = project.parts.filter((part) => {
      if (!part.scriptText.trim()) return false;
      const state = partFreshness(project, part).image;
      if (state === 'missing') missing += 1;
      if (state === 'stale') stale += 1;
      return state !== 'current';
    });
    return { parts, missing, stale };
  }, [project]);

  const slot: SlotTarget = selectedPart
    ? normalizeTarget(
        selectedPart.panelImages,
        target && target.partId === selectedPart.id ? target.slot : 0
      )
    : 'new';
  const setSlot = useCallback(
    (next: SlotTarget) => {
      if (selectedPartId) setTarget({ partId: selectedPartId, slot: next });
    },
    [selectedPartId]
  );

  /** シーンの画像への指示を用意する(ないか古いときだけ作る) */
  const ensurePrompt = useCallback(
    async (partId: string): Promise<ImagePrompt> => {
      if (!projectId) throw new Error('プロジェクトが見つかりません。');
      const latest = await projectClient.load(projectId);
      const part = latest.parts.find((item) => item.id === partId);
      if (!part) throw new Error('シーンが見つかりません。');
      const existing = latestPromptFor(latest, partId);
      if (existing && !needsPrompt(latest, part)) return existing;
      const result = await window.electronAPI.ai.generateImagePromptForTarget(
        latest.parts,
        latest.article,
        partId,
        styleOptions(latest)
      );
      const usage = createOpenAIUsageRecord('image_prompt_generate', result.usage);
      await commit((p) => ({
        ...p,
        prompts: [...p.prompts, result.prompt],
        usage: appendUsage(p, usage),
        updatedAt: new Date().toISOString(),
      }));
      return result.prompt;
    },
    [commit, projectId]
  );

  /** 1 シーンの画像を作る。instruction があれば、指示を足してから作る */
  const handleCreateImage = useCallback(
    async (withInstruction?: string) => {
      if (!projectId || !selectedPart || jobActive || busy || batch) return;
      const partId = selectedPart.id;
      const targetSlot = slot;
      const startedWith = sceneSnapshot(selectedPart);
      setError(null);
      try {
        setBusy({ partId, label: '画像の内容を考えています…' });
        let prompt = await ensurePrompt(partId);

        const text = withInstruction?.trim();
        if (text) {
          setBusy({ partId, label: '指示を反映しています…' });
          const revised = await window.electronAPI.ai.applyComment(
            { type: 'imagePrompt', id: prompt.id, currentText: prompt.prompt },
            text
          );
          const usage = createOpenAIUsageRecord('image_prompt_comment', revised.usage);
          const nextPrompt: ImagePrompt = {
            ...prompt,
            id: crypto.randomUUID(),
            prompt: revised.text,
            version: prompt.version + 1,
            createdAt: new Date().toISOString(),
          };
          await commit((p) => ({
            ...p,
            prompts: [...p.prompts, nextPrompt],
            usage: appendUsage(p, usage),
            updatedAt: new Date().toISOString(),
          }));
          prompt = nextPrompt;
        }

        setBusy({ partId, label: '画像を作っています…' });
        const latest = await projectClient.load(projectId);
        const asset = await window.electronAPI.image.generate(
          { ...prompt, styleReferenceImageIds: latest.presentationProfile.styleReferenceImageIds },
          projectId
        );
        const usage = createGeminiImageUsageRecordFromAssets([asset], 'image_generate');
        let placedIndex = -1;
        await commit((p) => {
          const now = new Date().toISOString();
          return {
            ...p,
            images: [...p.images, asset],
            parts: p.parts.map((part) => {
              if (part.id !== partId || sceneSnapshot(part) !== startedWith) return part;
              const panelImages = placeImage(part.panelImages, targetSlot, asset.id);
              placedIndex = panelImages.findIndex((ref, i) =>
                targetSlot === 'new' ? i === panelImages.length - 1 : ref.imageId === asset.id
              );
              return { ...part, panelImages, updatedAt: now };
            }),
            usage: appendUsage(p, usage),
            updatedAt: now,
          };
        });
        setInstructionOpen(false);
        setInstruction('');
        if (placedIndex < 0) {
          toast.info(
            '作っている間にシーンが変更されたため、できた画像は「候補の画像」に追加しました。',
            '候補に追加しました'
          );
        } else {
          if (targetSlot === 'new') setTarget({ partId, slot: placedIndex });
          toast.success('画像を作りました');
        }
      } catch (err) {
        reportError(err, '画像を作れませんでした');
      } finally {
        setBusy(null);
      }
    },
    [
      batch,
      busy,
      commit,
      ensurePrompt,
      jobActive,
      projectId,
      reportError,
      selectedPart,
      slot,
      toast,
    ]
  );

  /** 画像がない・古いシーンの画像をまとめて作る */
  const handleBatch = useCallback(async () => {
    if (!projectId || jobActive || busy || batch) return;
    const targetIds = batchTargets.parts.map((part) => part.id);
    if (targetIds.length === 0) return;
    batchCancelRef.current = false;
    setError(null);
    const failures: Array<{ label: string; error: unknown }> = [];
    try {
      // 1. 画像の内容(指示)を用意する
      const latest = await projectClient.load(projectId);
      const startedWith = new Map(
        latest.parts
          .filter((part) => targetIds.includes(part.id))
          .map((part) => [part.id, sceneSnapshot(part)])
      );
      const promptTargets = latest.parts.filter(
        (part) => targetIds.includes(part.id) && needsPrompt(latest, part)
      );
      setBatch({ phase: 'prompt', done: 0, total: promptTargets.length });
      if (promptTargets.length > 0 && promptTargets.length === latest.parts.length) {
        const result = await window.electronAPI.ai.generateImagePrompts(
          latest.parts,
          latest.article,
          styleOptions(latest)
        );
        const usage = createOpenAIUsageRecord('image_prompt_generate', result.usage);
        await commit((p) => ({
          ...p,
          prompts: [...p.prompts, ...result.prompts],
          usage: appendUsage(p, usage),
          updatedAt: new Date().toISOString(),
        }));
        setBatch({ phase: 'prompt', done: promptTargets.length, total: promptTargets.length });
      } else {
        let done = 0;
        await runLimited(promptTargets, 3, async (part) => {
          if (batchCancelRef.current) return;
          try {
            await ensurePrompt(part.id);
          } catch (err) {
            failures.push({ label: `シーン${part.index + 1}`, error: err });
          } finally {
            done += 1;
            setBatch({ phase: 'prompt', done, total: promptTargets.length });
          }
        });
      }
      if (batchCancelRef.current) {
        toast.info('まとめて作るのを止めました。', '止めました');
        return;
      }

      // 2. 画像を作る
      const current = await projectClient.load(projectId);
      const prompts = current.parts
        .filter((part) => targetIds.includes(part.id))
        .map((part) => latestPromptFor(current, part.id))
        .filter((prompt): prompt is ImagePrompt => Boolean(prompt))
        .map((prompt) => ({
          ...prompt,
          styleReferenceImageIds: current.presentationProfile.styleReferenceImageIds,
        }));
      if (prompts.length > 0) {
        setBatch({ phase: 'image', done: 0, total: prompts.length });
        const result = await window.electronAPI.image.generateBatch(prompts, projectId);
        const usage = createGeminiImageUsageRecordFromAssets(result.images, 'image_generate_batch');
        const partByPrompt = new Map(prompts.map((prompt) => [prompt.id, prompt.partId]));
        let keptAsCandidates = 0;
        await commit((p) => {
          const now = new Date().toISOString();
          const assetByPart = new Map<string, string>();
          for (const asset of result.images) {
            const partId = asset.metadata.promptId
              ? partByPrompt.get(asset.metadata.promptId)
              : undefined;
            if (partId) assetByPart.set(partId, asset.id);
          }
          return {
            ...p,
            images: [...p.images, ...result.images],
            parts: p.parts.map((part) => {
              const imageId = assetByPart.get(part.id);
              if (!imageId) return part;
              // 作っている間にシーンが変わったら、候補に足すだけにする
              if (sceneSnapshot(part) !== startedWith.get(part.id)) {
                keptAsCandidates += 1;
                return part;
              }
              // 1 枚目を新しい画像に差し替える(2 枚目以降はそのまま残す)
              return {
                ...part,
                panelImages: placeImage(part.panelImages, 0, imageId),
                updatedAt: now,
              };
            }),
            usage: appendUsage(p, usage),
            updatedAt: now,
          };
        });
        setBatch({ phase: 'image', done: prompts.length, total: prompts.length });
        if (keptAsCandidates > 0) {
          toast.info(
            `作っている間に変更された ${keptAsCandidates} シーンは、できた画像を「候補の画像」に追加しました。`,
            '候補に追加しました'
          );
        }
        for (const failure of result.errors) {
          const part = failure.partId
            ? current.parts.find((item) => item.id === failure.partId)
            : null;
          failures.push({
            label: part ? `シーン${part.index + 1}` : `${failure.index + 1} 件目`,
            error: failure.error,
          });
        }
      }

      if (batchCancelRef.current) {
        toast.info('まとめて作るのを止めました。できた画像は使われています。', '止めました');
      } else if (failures.length > 0) {
        setError(describeFailures('一部の画像を作れませんでした', failures));
        toast.warning('一部の画像を作れませんでした。', '一部失敗しました');
      } else {
        toast.success('画像をまとめて作りました');
      }
    } catch (err) {
      reportError(err, '画像をまとめて作れませんでした');
    } finally {
      setBatch(null);
      batchCancelRef.current = false;
    }
  }, [
    batch,
    batchTargets.parts,
    busy,
    commit,
    ensurePrompt,
    jobActive,
    projectId,
    reportError,
    toast,
  ]);

  const handleCancelBatch = useCallback(async () => {
    if (!projectId) return;
    batchCancelRef.current = true;
    try {
      await window.electronAPI.image.cancelBatch(projectId);
      toast.info('止めています。作成中の画像が終わるまでお待ちください。', '止めています');
    } catch (err) {
      reportError(err, '止められませんでした');
    }
  }, [projectId, reportError, toast]);

  const handleDeleteImage = useCallback(
    async (imageId: string) => {
      if (!project) return;
      const image =
        project.images.find((img) => img.id === imageId) ||
        project.article.importedImages.find((img) => img.id === imageId);
      if (!image) return;

      const accepted = await confirm({
        title: '画像を削除しますか?',
        description: 'この画像を使っているシーンからも外れます。元に戻せません。',
        confirmLabel: '削除',
        confirmVariant: 'danger',
      });
      if (!accepted) return;

      try {
        const result = await window.electronAPI.image.delete(image.filePath);
        if (!result.success) {
          console.warn('Failed to delete image file:', image.filePath);
        }
        await commit((p) => {
          const now = new Date().toISOString();
          return {
            ...p,
            article: {
              ...p.article,
              importedImages: p.article.importedImages.filter((img) => img.id !== imageId),
            },
            presentationProfile: {
              ...p.presentationProfile,
              styleReferenceImageIds: p.presentationProfile.styleReferenceImageIds.filter(
                (id) => id !== imageId
              ),
            },
            parts: p.parts.map((part) => {
              const panelImages = part.panelImages.filter((ref) => ref.imageId !== imageId);
              return panelImages.length === part.panelImages.length
                ? part
                : { ...part, panelImages, updatedAt: now };
            }),
            images: p.images.filter((img) => img.id !== imageId),
            thumbnail: p.thumbnail?.imageId === imageId ? undefined : p.thumbnail,
            updatedAt: now,
          };
        });
        toast.success('画像を削除しました');
      } catch (err) {
        reportError(err, '画像を削除できませんでした');
      }
    },
    [commit, confirm, project, reportError, toast]
  );

  const handleUpdatePanelImages = useCallback(
    (partId: string, panelImages: ImageAssetRef[]) => {
      const now = new Date().toISOString();
      setProject((prev) =>
        prev
          ? {
              ...prev,
              parts: prev.parts.map((p) =>
                p.id === partId ? { ...p, panelImages, updatedAt: now } : p
              ),
              updatedAt: now,
            }
          : prev
      );
    },
    [setProject]
  );

  const handleToggleStyleReference = useCallback(
    (imageId: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        const currentIds = prev.presentationProfile.styleReferenceImageIds;
        const nextIds = currentIds.includes(imageId)
          ? currentIds.filter((id) => id !== imageId)
          : [...currentIds, imageId].slice(-3);
        return {
          ...prev,
          presentationProfile: { ...prev.presentationProfile, styleReferenceImageIds: nextIds },
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [setProject]
  );

  const handleUpdateStyleReferenceNote = useCallback(
    (styleReferenceNote: string) => {
      setProject((prev) =>
        prev && prev.presentationProfile.styleReferenceNote !== styleReferenceNote
          ? {
              ...prev,
              presentationProfile: { ...prev.presentationProfile, styleReferenceNote },
              updatedAt: new Date().toISOString(),
            }
          : prev
      );
    },
    [setProject]
  );

  const handleImportStyleReference = useCallback(async () => {
    if (!projectId) return;
    try {
      const sourcePath = await window.electronAPI.file.selectFile({
        title: '見た目の参考にする画像を選択',
        filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        properties: ['openFile'],
      });
      if (!sourcePath) return;
      const imported = await window.electronAPI.image.import(sourcePath, projectId);
      await commit((p) => ({
        ...p,
        article: { ...p.article, importedImages: [...p.article.importedImages, imported] },
        presentationProfile: {
          ...p.presentationProfile,
          styleReferenceImageIds: [
            ...p.presentationProfile.styleReferenceImageIds,
            imported.id,
          ].slice(-3),
        },
        updatedAt: new Date().toISOString(),
      }));
      toast.success('参考画像を追加しました');
    } catch (err) {
      reportError(err, '参考画像を追加できませんでした');
    }
  }, [commit, projectId, reportError, toast]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[var(--nv-color-muted)]">読み込み中...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          title="プロジェクトを読み込めません"
          description={loadError || 'プロジェクトが見つかりません'}
          action={<Button onClick={() => navigate('/projects')}>プロジェクト一覧に戻る</Button>}
        />
      </div>
    );
  }

  const returnTo = `/projects/${project.id}/image`;
  const busyHere = busy && selectedPart && busy.partId === selectedPart.id ? busy : null;
  const hasImages = (selectedPart?.panelImages.length ?? 0) > 0;
  const createLabel = !hasImages
    ? '画像を作る'
    : slot === 'new'
      ? '画像を作って足す'
      : `${slot + 1} 枚目を作り直す`;
  const createBlockedReason = jobActive
    ? JOB_ACTIVE_MESSAGE
    : batch
      ? 'まとめて作成中です。終わるまでお待ちください。'
      : busy && !busyHere
        ? 'ほかのシーンの画像を作成中です。'
        : selectedPart && !selectedPart.scriptText.trim()
          ? '台本が空のため、画像を作れません。台本画面で文章を入れてください。'
          : null;
  const batchBlockedReason = jobActive
    ? JOB_ACTIVE_MESSAGE
    : busy
      ? 'シーンの画像を作成中です。終わるまでお待ちください。'
      : batchTargets.parts.length === 0
        ? 'すべてのシーンに最新の画像があります。'
        : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Header title="画像" subtitle={project.name} />

      {projectId && <WorkflowNav projectId={projectId} current="image" project={project} />}

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <SceneList
          className="w-56 shrink-0"
          scenes={project.parts}
          selectedId={selectedPartId}
          onSelect={setSelectedPartId}
          subtitle={`全 ${project.parts.length} シーン`}
          renderStatus={(part) => {
            const state = partFreshness(project, part).image;
            if (part.panelImages.length === 0) return <Badge tone="warning">画像なし</Badge>;
            if (state === 'missing') return <Badge tone="danger">ファイルなし</Badge>;
            return (
              <>
                <Badge tone="neutral">{part.panelImages.length} 枚</Badge>
                {state === 'stale' && <Badge tone="warning">古い可能性</Badge>}
              </>
            );
          }}
        />

        <div
          ref={scrollRef}
          className="@container nv-scrollbar min-h-0 min-w-0 flex-1 space-y-4 overflow-auto pr-1"
        >
          <ErrorNotice error={error} onDismiss={() => setError(null)} returnTo={returnTo} />

          <Card
            title="まとめて作る"
            subtitle={
              batchTargets.parts.length === 0
                ? 'すべてのシーンに最新の画像があります'
                : `画像がないシーン ${batchTargets.missing} 件・古くなった可能性があるシーン ${batchTargets.stale} 件`
            }
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void handleBatch()}
                disabled={Boolean(batchBlockedReason) || Boolean(batch)}
              >
                {batch ? '作成中…' : `足りない画像を作る（${batchTargets.parts.length}）`}
              </Button>
              {batch && (
                <Button variant="secondary" onClick={() => void handleCancelBatch()}>
                  止める
                </Button>
              )}
              {!batch && batchBlockedReason && batchTargets.parts.length > 0 && (
                <p className="nv-help">{batchBlockedReason}</p>
              )}
            </div>
            {batch && (
              <ProgressBar
                className="mt-3"
                value={batch.done}
                max={Math.max(1, batch.total)}
                label={
                  batch.phase === 'prompt'
                    ? `画像の内容を考えています（${batch.done}/${batch.total}）`
                    : `画像を作っています（${batch.total} 枚）`
                }
              />
            )}
            <p className="nv-help mt-3">
              見た目: {IMAGE_STYLE_PRESET_LABELS[project.presentationProfile.imageStylePreset]}・
              {IMAGE_ASPECT_RATIO_LABELS[project.presentationProfile.aspectRatio]}
            </p>
            <Details className="mt-3" summary="見た目をそろえる参考画像（任意）">
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="nv-help max-w-prose">
                    参考にしたい画像を 3 枚まで選ぶと、色・余白・文字の大きさをそろえて作ります。
                  </p>
                  <Button variant="secondary" size="sm" onClick={handleImportStyleReference}>
                    参考画像を追加
                  </Button>
                </div>
                <label className="block">
                  <span className="nv-label">特に合わせたい点（任意）</span>
                  <textarea
                    key={project.presentationProfile.styleReferenceNote}
                    defaultValue={project.presentationProfile.styleReferenceNote}
                    onBlur={(e) => handleUpdateStyleReferenceNote(e.target.value)}
                    className="nv-input min-h-[64px] resize-y text-sm"
                    placeholder="例: 太い見出し、青いカード背景"
                  />
                </label>
                <ImageGallery
                  images={[...project.article.importedImages, ...project.images]}
                  selectedImageIds={project.presentationProfile.styleReferenceImageIds}
                  onSelectImage={handleToggleStyleReference}
                  selectLabel="参考にする"
                  selectedLabel="参考から外す"
                  emptyMessage="参考にできる画像がありません。「参考画像を追加」から選んでください。"
                />
              </div>
            </Details>
          </Card>

          {selectedPart ? (
            <Card
              emphasis
              title={`シーン ${selectedPart.index + 1}：${selectedPart.title}`}
              subtitle={selectedPart.summary || undefined}
            >
              <div className="space-y-4">
                <StaleNotice
                  project={project}
                  part={selectedPart}
                  kinds={['image']}
                  onChange={setProject}
                />

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => void handleCreateImage()}
                      disabled={Boolean(createBlockedReason) || Boolean(busyHere)}
                    >
                      {busyHere ? '作成中…' : createLabel}
                    </Button>
                    {hasImages && (
                      <Button
                        variant="secondary"
                        onClick={() => setInstructionOpen((open) => !open)}
                        disabled={Boolean(createBlockedReason) || Boolean(busyHere)}
                        aria-expanded={instructionOpen}
                      >
                        指示を足して作り直す
                      </Button>
                    )}
                  </div>
                  {busyHere ? (
                    <p className="nv-help" role="status">
                      {busyHere.label}
                    </p>
                  ) : (
                    createBlockedReason && <p className="nv-help">{createBlockedReason}</p>
                  )}
                </div>

                {instructionOpen && (
                  <div className="nv-surface-muted space-y-2 p-3">
                    <label className="block">
                      <span className="nv-label">どう直したいかを書いてください</span>
                      <textarea
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        rows={2}
                        className="nv-input resize-y text-sm"
                        placeholder="例: 背景を明るく、数字を大きく、人物は入れない"
                      />
                    </label>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setInstructionOpen(false);
                          setInstruction('');
                        }}
                      >
                        やめる
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void handleCreateImage(instruction)}
                        disabled={
                          !instruction.trim() || Boolean(createBlockedReason) || Boolean(busyHere)
                        }
                      >
                        この指示で作り直す
                      </Button>
                    </div>
                  </div>
                )}

                <SceneImages
                  key={selectedPart.id}
                  panelImages={selectedPart.panelImages}
                  candidateImages={candidateImages}
                  getImageById={getImageById}
                  target={slot}
                  onTargetChange={setSlot}
                  onChange={(next) => handleUpdatePanelImages(selectedPart.id, next)}
                  onDeleteImage={handleDeleteImage}
                  disabled={Boolean(busyHere) || Boolean(batch)}
                />
              </div>
            </Card>
          ) : (
            <EmptyState title="シーンを選んでください" />
          )}
        </div>
      </div>
    </div>
  );
}
