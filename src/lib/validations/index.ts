import { z } from 'zod';

// Type for translation function
type T = (key: string) => string;

// Common validation patterns
export const emailSchema = (t: T) => z.email(t('errors.email.invalid')).min(1, t('errors.email.required'));

export const nameSchema = (t: T) =>
    z
        .string()
        .min(1, t('errors.name.required'))
        .max(64, t('errors.name.max'))
        .regex(/^[a-zA-Z0-9\s]+$/, t('errors.name.pattern'));

export const subdomainSchema = (t: T) =>
    z
        .string()
        .min(1, t('errors.subdomain.required'))
        .max(63, t('errors.subdomain.max'))
        .regex(/^[a-z0-9-]+$/, t('errors.subdomain.pattern'))
        .refine((val) => !val.startsWith('-') && !val.endsWith('-'), {
            error: t('errors.subdomain.hyphen'),
        });

export const apiSecretSchema = (t: T) =>
    z
        .string()
        .min(12, t('errors.apiSecret.min'))
        .max(32, t('errors.apiSecret.max'))
        .regex(/^[a-zA-Z0-9-\_\.]+$/, t('errors.apiSecret.pattern'));

export const validationCodeSchema = (t: T) =>
    z
        .string()
        .regex(/^\s*\d{6}\s*$/, t('errors.validationCode.pattern'))
        .transform((val) => val.trim());

export const dexcomCredentialsSchema = (t: T) =>
    z
        .string()
        .min(5, t('errors.dexcomCredentials.min'))
        .max(32, t('errors.dexcomCredentials.max'))
        .regex(/^[a-zA-Z0-9!@#$%^&*().+\-]+$/, t('errors.dexcomCredentials.pattern'));

export const reCAPTCHATokenSchema = (t: T) => z.string().min(10, t('errors.reCAPTCHA.invalid'));

// Registration form schema
export const registrationFormSchema = (t: T) =>
    z
        .object({
            ownerName: nameSchema(t),
            ownerEmail: emailSchema(t),
            emailVerificationToken: validationCodeSchema(t),
            domain: subdomainSchema(t),
            title: z
                .string()
                .min(1, t('errors.nsTitle.required'))
                .max(50, t('errors.nsTitle.max'))
                .optional()
                .default('Nightscout'),
            apiSecret: apiSecretSchema(t),
            dataSource: z.enum(['Dexcom', 'API'], {
                error: t('errors.dataSource.invalid'),
            }),
            dexcomServer: z.enum(['EU', 'US'], { error: t('errors.dexcomServer.invalid') }).optional(),
            dexcomUsername: z.string().optional(),
            dexcomPassword: z.string().optional(),
        })
        .check((ctx) => {
            if (ctx.value.dataSource === 'Dexcom') {
                // Username validation
                if (!ctx.value.dexcomUsername) {
                    ctx.issues.push({
                        code: 'custom',
                        path: ['dexcomUsername'],
                        message: t('errors.dexcomUsername.required'),
                        input: ctx.value.dexcomUsername,
                    });
                } else {
                    const parsed = dexcomCredentialsSchema(t).safeParse(ctx.value.dexcomUsername);

                    if (!parsed.success) {
                        parsed.error.issues.forEach((err) => {
                            ctx.issues.push({
                                code: 'custom',
                                path: ['dexcomUsername'],
                                message: err.message,
                                input: ctx.value.dexcomUsername,
                            });
                        });
                    }
                }

                // Password validation
                if (!ctx.value.dexcomPassword) {
                    ctx.issues.push({
                        code: 'custom',
                        path: ['dexcomPassword'],
                        message: t('errors.dexcomPassword.required'),
                        input: ctx.value.dexcomPassword,
                    });
                } else if (ctx.value.dexcomPassword.length < 5) {
                    ctx.issues.push({
                        code: 'custom',
                        path: ['dexcomPassword'],
                        message: t('errors.dexcomPassword.min'),
                        input: ctx.value.dexcomPassword,
                    });
                }
            }
        });

// Schemas for API requests bodies
export const validateSubdomainRequestSchema = (t: T) =>
    z.object({
        subdomain: subdomainSchema(t),
        token: reCAPTCHATokenSchema(t),
    });

export const validateEmailRequestSchema = (t: T) =>
    z.object({
        email: emailSchema(t),
        token: reCAPTCHATokenSchema(t),
    });

export const validateVerificationCodeRequestSchema = (t: T) =>
    z.object({
        email: emailSchema(t),
        token: reCAPTCHATokenSchema(t),
        code: validationCodeSchema(t),
    });

export const serverRegistrationRequestSchema = (t: T) =>
    registrationFormSchema(t).safeExtend({
        reCAPTCHAToken: reCAPTCHATokenSchema(t),
    });

// Type exports for TypeScript
export type RegistrationFormData = z.infer<ReturnType<typeof registrationFormSchema>>;
