import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppSettings } from '../../shared/settings/appSettings';

export const generationSettings = new AsyncLocalStorage<AppSettings>();
