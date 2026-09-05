import type { Project, Part } from './schema';

export type Freshness = 'missing' | 'current' | 'stale';

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

// Two independent 32-bit accumulators; this is a change detector, not a security primitive.
export function inputFingerprint(value: unknown): string {
  const input = canonical(value);
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < input.length; i++) {
    a = Math.imul(a ^ input.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ input.charCodeAt(i);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

export function sourceInputs(project: Project, part: Part) {
  const profile = project.presentationProfile;
  const prompt = project.prompts
    .filter((item) => item.partId === part.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const script = inputFingerprint({
    model: project.generationConfig?.scriptTextModel,
    reasoning: project.generationConfig?.openaiReasoningEffort,
    article: {
      title: project.article.title,
      source: project.article.source,
      bodyText: project.article.bodyText,
    },
    tone: profile.tone,
    closingLineMode: profile.closingLineMode,
    closingLineText: profile.closingLineText,
    targetDurationPerPartSec: profile.targetDurationPerPartSec,
  });
  const text = { title: part.title, summary: part.summary, scriptText: part.scriptText };
  const promptInput = inputFingerprint({
    text,
    model: project.generationConfig?.imagePromptTextModel,
    aspectRatio: profile.aspectRatio,
    style: profile.imageStylePreset,
    references: profile.styleReferenceImageIds,
    note: profile.styleReferenceNote,
  });
  return {
    script,
    prompt: promptInput,
    image: inputFingerprint({ promptInput, prompt, model: project.generationConfig?.imageModel, resolution: project.generationConfig?.imageResolution }),
    audio: inputFingerprint({
      text: part.scriptText,
      engine: project.generationConfig?.ttsEngine, model: project.generationConfig?.ttsModel, voice: project.generationConfig?.ttsVoice, rate: project.generationConfig?.ttsSpeakingRate, pitch: project.generationConfig?.ttsPitch,
      style: profile.ttsNarrationStylePreset,
      note: profile.ttsNarrationStyleNote,
    }),
  };
}

export function videoInput(project: Project) {
  return inputFingerprint({
    article: project.article,
    parts: project.parts.map((part) => ({
      id: part.id,
      index: part.index,
      title: part.title,
      scriptText: part.scriptText,
      panelImages: part.panelImages,
      audio: part.audio,
    })),
    profile: project.presentationProfile,
    outputSettings: project.outputSettings,
  });
}

export function deriveIntegrity(previous: Project | null, next: Project): Project['integrity'] {
  const parts: NonNullable<Project['integrity']>['parts'] = {};
  for (const part of next.parts) {
    const old = previous?.parts.find((item) => item.id === part.id);
    const saved = next.integrity?.parts[part.id] ?? previous?.integrity?.parts[part.id] ?? {};
    const inputs = sourceInputs(next, part);
    const oldPrompt = previous?.prompts.filter((item) => item.partId === part.id);
    const nextPrompt = next.prompts.filter((item) => item.partId === part.id);
    parts[part.id] = {
      ...saved,
      script: !old || old.scriptText !== part.scriptText ? inputs.script : saved.script,
      prompt:
        inputFingerprint(oldPrompt) !== inputFingerprint(nextPrompt) && nextPrompt.length > 0
          ? inputs.prompt
          : saved.prompt,
      image:
        part.panelImages.length > 0 &&
        inputFingerprint(old?.panelImages) !== inputFingerprint(part.panelImages)
          ? inputs.image
          : saved.image,
      audio: part.audio && old?.audio?.id !== part.audio.id ? inputs.audio : saved.audio,
    };
  }
  return {
    parts,
    video: next.integrity?.video ?? previous?.integrity?.video,
    missingFiles: next.integrity?.missingFiles ?? [],
  };
}

export function partFreshness(project: Project, part: Part) {
  const saved = project.integrity?.parts[part.id];
  const inputs = sourceInputs(project, part);
  const missing = new Set(project.integrity?.missingFiles ?? []);
  const allImages = [...project.images, ...project.article.importedImages];
  const imageFilesPresent =
    part.panelImages.length > 0 &&
    part.panelImages.every((ref) => {
      const asset = allImages.find((image) => image.id === ref.imageId);
      return asset && !missing.has(asset.filePath);
    });
  const state = (exists: boolean, expected: string, actual?: string): Freshness =>
    !exists ? 'missing' : expected === actual ? 'current' : 'stale';
  return {
    script: state(Boolean(part.scriptText.trim()), inputs.script, saved?.script),
    prompt: state(
      project.prompts.some((prompt) => prompt.partId === part.id),
      inputs.prompt,
      saved?.prompt
    ),
    image: state(imageFilesPresent, inputs.image, saved?.image),
    audio: state(
      Boolean(part.audio && !missing.has(part.audio.filePath)),
      inputs.audio,
      saved?.audio
    ),
  };
}

export function isVideoCurrent(project: Project) {
  const output = project.autoGenerationStatus?.lastVideoPath;
  return Boolean(
    output &&
    project.integrity?.video === videoInput(project) &&
    !project.integrity.missingFiles.includes(output) &&
    project.parts.length > 0 &&
    project.parts.every((part) => {
      const status = partFreshness(project, part);
      return (
        status.script === 'current' && status.image === 'current' && status.audio === 'current'
      );
    })
  );
}

export function approveAssets(
  project: Project,
  partId: string,
  kinds: Array<'script' | 'image' | 'audio'>
): Project {
  const part = project.parts.find((item) => item.id === partId);
  if (!part) return project;
  const input = sourceInputs(project, part);
  const current = project.integrity ?? { parts: {}, missingFiles: [] };
  return {
    ...project,
    integrity: {
      ...current,
      parts: {
        ...current.parts,
        [partId]: {
          ...current.parts[partId],
          ...Object.fromEntries(kinds.map((kind) => [kind, input[kind]])),
          approvedAt: new Date().toISOString(),
        },
      },
    },
  };
}
