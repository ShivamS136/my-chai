import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../strings.ts';
import { QrCode } from './QrCode.tsx';

vi.mock('../lib/download.ts', () => ({ downloadDataUrl: vi.fn() }));
const { downloadDataUrl } = await import('../lib/download.ts');

const PROPS = {
  svgDataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E',
  alt: 'UPI QR code for shivam@okaxis, amount ₹150',
  filename: 'chai-shivam-okaxis-150.png',
};

describe('QrCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the QR with the VPA and amount as its text alternative', () => {
    // The alt text is the QR's fallback for screen readers and for donors whose
    // images fail — it must carry what the symbol encodes (DESIGN.md a11y).
    render(<QrCode {...PROPS} toPngDataUrl={() => 'data:image/png;base64,AAAA'} />);
    const image = screen.getByRole('img', { name: PROPS.alt });
    expect(image).toHaveAttribute('src', PROPS.svgDataUrl);
  });

  it('captions the QR with the apps it works in', () => {
    render(<QrCode {...PROPS} toPngDataUrl={() => 'data:image/png;base64,AAAA'} />);
    expect(screen.getByText(strings.qrCaption)).toBeInTheDocument();
  });

  it('downloads the PNG under the generated filename (P0.5)', async () => {
    const user = userEvent.setup();
    render(<QrCode {...PROPS} toPngDataUrl={() => 'data:image/png;base64,AAAA'} />);

    await user.click(screen.getByRole('button', { name: strings.qrDownload }));

    expect(downloadDataUrl).toHaveBeenCalledWith('data:image/png;base64,AAAA', PROPS.filename);
  });

  it('does not encode the PNG until the donor asks for it', () => {
    // Encoding eagerly would rebuild ~14KB of base64 on every keystroke.
    const toPngDataUrl = vi.fn(() => 'data:image/png;base64,AAAA');
    render(<QrCode {...PROPS} toPngDataUrl={toPngDataUrl} />);
    expect(toPngDataUrl).not.toHaveBeenCalled();
  });
});
