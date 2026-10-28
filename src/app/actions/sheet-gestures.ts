/// A bottom sheet on phones (a modal <dialog>): while it's open the page
/// behind it can't scroll, and pulling the sheet down closes it, from its
/// grip or anywhere in it whose content is scrolled to the top. Touches that
/// start in a field, an editor or something scrolled down scroll as usual.
/// Closing goes through dialog.close(), so each sheet's own onclose runs.

const PHONE = '(max-width: 720px)';

export function sheetGestures(node: HTMLDialogElement) {
	const phone = () => matchMedia(PHONE).matches;

	// ---- the page behind stays still while the sheet is open ----
	let unlock: (() => void) | null = null;
	function lock() {
		if (unlock || !phone()) return;
		const root = document.documentElement;
		const { overflow, overscrollBehavior } = root.style;
		const bodyOverflow = document.body.style.overflow;
		root.style.overflow = 'hidden';
		root.style.overscrollBehavior = 'none';
		document.body.style.overflow = 'hidden';
		unlock = () => {
			root.style.overflow = overflow;
			root.style.overscrollBehavior = overscrollBehavior;
			document.body.style.overflow = bodyOverflow;
			unlock = null;
		};
	}
	const sync = () => (node.open ? lock() : unlock?.());
	const watch = new MutationObserver(sync);
	watch.observe(node, { attributes: true, attributeFilter: ['open'] });
	sync();

	// ---- pull down to close ----
	/** Whether a touch here would scroll or type rather than pull the sheet. */
	function ownsTouch(target: EventTarget | null): boolean {
		for (let n = target as HTMLElement | null; n && n !== node.parentElement; n = n.parentElement) {
			if (n.matches('textarea, input, select, [contenteditable], .cm-editor')) return true;
			if (n.scrollTop > 0) return true;
		}
		return false;
	}
	let start: { y: number; t: number } | null = null;
	let pull: number | null = null;
	function reset() {
		pull = null;
		node.style.removeProperty('transform');
		node.style.removeProperty('transition');
	}
	function dismiss() {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduced) {
			reset();
			node.close();
			return;
		}
		node.style.transition = 'transform 0.16s ease-in';
		node.style.transform = 'translateY(100%)';
		setTimeout(() => {
			node.close();
			reset();
		}, 160);
	}
	const touchstart = (e: TouchEvent) => {
		start =
			node.open && phone() && e.touches.length === 1 && !ownsTouch(e.target)
				? { y: e.touches[0]!.clientY, t: e.timeStamp }
				: null;
	};
	const touchmove = (e: TouchEvent) => {
		if (!start) return;
		const dy = e.touches[0]!.clientY - start.y;
		if (pull === null) {
			if (dy < -6) start = null; // scrolling the sheet's content up
			if (dy < 6 || !start) return;
		}
		e.preventDefault();
		pull = Math.max(0, dy);
		node.style.transition = 'none';
		node.style.transform = `translateY(${pull}px)`;
	};
	const touchend = (e: TouchEvent) => {
		if (start && pull !== null) {
			const dy = (e.changedTouches[0]?.clientY ?? start.y) - start.y;
			const fast = dy / Math.max(1, e.timeStamp - start.t) > 0.5;
			if (e.type !== 'touchcancel' && (dy > 100 || (fast && dy > 30))) dismiss();
			else {
				node.style.transition = 'transform 0.2s ease';
				node.style.transform = '';
				pull = null;
			}
		}
		start = null;
	};
	node.addEventListener('touchstart', touchstart, { passive: true });
	node.addEventListener('touchmove', touchmove, { passive: false });
	node.addEventListener('touchend', touchend);
	node.addEventListener('touchcancel', touchend);

	return {
		destroy() {
			watch.disconnect();
			unlock?.();
			node.removeEventListener('touchstart', touchstart);
			node.removeEventListener('touchmove', touchmove);
			node.removeEventListener('touchend', touchend);
			node.removeEventListener('touchcancel', touchend);
		},
	};
}
