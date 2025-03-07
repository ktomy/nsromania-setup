import { z, ZodType } from 'zod'; // Add new import
import { Formats, TranslationValues } from 'next-intl';
import messages from '../../../../messages/en.json';
import { ValidateEmailForm } from './RegisterForm';

export type TranslateFunction = <TargetKey extends any>(
    key: TargetKey,
    values?: TranslationValues,
    formats?: Formats
) => string;

const useEmailValidationSchema: (t: TranslateFunction) => ZodType<ValidateEmailForm> = (t: TranslateFunction) => {
    return z.object({
        ownerName: z
            .string()
            .min(3, t('formValidation.min', { min: 3 }))
            .nonempty('formValidation.required'),
        ownerEmail: z.string().email(t('formValidation.email')).nonempty(t('formValidation.required')),
    });
};

export default useEmailValidationSchema;
