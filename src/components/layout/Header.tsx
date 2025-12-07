interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header className="titlebar-drag h-14 bg-white border-b border-gray-200 px-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="titlebar-no-drag flex items-center gap-2">{actions}</div>}
    </header>
  );
}
