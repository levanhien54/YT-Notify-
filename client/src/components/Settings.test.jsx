import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Settings from './Settings.jsx';

const settings = {
  webhook_port: '8787',
  mgmt_port: '5174',
  download_dir: 'downloads',
  max_concurrency: '2',
  lease_seconds: '432000',
};

describe('Settings', () => {
  it('renders editable download_dir and max_concurrency fields', () => {
    render(<Settings settings={settings} onSave={() => {}} />);
    expect(screen.getByLabelText(/download dir/i)).toHaveValue('downloads');
    expect(screen.getByLabelText(/concurrency/i)).toHaveValue('2');
  });

  it('renders read-only fields: webhook_port, mgmt_port, lease_seconds', () => {
    render(<Settings settings={settings} onSave={() => {}} />);
    expect(screen.getByText('8787')).toBeInTheDocument();
    expect(screen.getByText('5174')).toBeInTheDocument();
    expect(screen.getByText('432000')).toBeInTheDocument();
  });

  it('saves the edited values', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<Settings settings={settings} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/download dir/i), { target: { value: 'D:/yt' } });
    fireEvent.change(screen.getByLabelText(/concurrency/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ download_dir: 'D:/yt', max_concurrency: '4' })
    );
  });

  it('disables Save while saving', async () => {
    let resolve;
    const onSave = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<Settings settings={settings} onSave={onSave} />);
    const btn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    resolve({});
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('shows "Saved" feedback after successful save', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<Settings settings={settings} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  it('shows error message on save failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<Settings settings={settings} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });
});
