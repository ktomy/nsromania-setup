// Unit tests for MaintenanceTools
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import path from 'path';
import { createMockTranslator, extractTranslationKeys, validateTranslationKeys } from '@/lib/test-utils';
import MaintenanceTools from '@/app/(home)/maintenance/MaintenanceTools';

global.fetch = jest.fn(() =>
    Promise.resolve({
        json: () =>
            Promise.resolve({
                counts: {
                    total: 2,
                    inactive: 1,
                    selected: 1,
                },
                results: [
                    {
                        id: 1,
                        domain: 'demo',
                        ownerEmail: 'demo@example.com',
                        active: false,
                        lastUpdated: '2026-05-14T10:00:00.000Z',
                        status: 'eligible',
                    },
                ],
            }),
        ok: true,
    })
) as jest.Mock;

jest.mock('next-intl', () => ({
    useTranslations: () => createMockTranslator(),
}));

describe('MaintenanceTools', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders translated controls and keeps destroy dependent on deactivate', async () => {
        const renderResult = render(<MaintenanceTools />);

        expect(screen.getByText('#$%title$%#')).toBeInTheDocument();
        expect(screen.getByRole('spinbutton', { name: '#$%daysLabel$%#' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '#$%checkButton$%#' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '#$%runButton$%#' })).toBeDisabled();

        const destroyCheckbox = screen.getByRole('checkbox', { name: '#$%destroy$%#' });
        expect(destroyCheckbox).toBeDisabled();

        fireEvent.click(screen.getByRole('checkbox', { name: '#$%deactivate$%#' }));
        fireEvent.click(destroyCheckbox);
        expect(screen.getByRole('checkbox', { name: '#$%deactivate$%#' })).toBeChecked();
        expect(destroyCheckbox).toBeChecked();

        const uniqueKeys = extractTranslationKeys(renderResult);
        const messagesPath = path.join(__dirname, '../../messages');
        validateTranslationKeys(uniqueKeys, 'MaintenancePage', messagesPath);
    });
});
