interface ImportMetaEnv {
	readonly PUBLIC_GIT_PROXY?: string;
	readonly PUBLIC_GITHUB_CLIENT_ID?: string;
	readonly PUBLIC_GITHUB_APP_SLUG?: string;
	readonly PUBLIC_GITLAB_CLIENT_ID?: string;
	readonly PUBLIC_BITBUCKET_CLIENT_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
