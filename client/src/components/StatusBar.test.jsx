import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StatusBar from './StatusBar.jsx';

describe('StatusBar', () => {
  it('shows offline status and a Start button', () => {
    const onStart = vi.fn();
    render(<StatusBar tunnel={{ status: 'offline', url: null }} onStart={onStart} onStop={() => {}} />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /start/i });
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows the public url and a Stop button when online', () => {
    const onStop = vi.fn();
    render(
      <StatusBar
        tunnel={{ status: 'online', url: 'https://x.trycloudflare.com' }}
        onStart={() => {}}
        onStop={onStop}
      />
    );
    expect(screen.getByText('x.trycloudflare.com')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /stop/i });
    fireEvent.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows connecting status with a Stop button', () => {
    render(<StatusBar tunnel={{ status: 'connecting', url: null }} onStart={() => {}} onStop={() => {}} />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });
});
