// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { TraceInspector } from './traceInspector';

it('switches scroll state immediately and resumes following at the newest packet', () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  document.body.innerHTML = '<div id="packet-ticker"></div><div id="inspector"></div>';
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500);
  const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  try {
    new TraceInspector(document.getElementById('inspector')!, vi.fn(), vi.fn(), vi.fn());
    const chat = () => document.querySelector<HTMLElement>('.packet-chat')!;
    const button = () => document.querySelector<HTMLButtonElement>('.packet-chat-live')!;
    expect(button().textContent).toBe('Live');
    chat().scrollTop = 120;
    chat().dispatchEvent(new Event('scroll'));
    expect(button().textContent).toBe('Not live');
    vi.advanceTimersByTime(1000);
    expect(chat().scrollTop).toBe(120);
    expect(button().textContent).toBe('Not live');
    button().click();
    expect(button().textContent).toBe('Live');
    chat().scrollTop = 100;
    chat().dispatchEvent(new Event('scroll'));
    expect(button().textContent).toBe('Not live');
    chat().scrollTop = 400;
    chat().dispatchEvent(new Event('scroll'));
    expect(button().textContent).toBe('Live');
    vi.advanceTimersByTime(1000);
    expect(chat().scrollTop).toBe(500);
  } finally {
    height.mockRestore(); client.mockRestore();
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});
