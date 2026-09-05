import { z } from 'zod';
import type { Project } from './schema';
export const metricsSchema = z.object({ firstPreviewAt: z.string().optional(), firstOutputAt: z.string().optional(), renderAttempts: z.number().int().nonnegative().default(0), renderFailures: z.number().int().nonnegative().default(0), generationRequests: z.number().int().nonnegative().default(0), restarts: z.number().int().nonnegative().default(0), stops: z.number().int().nonnegative().default(0), lastFailureKind: z.string().optional() });
export function productionMetrics(project: Project) {
  const metrics = metricsSchema.parse(project.metrics ?? {});
  const elapsed = (at?: string) => { const milliseconds = Date.parse(at ?? '') - Date.parse(project.createdAt); return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds / 1000 : null; };
  const edited = project.parts.filter((part) => part.scriptModifiedByUser).length;
  return { ...metrics, elapsedToPreviewSec: elapsed(metrics.firstPreviewAt), elapsedToOutputSec: elapsed(metrics.firstOutputAt), editedSceneRatio: project.parts.length ? edited / project.parts.length : null, partCount: project.parts.length, outputDurationSec: project.parts.reduce((sum, part) => sum + (part.audio?.durationSec ?? 0), 0), usageRecords: project.usage.length, completed: Boolean(metrics.firstOutputAt) };
}
/** Deliberately allowlisted support data: no text, names, sources, paths, keys or prompts. */
export function diagnosticProject(project: Project) { return { schemaVersion: project.schemaVersion, revision: project.revision, aspectRatio: project.presentationProfile.aspectRatio, missingFiles: project.integrity?.missingFiles.length ?? 0, job: project.job ? { status: project.job.status, completedStages: project.job.completed.length, errorKind: project.job.error?.kind, unknownCharges: project.job.unknownCharges } : null, metrics: productionMetrics(project) }; }
