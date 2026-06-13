import { cn } from '@/lib/utils';

export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient shadow-lg shadow-brand-500/30">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none">
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <ellipse cx="12" cy="12" rx="10" ry="4" stroke="currentColor" strokeWidth="1.5" />
          <ellipse cx="12" cy="12" rx="10" ry="4" stroke="currentColor" strokeWidth="1.5" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="10" ry="4" stroke="currentColor" strokeWidth="1.5" transform="rotate(120 12 12)" />
        </svg>
      </div>
      {showText && (
        <span className="text-base font-semibold tracking-tight">
          Atom<span className="text-gradient">Vision</span>
        </span>
      )}
    </div>
  );
}
