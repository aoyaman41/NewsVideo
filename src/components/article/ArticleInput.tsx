import { useEffect, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { articleInputSchema, type ArticleInput as ArticleInputType } from '../../schemas';
import { Button } from '../ui';
import type { ButtonVariant } from '../ui/Button';

export type ArticleAction = {
  key: string;
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** 入力内容を確かめてから呼ぶ */
  onClick: (data: ArticleInputType) => void;
};

interface ArticleInputProps {
  /** 読み込み時の値。入力中は変えない(入力位置が飛ばないように) */
  defaultValues?: Partial<ArticleInputType>;
  onChange?: (data: ArticleInputType) => void;
  /** 本文の文字数(表示用) */
  bodyLength?: number;
  /** ボタンの上に出す内容(費用の見込みや案内) */
  footer?: ReactNode;
  /** 右から順に大きく見せたいボタンを最後に置く */
  actions: ArticleAction[];
}

/** 記事の入力欄。タイトルと本文を主にし、出典は控えめに置く。入力は自動で保存される */
export function ArticleInput({
  defaultValues,
  onChange,
  bodyLength,
  footer,
  actions,
}: ArticleInputProps) {
  const {
    register,
    getValues,
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
    <div className="space-y-4">
      <form
        onChange={() => onChange?.(getValues())}
        onSubmit={(event) => event.preventDefault()}
        className="space-y-4"
        noValidate
      >
        <div>
          <label
            htmlFor="article-title"
            className="mb-1 block text-sm font-semibold text-[var(--nv-color-text)]"
          >
            タイトル
          </label>
          <input
            id="article-title"
            type="text"
            {...register('title')}
            placeholder="記事のタイトルを貼り付け"
            className="nv-input"
            aria-invalid={Boolean(errors.title)}
          />
          {errors.title && (
            <p className="mt-1 text-sm text-[var(--nv-color-danger)]">{errors.title.message}</p>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label
              htmlFor="article-body"
              className="block text-sm font-semibold text-[var(--nv-color-text)]"
            >
              本文
            </label>
            {typeof bodyLength === 'number' && (
              <span className="text-xs text-[var(--nv-color-muted)]">
                {bodyLength.toLocaleString('ja-JP')} 文字
              </span>
            )}
          </div>
          <textarea
            id="article-body"
            {...register('bodyText')}
            rows={14}
            placeholder="記事の本文を貼り付け"
            className="nv-input resize-y text-sm leading-relaxed"
            aria-invalid={Boolean(errors.bodyText)}
          />
          {errors.bodyText && (
            <p className="mt-1 text-sm text-[var(--nv-color-danger)]">{errors.bodyText.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="article-source"
            className="mb-1 block text-xs font-semibold text-[var(--nv-color-muted)]"
          >
            出典(任意・動画の最後に表示できます)
          </label>
          <input
            id="article-source"
            type="text"
            {...register('source')}
            placeholder="例: 〇〇新聞 2026年9月26日"
            className="nv-input text-sm"
          />
          {errors.source && (
            <p className="mt-1 text-sm text-[var(--nv-color-danger)]">{errors.source.message}</p>
          )}
        </div>
      </form>

      {footer}

      {actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions.map((action) => (
            <Button
              key={action.key}
              type="button"
              size="lg"
              variant={action.variant ?? 'primary'}
              disabled={action.disabled}
              onClick={handleSubmit(action.onClick)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
