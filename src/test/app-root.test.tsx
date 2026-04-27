import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../app/App';

import { act } from '@testing-library/react';

// Mock sub-components to avoid deep rendering issues
vi.mock('../features/navigation/MenuModules', () => ({
  MainMenuModule: () => <div>Main Menu Mock</div>,
  DeviceSetupModule: ({ onComplete }: any) => (
    <div>
      Device Setup
      <button onClick={onComplete}>Complete Setup</button>
    </div>
  ),
  SpeakingMenuModule: () => <div>Speaking Menu</div>,
  ListeningMenuModule: () => <div>Listening Menu</div>
}));

describe('App Root', () => {
  it('renders and allows completing device setup', async () => {
    render(<App />);
    
    // Initial state should be Device Setup
    expect(screen.getByText('Device Setup')).toBeDefined();
    
    // Complete setup
    await act(async () => {
      screen.getByText('Complete Setup').click();
    });
    
    // Now should show Main Menu
    expect(screen.getByText('Main Menu Mock')).toBeDefined();
  });
});
