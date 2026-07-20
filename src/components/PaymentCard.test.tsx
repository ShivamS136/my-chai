import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { type ChaiConfig, type ChaiConfigInput, chaiConfigSchema } from '../config/schema.ts';
import { MAX_NOTE_LENGTH } from '../lib/upi.ts';
import { strings } from '../strings.ts';
import { PaymentCard } from './PaymentCard.tsx';

/**
 * Fixtures go through the real schema rather than hand-built objects, so these
 * tests exercise the same defaults a deployed page gets.
 */
const configFor = (overrides: Partial<ChaiConfigInput> = {}): ChaiConfig =>
  chaiConfigSchema.parse({
    creator: { name: 'Shivam Sharma', vpa: 'shivam@okaxis' },
    chai: { basePrice: 50, presets: [1, 3, 5], defaultNote: 'Chai for your work' },
    ...overrides,
  });

const setup = (overrides: Partial<ChaiConfigInput> = {}) => {
  const user = userEvent.setup();
  render(<PaymentCard config={configFor(overrides)} />);
  return user;
};

/** The QR's alt text carries the amount, so it doubles as an assertion target. */
const qrAltAmount = (): string => {
  const image = screen.getByRole('img', { name: /UPI QR code/ });
  const alt = image.getAttribute('alt') ?? '';
  return alt.replace(/^.*amount ₹/, '');
};

const chip = (chaiCount: number): HTMLElement =>
  screen.getByRole('radio', { name: new RegExp(`^${chaiCount} chai,`) });

describe('PaymentCard — amount selection (P0.3)', () => {
  it('selects one chai by default and shows its QR', () => {
    setup();
    expect(chip(1)).toBeChecked();
    expect(qrAltAmount()).toBe('50');
  });

  it('renders one chip per configured preset', () => {
    setup();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(chip(3)).toHaveAccessibleName('3 chai, ₹150');
  });

  it('regenerates the QR when a different preset is chosen', async () => {
    const user = setup();
    await user.click(chip(5));
    expect(chip(5)).toBeChecked();
    expect(chip(1)).not.toBeChecked();
    expect(qrAltAmount()).toBe('250');
  });

  it('moves selection with arrow keys, as a radiogroup must (DESIGN.md a11y)', async () => {
    const user = setup();
    await user.tab();
    expect(chip(1)).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(chip(3)).toBeChecked();
    expect(qrAltAmount()).toBe('150');

    // Wrapping is part of the native radiogroup contract.
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(chip(1)).toBeChecked();
  });

  it('exposes exactly one tab stop for the whole group', async () => {
    const user = setup();
    await user.tab();
    expect(chip(1)).toHaveFocus();
    await user.tab();
    expect(chip(3)).not.toHaveFocus();
    expect(chip(5)).not.toHaveFocus();
  });

  it('pays the custom amount once one is typed', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(strings.customAmountLabel), '777');
    expect(qrAltAmount()).toBe('777');
  });

  it('deselects every chip while a custom amount is active', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(strings.customAmountLabel), '777');
    for (const count of [1, 3, 5]) expect(chip(count)).not.toBeChecked();
  });

  it('clears the custom amount when a chip is chosen again', async () => {
    // Two competing numbers on screen would be ambiguous about what is payable.
    const user = setup();
    const custom = screen.getByLabelText(strings.customAmountLabel);
    await user.type(custom, '777');
    await user.click(chip(3));
    expect(custom).toHaveValue('');
    expect(qrAltAmount()).toBe('150');
  });

  it('ignores non-numeric input rather than rejecting the keystroke', async () => {
    const user = setup();
    const custom = screen.getByLabelText(strings.customAmountLabel);
    await user.type(custom, '₹1,500');
    expect(custom).toHaveValue('1500');
  });

  it('prompts for an amount instead of showing a QR when the field is emptied', async () => {
    const user = setup();
    const custom = screen.getByLabelText(strings.customAmountLabel);
    await user.type(custom, '5');
    await user.clear(custom);

    expect(screen.queryByRole('img', { name: /UPI QR code/ })).not.toBeInTheDocument();
    expect(screen.getByText(strings.amountPrompt)).toBeInTheDocument();
  });

  it('warns above the soft cap but still pays (P0.3)', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(strings.customAmountLabel), '200000');

    expect(screen.getByText(strings.largeAmountWarning)).toBeInTheDocument();
    // Warn, never block: the QR is still there.
    expect(qrAltAmount()).toBe('2,00,000');
  });

  it('shows no warning at or below the soft cap', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(strings.customAmountLabel), '100000');
    expect(screen.queryByText(strings.largeAmountWarning)).not.toBeInTheDocument();
  });

  it('hides the custom field when the creator disables it', () => {
    setup({ chai: { basePrice: 50, allowCustomAmount: false } });
    expect(screen.queryByLabelText(strings.customAmountLabel)).not.toBeInTheDocument();
  });

  it('shows the resolved amount and VPA together so donors can verify', () => {
    setup();
    expect(screen.getByText(strings.payingTo('50', 'shivam@okaxis'))).toBeInTheDocument();
  });
});

describe('PaymentCard — donor message (P0.4)', () => {
  it('counts what the donor has typed against the UPI note limit', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(strings.messageLabel), 'thanks');
    expect(screen.getByText(strings.messageCounter(6, MAX_NOTE_LENGTH))).toBeInTheDocument();
  });

  it('stops accepting input at the note limit', async () => {
    const user = setup();
    const field = screen.getByLabelText(strings.messageLabel);
    await user.type(field, 'a'.repeat(MAX_NOTE_LENGTH + 20));
    expect(field).toHaveValue('a'.repeat(MAX_NOTE_LENGTH));
  });

  it('counts by code point, so an emoji is one character not two', async () => {
    // UTF-16 length would say 2 and clip mid-surrogate, which throws in
    // encodeURIComponent — the crash upi.ts guards against.
    const user = setup();
    await user.type(screen.getByLabelText(strings.messageLabel), '🙏');
    expect(screen.getByText(strings.messageCounter(1, MAX_NOTE_LENGTH))).toBeInTheDocument();
  });

  it('warns that some apps drop emoji, without blocking them', async () => {
    const user = setup();
    const field = screen.getByLabelText(strings.messageLabel);
    await user.type(field, 'chai 🙏');

    expect(screen.getByText(strings.messageEmojiWarning)).toBeInTheDocument();
    expect(field).toHaveValue('chai 🙏');
  });

  it('shows no emoji warning for plain text', async () => {
    const user = setup();
    await user.type(screen.getByLabelText(strings.messageLabel), 'thanks a lot');
    expect(screen.queryByText(strings.messageEmojiWarning)).not.toBeInTheDocument();
  });

  it("offers the creator's default note as the placeholder", () => {
    setup();
    expect(screen.getByLabelText(strings.messageLabel)).toHaveAttribute(
      'placeholder',
      'Chai for your work',
    );
  });

  it('lets a donor type a space mid-message without it being trimmed away', async () => {
    // Sanitising on each keystroke would eat the trailing space and make the
    // next word impossible to start.
    const user = setup();
    const field = screen.getByLabelText(strings.messageLabel);
    await user.type(field, 'thanks ');
    expect(field).toHaveValue('thanks ');
  });

  it('hides the message field when the creator disables it', () => {
    setup({ chai: { basePrice: 50, allowDonorMessage: false } });
    expect(screen.queryByLabelText(strings.messageLabel)).not.toBeInTheDocument();
  });
});

describe('PaymentCard — honest UX', () => {
  it('never implies the payment completed', () => {
    setup();
    expect(screen.getByText(strings.noConfirmationNote)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(
      /thank you for your donation|payment (received|successful)|transaction successful/i,
    );
  });

  it('keeps the QR available for a donor who has typed nothing but an amount', () => {
    setup();
    expect(screen.getByRole('img', { name: /UPI QR code/ })).toBeInTheDocument();
  });
});
