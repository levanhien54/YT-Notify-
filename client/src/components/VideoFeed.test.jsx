import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import VideoFeed from './VideoFeed.jsx';

const videos = [
  { video_id: 'vid1', title: 'First', channel_id: 'UC1', published_at: Date.now() - 60000, status: 'done', download_path: 'C:/x.mp4' },
  { video_id: 'vid2', title: 'Second', channel_id: 'UC1', published_at: Date.now() - 3600000, status: 'downloading', download_path: null },
];

describe('VideoFeed', () => {
  it('renders a card per video with title and yt thumbnail', () => {
    render(<VideoFeed videos={videos} progress={{}} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    const img = screen.getAllByRole('img')[0];
    expect(img).toHaveAttribute('src', 'https://i.ytimg.com/vi/vid1/hqdefault.jpg');
  });

  it('shows the per-video status label', () => {
    render(<VideoFeed videos={videos} progress={{}} />);
    expect(screen.getByText(/done/i)).toBeInTheDocument();
    expect(screen.getByText(/downloading/i)).toBeInTheDocument();
  });

  it('renders a progress bar with the live percent for downloading videos', () => {
    render(<VideoFeed videos={videos} progress={{ vid2: 73 }} />);
    const card = screen.getByText('Second').closest('article');
    const bar = within(card).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('73');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('shows an empty state with no videos', () => {
    render(<VideoFeed videos={[]} progress={{}} />);
    expect(screen.getByText(/no videos/i)).toBeInTheDocument();
  });
});
