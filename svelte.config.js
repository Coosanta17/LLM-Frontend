import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			// Directory for the built files
			pages: 'build',
			assets: 'build',
			fallback: null // Use 'index.html' if you have client-side routing
		}),
		paths: {
			base: process.env.NODE_ENV === 'development' ? '' : '/LLM-Frontend'
		},
		appDir: 'internal'
	}
};

export default config;
