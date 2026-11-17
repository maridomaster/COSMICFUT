import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-club-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        club: 'bg-club-accent text-club-on-accent shadow-[0_8px_24px_-10px_var(--club-accent)] hover:brightness-110 active:scale-[0.98]',
        default: 'bg-fg text-bg hover:bg-fg/90 active:scale-[0.98]',
        outline: 'border border-line-strong bg-surface-2/60 text-fg hover:bg-surface-3 hover:border-club-accent/40',
        ghost: 'text-fg-muted hover:text-fg hover:bg-surface-2',
      },
      size: {
        // (Atualização 41) escala compacta: 28 / 36 / 44 px (ícone 14 no sm, 16 nos demais)
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-9 px-3.5',
        lg: 'h-11 px-5 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
