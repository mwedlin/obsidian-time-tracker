// A single shared ticker for all rendered trackers, instead of every tracker
// block starting its own timer. Entries are pruned automatically once their
// element leaves the DOM (calling onDisconnect once, if given), and the
// underlying loop only runs while at least one tracker is listening.
//
// Driven by requestAnimationFrame rather than setTimeout/setInterval: rAF is
// scheduled by the renderer's own paint cycle (~60/sec) instead of the
// generic timer queue, which in practice is both more frequent (so a listener
// gating on "has 1000ms passed" gets checked far more often than 4x/sec,
// making it very unlikely for a single delayed check to cost a whole missed
// interval) and smoother for anything meant to update continuously - that's
// what it's for. It also does nothing while the window isn't visible, which
// costs nothing here (nothing to redraw), and self-corrects immediately once
// it resumes, since callbacks recompute from the real current time rather
// than counting elapsed ticks.
interface TickListener {
    element: HTMLElement;
    callback: () => void;
    intervalMs: number;
    lastRun: number;
    onDisconnect?: () => void;
}

const listeners: Set<TickListener> = new Set();
let frameId: number = null;

function frame(): void {
    const now = Date.now();
    for (const listener of Array.from(listeners)) {
        if (!listener.element.isConnected) {
            listeners.delete(listener);
            listener.onDisconnect?.();
            continue;
        }
        if (now - listener.lastRun >= listener.intervalMs) {
            listener.lastRun = now;
            listener.callback();
        }
    }

    if (listeners.size === 0) {
        frameId = null;
        return;
    }
    frameId = window.requestAnimationFrame(frame);
}

// Call callback roughly every intervalMs (default: 1s) for as long as
// element stays connected to the DOM. If onDisconnect is given, it's called
// once, right when element is first found disconnected.
export function onTick(element: HTMLElement, callback: () => void, opts: { intervalMs?: number; onDisconnect?: () => void } = {}): void {
    listeners.add({ element, callback, intervalMs: opts.intervalMs ?? 1000, lastRun: 0, onDisconnect: opts.onDisconnect });
    if (frameId === null)
        frameId = window.requestAnimationFrame(frame);
}
