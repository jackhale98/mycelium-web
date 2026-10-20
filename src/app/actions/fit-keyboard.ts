/// Keep a bottom sheet inside the part of the screen the on-screen keyboard
/// leaves visible. iOS doesn't resize the page for the keyboard, so a sheet
/// pinned to the bottom slides up under the status bar instead; this sizes
/// it to the visual viewport and lifts it above the keyboard.

export function fitKeyboard(node: HTMLElement) {
	const vv = window.visualViewport;
	if (!vv) return;
	const update = () => {
		// Only phones use the bottom-sheet layout.
		if (!matchMedia('(max-width: 720px)').matches) {
			node.style.removeProperty('--kb');
			node.style.removeProperty('--vvh');
			return;
		}
		const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
		node.style.setProperty('--kb', `${Math.round(keyboard)}px`);
		node.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
	};
	update();
	vv.addEventListener('resize', update);
	vv.addEventListener('scroll', update);
	return {
		destroy() {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
		},
	};
}
