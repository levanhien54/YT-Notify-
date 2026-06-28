import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ChannelList from './ChannelList.jsx';

const channels = [
  { channel_id: 'UC1', title: 'Alpha', handle: '@alpha', thumbnail: '', active: 1 },
  { channel_id: 'UC2', title: 'Beta', handle: '@beta', thumbnail: '', active: 0 },
];

describe('ChannelList', () => {
  it('renders one row per channel with its title', () => {
    render(<ChannelList channels={channels} onToggle={() => {}} onRemove={() => {}} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows an empty state when there are no channels', () => {
    render(<ChannelList channels={[]} onToggle={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/no channels/i)).toBeInTheDocument();
  });

  it('toggles with the negated active state', () => {
    const onToggle = vi.fn();
    render(<ChannelList channels={channels} onToggle={onToggle} onRemove={() => {}} />);
    const alphaRow = screen.getByText('Alpha').closest('li');
    fireEvent.click(within(alphaRow).getByRole('button', { name: /toggle/i }));
    expect(onToggle).toHaveBeenCalledWith('UC1', false);
  });

  it('removes by channel id', () => {
    const onRemove = vi.fn();
    render(<ChannelList channels={channels} onToggle={() => {}} onRemove={onRemove} />);
    const betaRow = screen.getByText('Beta').closest('li');
    fireEvent.click(within(betaRow).getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith('UC2');
  });
});
