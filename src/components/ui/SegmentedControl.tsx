
export interface SegmentOption<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  /** 分组的可访问名称。 */
  label: string
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
}

/** 互斥的少量选项；选中项 aria-pressed 为 true。 */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="pi-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="pi-seg-item"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
