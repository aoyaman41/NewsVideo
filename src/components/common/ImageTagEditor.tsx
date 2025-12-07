import { useState, useCallback } from 'react';
import type { ImageAsset } from '../../schemas';

interface ImageTagEditorProps {
  image: ImageAsset;
  onTagsUpdate: (imageId: string, tags: string[]) => void;
  suggestedTags?: string[];
}

export function ImageTagEditor({ image, onTagsUpdate, suggestedTags = [] }: ImageTagEditorProps) {
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const addTag = useCallback(
    (tag: string) => {
      const trimmedTag = tag.trim().toLowerCase();
      if (trimmedTag && !image.metadata.tags.includes(trimmedTag)) {
        onTagsUpdate(image.id, [...image.metadata.tags, trimmedTag]);
      }
      setInputValue('');
    },
    [image.id, image.metadata.tags, onTagsUpdate]
  );

  const removeTag = useCallback(
    (tagToRemove: string) => {
      onTagsUpdate(
        image.id,
        image.metadata.tags.filter((tag) => tag !== tagToRemove)
      );
    },
    [image.id, image.metadata.tags, onTagsUpdate]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && inputValue === '' && image.metadata.tags.length > 0) {
      removeTag(image.metadata.tags[image.metadata.tags.length - 1]);
    }
  };

  const availableSuggestions = suggestedTags.filter(
    (tag) => !image.metadata.tags.includes(tag) && tag.includes(inputValue.toLowerCase())
  );

  return (
    <div className="space-y-2">
      {/* タグ表示エリア */}
      <div className="flex flex-wrap gap-1">
        {image.metadata.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full"
          >
            {tag}
            <button
              onClick={() => removeTag(tag)}
              className="text-blue-600 hover:text-blue-800"
              type="button"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full hover:bg-gray-200"
            type="button"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            タグ追加
          </button>
        )}
      </div>

      {/* タグ入力エリア */}
      {isEditing && (
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (inputValue) addTag(inputValue);
              setIsEditing(false);
            }}
            placeholder="タグを入力..."
            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          {/* サジェスト */}
          {availableSuggestions.length > 0 && inputValue && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-32 overflow-auto">
              {availableSuggestions.slice(0, 5).map((tag) => (
                <button
                  key={tag}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(tag);
                  }}
                  className="w-full px-3 py-1 text-sm text-left hover:bg-gray-100"
                  type="button"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
