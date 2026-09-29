import { forwardRef } from "react"
import { cn } from "@/lib/utils"

// Inputs: generous hit area, clear focus ring, visible error state.
const fieldBase =
  "w-full rounded-xl border border-border-strong bg-[oklch(0.13_0.01_262/60%)] px-4 text-[0.9375rem] text-foreground placeholder:text-subtle-foreground outline-none transition-[border-color,background-color,box-shadow] duration-150 ease-out hover:border-[oklch(1_0_0/20%)] focus:border-primary/70 focus:bg-[oklch(0.13_0.01_262/80%)] focus:shadow-[0_0_0_4px_oklch(0.72_0.135_250/14%)] disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-destructive/70"

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-12", className)} {...props} />
})

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(fieldBase, "min-h-24 py-3 leading-relaxed", className)}
      {...props}
    />
  )
})

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-2 block text-[0.8125rem] font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

export function FieldHint({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-2 text-xs text-subtle-foreground", className)} {...props} />
}
