import type { Meta, StoryObj } from '@storybook/react';
import NSInput from '@/lib/components/general/NSInput/NSInput';
import { MenuItem } from '@mui/material';
// import ModalEdit from '@/lib/components/ModalEdit/ModalEdit';

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
    title: 'General UI/NSInput',
    component: NSInput,
    parameters: {
        // Optional parameter to center the component in the Canvas. More info: https://storybook.js.org/docs/configure/story-layout
        layout: 'centered',
    },
    // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
    tags: [''],
    // More on argTypes: https://storybook.js.org/docs/api/argtypes
    argTypes: {
        label: { control: 'text' },
        variant: { control: 'inline-radio', options: ['standard', 'outlined', 'filled'] },
        color: { control: 'inline-radio', options: ['primary', 'secondary', 'warning', 'info', 'error'] },
        error: { control: 'boolean' },
    },
    // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
    args: {
        label: 'Input label',
        color: 'primary',
        variant: 'outlined',
        disabled: false,
        value: 'Input value',
        modal: true,
        size: 'small',
        fullWidth: true,
    },
} satisfies Meta<typeof NSInput>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Example: Story = {
    args: meta.args, // ✅ Reuse `args` to avoid duplication
};


export const MoreInformationButton: Story = {
    args: {
        ...meta.args,
		modal: false,
        moreInformation: 'This is a tooltip with more information',
    },
};

export const AsSelectInput: Story = {
    args: {
        ...meta.args,
		modal: false,
        select: true,
        value: 'EU',
        moreInformation: 'This is a tooltip with more information',
        children: [
            <MenuItem value="EU" key="EU">Europe</MenuItem>,
            <MenuItem value="USA" key="USA">United States</MenuItem>,
            <MenuItem value="ASIA" key="ASIA">ASIA</MenuItem>
        ]
    },
};