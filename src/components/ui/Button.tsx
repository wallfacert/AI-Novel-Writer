/* eslint-disable react-refresh/only-export-components */
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx } from 'clsx'
import { cn } from '../../lib/utils'

 

export const buttonVariants = cva(
  /* 基础：加入顺滑过渡和点击缩小回弹效果，提升交互手感 */
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-xs font-medium transition-all duration-200 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)] focus-visible:ring-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'btn-primary text-white',
        ai:
          'ai-glow text-white shadow-sm hover:shadow-md relative overflow-hidden',
        destructive:
          'bg-[var(--color-error)] text-[var(--color-error-foreground)] shadow-sm hover:shadow-md hover:shadow-[var(--color-error)]/30 transition-all duration-200 hover:brightness-110 active:scale-[0.96]',
        outline:
          'border border-[var(--color-border)] bg-transparent text-[var(--color-text)] hover:bg-[var(--color-hover)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all duration-200',
        ghost:
          'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] active:scale-[0.98] transition-all duration-200',
        success:
          'bg-[var(--color-success)] text-[var(--color-success-foreground)] shadow-sm hover:shadow-md hover:shadow-[var(--color-success)]/30 transition-all duration-200 hover:brightness-110 active:scale-[0.96]',
      },
      size: {
        default: 'h-7 px-3 py-1 rounded-[var(--radius-md)]',    /* 28px 高 */
        sm:      'h-6 px-2.5 py-0.5 rounded-[var(--radius-sm)]', /* 24px 高 */
        lg:      'h-8 px-4 py-1.5 rounded-[var(--radius-lg)]',   /* 32px 高 */
        icon:    'h-7 w-7 p-0 rounded-[var(--radius-md)]',       /* 28x28 方形图标按钮 */
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

type NativeButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>

/** 旧外壳的按钮变体，RD-10 删除旧外壳时一并删除，届时 Button 只剩纸墨六种。 */
type LegacyButtonProps = NativeButtonProps & VariantProps<typeof buttonVariants> & {
  asChild?: boolean
}

/** 纸墨按钮：主、次、文字（幽灵）、危险描边、危险实心与图标。 */
export type InkButtonVariant = 'primary' | 'secondary' | 'text' | 'danger' | 'danger-solid' | 'icon'
export type InkButtonSize = 'sm' | 'md' | 'lg'

type InkButtonProps = NativeButtonProps & { size?: InkButtonSize } & (
  | { variant: Exclude<InkButtonVariant, 'icon'> }
  | { variant: 'icon'; 'aria-label': string }
)

export type ButtonProps = LegacyButtonProps | InkButtonProps

const inkVariants: ReadonlySet<string> = new Set<InkButtonVariant>(['primary', 'secondary', 'text', 'danger', 'danger-solid', 'icon'])

function isInkButton(props: ButtonProps): props is InkButtonProps {
  return typeof props.variant === 'string' && inkVariants.has(props.variant)
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
  if (isInkButton(props)) {
    const { className, variant, size = 'md', type = 'button', ...rest } = props
    return (
      <button
        ref={ref}
        type={type}
        className={clsx('pi-btn', `pi-btn--${variant}`, size !== 'md' && `pi-btn--${size}`, className)}
        {...rest}
      />
    )
  }
  const { className, variant, size, asChild = false, ...rest } = props
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...rest}
    />
  )
})
Button.displayName = 'Button'

export { Button }
