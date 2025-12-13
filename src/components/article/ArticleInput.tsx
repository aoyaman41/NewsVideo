import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { articleInputSchema, type ArticleInput as ArticleInputType } from '../../schemas';

interface ArticleInputProps {
  defaultValues?: Partial<ArticleInputType>;
  onSubmit: (data: ArticleInputType) => void;
  isLoading?: boolean;
}

export function ArticleInput({ defaultValues, onSubmit, isLoading }: ArticleInputProps) {
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* タイトル */}
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
          記事タイトル <span className="text-red-500">*</span>
        </label>
        <input
          id="title"
          type="text"
          {...register('title')}
          placeholder="記事のタイトルを入力"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {errors.title && (
          <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
        )}
      </div>

      {/* 出典 */}
      <div>
        <label htmlFor="source" className="block text-sm font-medium text-gray-700 mb-1">
          出典（任意）
        </label>
        <input
          id="source"
          type="text"
          {...register('source')}
          placeholder="出典元を入力（例：〇〇新聞、△△ニュース）"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {errors.source && (
          <p className="mt-1 text-sm text-red-600">{errors.source.message}</p>
        )}
      </div>

      {/* 本文 */}
      <div>
        <label htmlFor="bodyText" className="block text-sm font-medium text-gray-700 mb-1">
          記事本文 <span className="text-red-500">*</span>
        </label>
        <textarea
          id="bodyText"
          {...register('bodyText')}
          rows={15}
          placeholder="記事の本文を入力またはファイルからインポート"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y font-mono text-sm"
        />
        {errors.bodyText && (
          <p className="mt-1 text-sm text-red-600">{errors.bodyText.message}</p>
        )}
      </div>

      {/* 送信ボタン */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isLoading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? 'スクリプト生成中...' : 'スクリプトを生成'}
        </button>
      </div>
    </form>
  );
}
