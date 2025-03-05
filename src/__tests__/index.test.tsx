/**
 * @jest-environment jsdom
 */
import { render, screen } from 'test-utils';

import RegisterForm from '../app/welcome/register/RegisterForm';
import { useTranslations } from 'next-intl';

describe('Home', () => {
    it('renders a heading', () => {
        render(<RegisterForm />);

        const validateButton = screen.getByRole('button', { name: 'Validează' });

        expect(validateButton).toBeInTheDocument();
    });
});
