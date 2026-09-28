import React from 'react';
import { cn } from './button';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'zinc';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
        {
          'bg-zinc-100 text-zinc-900': variant === 'default',
          'bg-zinc-800 text-zinc-300': variant === 'secondary',
          'border border-zinc-700 text-zinc-300': variant === 'outline',
          'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60': variant === 'success',
          'bg-amber-950/80 text-amber-300 border border-amber-800/60': variant === 'warning',
          'bg-zinc-900 text-zinc-400 border border-zinc-800': variant === 'zinc',
        },
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-zinc-800 bg-zinc-900/60 text-zinc-100 shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1 p-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-xs font-semibold leading-none tracking-tight text-zinc-100', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-[11px] text-zinc-400', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-0', className)} {...props} />;
}
