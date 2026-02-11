export type WorkflowStage = 'article' | 'script' | 'image' | 'audio' | 'video';

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface ProjectProgressSummary {
  stage: WorkflowStage;
  completedSteps: number;
  totalSteps: 5;
  partCount: number;
  missingPrompts: number;
  missingImages: number;
  missingAudio: number;
  hasVideoOutput: boolean;
}

export interface ProjectListItem {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  path: string;
  articleTitle?: string;
  thumbnailImageId?: string;
  summary?: ProjectProgressSummary;
}

export interface StepDescriptor {
  key: WorkflowStage;
  label: string;
}
