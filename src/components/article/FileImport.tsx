import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileImportProps {
  onTextImported: (title: string, text: string) => void;
}

export function FileImport({ onTextImported }: FileImportProps) {
  const processFile = useCallback(
    async (file: File) => {
      const fileName = file.name.replace(/\.[^/.]+$/, ''); // 拡張子を除去

      if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        // テキストファイル/Markdownファイル
        const text = await file.text();
        onTextImported(fileName, text);
      } else if (file.name.endsWith('.docx')) {
        // DOCXファイル
        const mammoth = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        onTextImported(fileName, result.value);
      }
    },
    [onTextImported]
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        await processFile(acceptedFiles[0]);
      }
    },
    [processFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxFiles: 1,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
        isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
      }`}
    >
      <input {...getInputProps()} />
      <div className="text-gray-500">
        <svg
          className="w-10 h-10 mx-auto mb-3 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
        {isDragActive ? (
          <p>ここにドロップしてください</p>
        ) : (
          <>
            <p className="mb-1 font-medium">ファイルをインポート</p>
            <p className="text-sm">.txt, .md, .docx 形式に対応</p>
          </>
        )}
      </div>
    </div>
  );
}
