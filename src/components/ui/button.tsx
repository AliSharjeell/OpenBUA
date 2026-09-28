import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'subtle';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 shadow-sm': variant === 'default',
            'bg-zinc-800 text-zinc-100 hover:bg-zinc-700': variant === 'secondary',
            'border border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100': variant === 'outline',
            'hover:bg-zinc-800 hover:text-zinc-100 text-zinc-400': variant === 'ghost',
            'bg-red-950 text-red-300 border border-red-900 hover:bg-red-900/60': variant === 'destructive',
            'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800/80': variant === 'subtle',
            'h-8 px-3 py-1.5': size === 'default',
            'h-7 px-2.5 text-[11px]': size === 'sm',
            'h-9 px-4 text-sm': size === 'lg',
            'h-7 w-7 p-0': size === 'icon',
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
