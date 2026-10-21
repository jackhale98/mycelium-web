/// The file services a cloud vault can live in, and how to reach each one.

import type { CloudService, CloudState } from '$lib/store/db';
import type { RemoteBrowser, RemoteFiles } from './remote';

export interface CloudConfig {
	/** Dropbox app key. */
	dropboxAppKey?: string | undefined;
	/** Microsoft Entra application (client) ID. */
	onedriveClientId?: string | undefined;
}

export type CloudClient = RemoteFiles & RemoteBrowser;

export interface OAuthTokens {
	accessToken: string;
	refreshToken: string | null;
	expiresAt: number | null;
}

export const SERVICES: Record<
	CloudService,
	{
		name: string;
		/** Paths that differ only in case are different files. */
		caseSensitive: boolean;
		/** How often to look for changes while the app is open. */
		poll: number;
	}
> = {
	dropbox: { name: 'Dropbox', caseSensitive: false, poll: 60_000 },
	onedrive: { name: 'OneDrive', caseSensitive: false, poll: 60_000 },
	// No change feed: each check lists the folder. Every 5 minutes unless the server
	// lists cheaply (see CloudWorkspace.basePoll).
	webdav: { name: 'WebDAV', caseSensitive: true, poll: 300_000 },
};

/** The display name, e.g. "OneDrive" or "SharePoint · Team site". */
export function serviceLabel(state: Pick<CloudState, 'service' | 'driveName' | 'url'>): string {
	if (state.service === 'onedrive' && state.driveName) return state.driveName;
	if (state.service === 'webdav' && state.url) {
		try {
			return new URL(state.url).host;
		} catch {
			/* fall through */
		}
	}
	return SERVICES[state.service].name;
}

/** A client for the service, using `token` for OAuth services. */
export async function openClient(
	state: CloudState,
	token: (force?: boolean) => Promise<string>,
	fetcher?: typeof fetch,
): Promise<CloudClient> {
	switch (state.service) {
		case 'dropbox': {
			const { DropboxApi } = await import('$lib/dropbox/api');
			return new DropboxApi(token, fetcher);
		}
		case 'onedrive': {
			const { GraphDrive } = await import('$lib/onedrive/api');
			if (!state.driveId) throw new Error('This vault has no OneDrive drive.');
			return new GraphDrive(state.driveId, token, fetcher);
		}
		case 'webdav': {
			const { WebDav } = await import('$lib/webdav/api');
			return new WebDav(
				{
					url: state.url ?? '',
					username: state.username ?? '',
					password: state.password ?? '',
					proxy: state.proxy ?? null,
				},
				fetcher,
			);
		}
	}
}

/** Renew an OAuth sign-in with its refresh token. */
export async function refreshTokens(
	state: CloudState,
	config: CloudConfig,
	fetcher?: typeof fetch,
): Promise<OAuthTokens> {
	if (!state.refreshToken) throw new Error('No refresh token');
	if (state.service === 'dropbox') {
		const { refreshDropboxToken } = await import('$lib/dropbox/api');
		return refreshDropboxToken(config.dropboxAppKey ?? '', state.refreshToken, fetcher);
	}
	if (state.service === 'onedrive') {
		const { refreshMicrosoftToken } = await import('$lib/onedrive/api');
		return refreshMicrosoftToken(config.onedriveClientId ?? '', state.refreshToken, fetcher);
	}
	throw new Error(`${SERVICES[state.service].name} doesn't use sign-in tokens`);
}
