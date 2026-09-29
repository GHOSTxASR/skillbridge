import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// Buttons respond on press (scale 0.97, per pointer-down) and never animate layout.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent font-medium whitespace-nowrap select-none outline-none transition-[transform,background-color,border-color,color,filter,opacity] duration-150 ease-out active:not-disabled:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/22%)] hover:brightness-110',
        secondary:
          'border-border bg-surface-2 text-foreground hover:border-border-strong hover:bg-[oklch(0.25_0.015_262)]',
        outline:
          'border-border-strong bg-transparent text-foreground hover:bg-surface-2',
        ghost:
          'text-muted-foreground hover:bg-surface-2 hover:text-foreground aria-expanded:bg-surface-2 aria-expanded:text-foreground',
        ai: 'border-ai/20 bg-ai-muted text-ai hover:bg-ai/20',
        destructive:
          'bg-destructive-muted text-destructive hover:bg-destructive/20',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 text-sm',
        xs: "h-7 gap-1 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 rounded-md px-3 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-12 rounded-xl px-6 text-[0.9375rem]',
        icon: 'size-10',
        'icon-xs': "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': 'size-8 rounded-md',
        'icon-lg': 'size-12 rounded-xl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
