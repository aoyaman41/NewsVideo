import { getDefaultPresentationProfile } from './presentationProfile';
export const PURPOSES = [
  {
    id: 'short',
    label: '60秒・縦型ダイジェスト',
    seconds: 60,
    parts: 3,
    profile: {
      ...getDefaultPresentationProfile('short'),
      aspectRatio: '9:16' as const,
      targetDurationPerPartSec: 20,
    },
  },
  {
    id: 'explain',
    label: '3分・じっくり解説',
    seconds: 180,
    parts: 6,
    profile: { ...getDefaultPresentationProfile('explain'), targetDurationPerPartSec: 30 },
  },
  {
    id: 'news',
    label: '90秒・定期ニュース',
    seconds: 90,
    parts: 3,
    profile: getDefaultPresentationProfile('news'),
  },
] as const;
