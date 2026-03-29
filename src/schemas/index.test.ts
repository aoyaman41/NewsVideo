import { describe, expect, it } from 'vitest';
import { getDefaultPresentationProfile, normalizePresentationProfile } from '../../shared/project/presentationProfile';
import { createNewProject, projectSchema } from './index';

describe('createNewProject', () => {
  it('includes the default presentation profile for new projects', () => {
    const project = createNewProject('Sample Project', '/tmp/sample.newsproj');
    const projectForSchema = {
      ...project,
      article: {
        ...project.article,
        title: 'Sample title',
        bodyText: 'Sample body text for schema validation.',
      },
    };

    expect(project.schemaVersion).toBe('v1.2');
    expect(project.presentationProfile).toEqual(getDefaultPresentationProfile());
    expect(projectSchema.parse(projectForSchema).presentationProfile).toEqual(
      getDefaultPresentationProfile()
    );
  });

  it('keeps legacy projects compatible by applying the default presentation profile', () => {
    const project = createNewProject('Legacy Project', '/tmp/legacy.newsproj');
    const { presentationProfile, ...legacyProject } = project;
    const legacyProjectForSchema = {
      ...legacyProject,
      article: {
        ...legacyProject.article,
        title: 'Legacy title',
        bodyText: 'Legacy body text for schema validation.',
      },
    };

    expect(presentationProfile).toEqual(getDefaultPresentationProfile());

    const upgradedProject = projectSchema.parse({
      ...legacyProjectForSchema,
      presentationProfile: normalizePresentationProfile(undefined),
    });

    expect(upgradedProject.presentationProfile).toEqual(getDefaultPresentationProfile());
  });
});
