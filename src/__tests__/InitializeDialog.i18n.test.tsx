import React from 'react';
import path from 'path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMockTranslator, extractTranslationKeys, validateTranslationKeys } from '@/lib/test-utils';
import InitializeDialog from '@/app/(home)/domains/[id]/InitializeDialog';

jest.mock('next-intl', () => ({
    useTranslations: () => createMockTranslator(),
}));

const SERVERS = [
    { id: 'main', hostname: 'nsromania.info' },
    { id: 'd1', hostname: 'd1.nsromania.info' },
];

describe('InitializeDialog', () => {
    it('all translation keys exist in all languages', () => {
        const renderResult = render(
            <InitializeDialog open servers={SERVERS} defaultServer="d1" onCancel={jest.fn()} onConfirm={jest.fn()} />
        );
        // Scans the whole document, so the dialog's portal is included
        const keys = extractTranslationKeys(renderResult);

        expect(keys).toEqual(expect.arrayContaining(['initializeDialogTitle', 'initializeServerLabel', 'cancel']));
        validateTranslationKeys(keys, 'DomainPage', path.join(__dirname, '../../messages'));
    });

    it('preselects the default server and confirms the chosen one', () => {
        const onConfirm = jest.fn();
        render(
            <InitializeDialog open servers={SERVERS} defaultServer="d1" onCancel={jest.fn()} onConfirm={onConfirm} />
        );

        const group = screen.getByRole('radiogroup');
        const d1 = within(group).getByRole('radio', { name: /^d1 \(d1\.nsromania\.info\)/ });
        const main = within(group).getByRole('radio', { name: /^main \(nsromania\.info\)/ });
        expect(d1).toBeChecked();
        expect(main).not.toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: /initialize/ }));
        expect(onConfirm).toHaveBeenLastCalledWith('d1');

        fireEvent.click(main);
        fireEvent.click(screen.getByRole('button', { name: /initialize/ }));
        expect(onConfirm).toHaveBeenLastCalledWith('main');
    });

    it('falls back to the first server when the default is not configured', () => {
        const onConfirm = jest.fn();
        render(
            <InitializeDialog open servers={SERVERS} defaultServer="d9" onCancel={jest.fn()} onConfirm={onConfirm} />
        );

        fireEvent.click(screen.getByRole('button', { name: /initialize/ }));
        expect(onConfirm).toHaveBeenCalledWith('main');
    });

    it('cancels without confirming', () => {
        const onCancel = jest.fn();
        const onConfirm = jest.fn();
        render(
            <InitializeDialog open servers={SERVERS} defaultServer="d1" onCancel={onCancel} onConfirm={onConfirm} />
        );

        fireEvent.click(screen.getByRole('button', { name: /cancel/ }));
        expect(onCancel).toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
