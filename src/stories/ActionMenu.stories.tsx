import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import WavingHandRoundedIcon from "@mui/icons-material/WavingHandRounded";

import ActionsMenu from "../lib/components/ActionsMenu/ActionsMenu";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
	title: "Example/ActionMenu",
	component: ActionsMenu,
	parameters: {
		// Optional parameter to center the component in the Canvas. More info: https://storybook.js.org/docs/configure/story-layout
		layout: "centered",
	},
	// This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
	tags: ["autodocs"],
	// More on argTypes: https://storybook.js.org/docs/api/argtypes
	argTypes: {
		actionsButtonLabel: { control: "text" },
		actions: {
			control: {
				type: "object",
			},
		},
	},
	// Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
	args: {
		actionsButtonLabel: "Options",
		actions: [
			{
				label: "Label 1",
				id: "label-1",
				action: fn(),
				disabled: false,
				icon: <WavingHandRoundedIcon />,
			},
			{
				label: "Label 2",
				id: "label-2",
				action: async () => console.log("Hello 2"),
				disabled: true,
				icon: <WavingHandRoundedIcon />,
			},
			{
				label: "Label 3 - (1.5s)",
				id: "label-3",
				action: async () => new Promise((resolve) => setTimeout(resolve, 1500)),
				disabled: false,
				icon: <WavingHandRoundedIcon />,
			},
		],
	},
} satisfies Meta<typeof ActionsMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Example: Story = {
	args: meta.args, // ✅ Reuse `args` to avoid duplication
};
