import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
	stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [
		{
			name: "@storybook/addon-essentials",
			options: {
				docs: false,
			},
		},
		"@storybook/addon-onboarding",
		"@chromatic-com/storybook",
		"@storybook/addon-interactions",
		"@storybook/addon-themes",
		"@storybook/addon-docs",
	],

	framework: {
		name: "@storybook/nextjs",
		options: {},
	},
	staticDirs: ["../public"],
	webpackFinal: async (config) => {
		if (config.module && config.module.rules) {
			// Add MDX loader
			config.module.rules.push({
				test: /\.mdx$/,
				use: [
					{
						loader: "babel-loader",
					},
					{
						loader: "@mdx-js/loader",
					},
				],
			});
		}
		return config;
	},
};
export default config;
