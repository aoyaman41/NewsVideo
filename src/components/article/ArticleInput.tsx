import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { articleInputSchema, type ArticleInput as ArticleInputType } from '../../schemas';
import { Button } from '../ui';

interface ArticleInputProps {
  defaultValues?: Partial<ArticleInputType>;
  onSubmit: (data: ArticleInputType) => void;
  onAutoSubmit?: (data: ArticleInputType) => void;
  onAutoRestart?: (data: ArticleInputType) => void;
  onAutoCancel?: () => void;
  isLoading?: boolean;
  isAutoLoading?: boolean;
}

export function ArticleInput({
  defaultValues,
  onSubmit,
  onAutoSubmit,
  onAutoRestart,
  onAutoCancel,
  isLoading,
  isAutoLoading,
}: ArticleInputProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ArticleInputType>({
    resolver: zodResolver(articleInputSchema),
    defaultValues: {
      title: defaultValues?.title || '',
      source: defaultValues?.source || '',
      bodyText: defaultValues?.bodyText || '',
    },
  });

  useEffect(() => {
    reset({
      title: defaultValues?.title || '',
      source: defaultValues?.source || '',
      bodyText: defaultValues?.bodyText || '',
    });
  }, [defaultValues?.bodyText, defaultValues?.source, defaultValues?.title, reset]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium text-slate-700">
          記事タイトル <span className="text-red-500">*</span>
        </label>
        <input
          id="title"
          type="text"
          {...register('title')}
          placeholder="記事のタイトルを入力"
          className="nv-input"
        />
        {errors.title && <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>}
      </div>

      <div>
        <label htmlFor="source" className="mb-1 block text-sm font-medium text-slate-700">
          出典（任意）
        </label>
        <input
          id="source"
          type="text"
          {...register('source')}
          placeholder="出典元を入力（例：〇〇新聞、△△ニュース）"
          className="nv-input"
        />
        {errors.source && <p className="mt-1 text-sm text-red-600">{errors.source.message}</p>}
      </div>

      <div>
        <label htmlFor="bodyText" className="mb-1 block text-sm font-medium text-slate-700">
          記事本文 <span className="text-red-500">*</span>
        </label>
        <textarea
          id="bodyText"
          {...register('bodyText')}
          rows={15}
          placeholder="記事の本文を入力またはファイルからインポート"
          className="nv-input resize-y font-mono text-sm"
        />
        {errors.bodyText && <p className="mt-1 text-sm text-red-600">{errors.bodyText.message}</p>}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {onAutoSubmit && (
          <Button
            type="button"
            onClick={handleSubmit(onAutoSubmit)}
            disabled={isLoading || isAutoLoading}
            variant="success"
          >
            {isAutoLoading ? '自動生成中...' : '続きから自動生成'}
          </Button>
        )}
        {onAutoRestart && (
          <Button
            type="button"
            onClick={handleSubmit(onAutoRestart)}
            disabled={isLoading || isAutoLoading}
            variant="secondary"
          >
            {isAutoLoading ? '自動生成中...' : '最初から自動生成'}
          </Button>
        )}
        {onAutoCancel && isAutoLoading && (
          <Button type="button" onClick={onAutoCancel} variant="secondary">
            停止
          </Button>
        )}
        <Button type="submit" disabled={isLoading || isAutoLoading}>
          {isLoading ? 'スクリプト生成中...' : 'スクリプトを生成'}
        </Button>
      </div>
    </form>
  );
}
