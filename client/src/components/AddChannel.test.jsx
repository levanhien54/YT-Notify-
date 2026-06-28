import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddChannel from './AddChannel.jsx';

describe('AddChannel', () => {
  it('calls onAdd with trimmed input on submit and clears the field', async () => {
    const onAdd = vi.fn().mockResolvedValue({ channel_id: 'UC1' });
    render(<AddChannel onAdd={onAdd} />);
    const input = screen.getByPlaceholderText(/@handle/i);
    fireEvent.change(input, { target: { value: '  @cool  ' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).toHaveBeenCalledWith('@cool');
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('does not call onAdd for empty/whitespace input', () => {
    const onAdd = vi.fn();
    render(<AddChannel onAdd={onAdd} />);
    fireEvent.change(screen.getByPlaceholderText(/@handle/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('disables the button while the add is pending', async () => {
    let resolve;
    const onAdd = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<AddChannel onAdd={onAdd} />);
    fireEvent.change(screen.getByPlaceholderText(/@handle/i), { target: { value: '@x' } });
    const btn = screen.getByRole('button', { name: /add/i });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    resolve({ channel_id: 'UCx' });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
