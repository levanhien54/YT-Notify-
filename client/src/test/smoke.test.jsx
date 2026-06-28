import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

function Hello() {
  return <h1>YT-Notify</h1>;
}

describe('test harness', () => {
  it('renders a component into jsdom and matches jest-dom', () => {
    render(<Hello />);
    expect(screen.getByRole('heading', { name: 'YT-Notify' })).toBeInTheDocument();
  });
});
