import type { StorybookConfig } from '@storybook/nextjs';

const config: StorybookConfig = {
  "stories": [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [{
    "name": "@storybook/addon-essentials",
    "options": {
      "docs": false
    }
  }, "@storybook/addon-onboarding", "@chromatic-com/storybook", "@storybook/addon-interactions", "@storybook/addon-themes"],
  "framework": {
    "name": "@storybook/nextjs",
    "options": {}
  },
  "staticDirs": [
    "../public"
  ]
};
export default config;