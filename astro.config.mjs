// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  adapter: cloudflare({ imageService: 'passthrough' }),
  // We don't use Astro sessions; disabling stops the adapter provisioning a KV namespace at deploy
  session: false,
});