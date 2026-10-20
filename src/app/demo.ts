/// The bundled demo vault, used until a repository is connected.

const files = import.meta.glob('../demo/vault/**/*.org', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

export const demoSources: Record<string, string> = Object.fromEntries(
	Object.entries(files).map(([path, source]) => [path.replace('../demo/vault/', ''), source]),
);
