// A single shared 1-second ticker for all rendered trackers, instead of every
// tracker block starting its own setInterval. Entries are pruned automatically
// once their element leaves the DOM, and the underlying interval is only alive
// while at least one tracker is listening.

interface TickListener {
    element: HTMLElement;
    callback: () => void;
}

const listeners: Set<TickListener> = new Set();
let intervalId: number = null;

function tick(): void {
    for (const listener of Array.from(listeners)) {
        if (!listener.element.isConnected) {
            listeners.delete(listener);
            continue;
        }
        listener.callback();
    }
    if (listeners.size === 0 && intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
    }
}

// Call callback once a second for as long as element stays connected to the DOM.
export function onTick(element: HTMLElement, callback: () => void): void {
    listeners.add({ element, callback });
    if (intervalId === null)
        intervalId = window.setInterval(tick, 1000);
}
