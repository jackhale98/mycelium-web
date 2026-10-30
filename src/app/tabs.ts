/// Tabs on the same vault: one edits, the others follow. Every tab keeps the
/// vault in memory, and a save writes a whole file, so two tabs editing the
/// same note would overwrite each other. The tab that opened a vault last
/// (or was asked to, with "Edit here") claims it; the others are told, stop
/// writing, and reload from this browser's storage whenever the editing tab
/// says it saved, so they're never stale.

export type TabMessage =
	/** A tab now edits this vault; any other on it follows. */
	| { type: 'claim'; vault: string; tab: string }
	/** The editing tab wrote to this vault (notes, commits, sync, settings). */
	| { type: 'changed'; vault: string; tab: string };

const CHANNEL = 'mycelium-tabs';

export class TabLink {
	readonly id = crypto.randomUUID();
	#channel: BroadcastChannel | null = null;

	constructor(onMessage: (message: TabMessage) => void) {
		if (typeof BroadcastChannel === 'undefined') return;
		this.#channel = new BroadcastChannel(CHANNEL);
		this.#channel.onmessage = (e: MessageEvent<TabMessage>) => {
			if (e.data?.tab !== this.id) onMessage(e.data);
		};
	}

	claim(vault: string) {
		this.#post({ type: 'claim', vault, tab: this.id });
	}

	changed(vault: string) {
		this.#post({ type: 'changed', vault, tab: this.id });
	}

	#post(message: TabMessage) {
		try {
			this.#channel?.postMessage(message);
		} catch {
			// Closed (the page is going away): nothing to tell.
		}
	}
}
