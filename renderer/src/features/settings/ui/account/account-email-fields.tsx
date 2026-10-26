/** Login and account proof use the same fields; proof fixes the destination. */
import { InputField, InputGroup } from '@/components/ui/input-group';

import { AccountCodeField } from './account-code-field';

export function AccountEmailFields({
  email,
  onEmailChange,
  access,
}: {
  email: string;
  onEmailChange?: ((email: string) => void) | undefined;
  access: {
    readonly busy: boolean;
    readonly sent: boolean;
    readonly otp: string;
    readonly remaining: number;
    setOtp(value: string): void;
    send(): void;
  };
}) {
  return (
    <>
      <InputGroup className="w-full">
        <InputField
          key="email"
          label="Email"
          resting="outline"
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
          maxLength={320}
          required
          readOnly={!onEmailChange}
          disabled={access.busy}
          value={email}
          onChange={onEmailChange ?? (() => undefined)}
        />
        {access.sent && (
          <AccountCodeField
            value={access.otp}
            onChange={access.setOtp}
            busy={access.busy}
            remaining={access.remaining}
            onResend={access.send}
          />
        )}
      </InputGroup>
      {access.sent && (
        <p className="text-caption text-muted-foreground" role="status">
          Check your inbox. The code expires in five minutes.
        </p>
      )}
    </>
  );
}
