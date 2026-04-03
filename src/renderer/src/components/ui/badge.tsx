import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-amber-500/15 text-amber-400 border border-amber-500/30',
        secondary: 'border-transparent bg-zinc-800 text-zinc-500 border border-zinc-700/60',
        destructive: 'border-transparent bg-red-600/20 text-red-400 border border-red-600/30',
        outline: 'border-zinc-600 text-zinc-400'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
