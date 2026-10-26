import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/input-group';

export function AccountCodeField({
  value,
  onChange,
  busy,
  remaining,
  onResend,
}: {
  value: string;
  onChange(value: string): void;
  busy: boolean;
  remaining: number;
  onResend(): void;
}) {
  return (
    <InputField
      label="Six-digit code"
      resting="outline"
      placeholder="000000"
      autoComplete="one-time-code"
      inputMode="numeric"
      pattern="[0-9]{6}"
      maxLength={6}
      required
      value={value}
      onChange={onChange}
      disabled={busy}
      action={
        <Button
          size="compact"
          variant="tertiary"
          disabled={busy || remaining > 0}
          onClick={onResend}
        >
          {remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}
        </Button>
      }
    />
  );
}
