import { z } from 'zod';

// TODO use translations for all error messages
// TODO double check all validations with the original code in RegisterForm.tsx from Github

// Common validation patterns
export const emailSchema = z.email();

export const nameSchema = z
    .string()
    .min(1, 'Name is required')
    .max(64, 'Name must be 64 characters or less')
    .regex(/^[a-zA-Z0-9\s]+$/, 'Name can only contain letters, numbers, and spaces');

export const subdomainSchema = z
    .string()
    .min(2, 'Subdomain must be at least 2 characters')
    .max(32, 'Subdomain must be 32 characters or less')
    .regex(/^[a-z0-9-]+$/, 'Subdomain can only contain lowercase letters, numbers, and hyphens')
    .refine((val) => !val.startsWith('-') && !val.endsWith('-'), {
        message: 'Subdomain cannot start or end with a hyphen',
    });

export const apiSecretSchema = z
    .string()
    .min(12, 'API secret must be at least 12 characters')
    .max(32, 'API secret must be 32 characters or less')
    .regex(/^[a-zA-Z0-9\-_.]+$/, 'API secret can only contain letters, numbers, hyphens, underscores, and dots');

export const validationCodeSchema = z
    .string()
    .regex(/^\s*\d{6}\s*$/, 'Validation code must be exactly 6 digits')
    .transform((val) => val.trim()); // Remove whitespace

export const dexcomCredentialsSchema = z
    .string()
    .min(5, 'Must be at least 5 characters')
    .max(32, 'Must be 32 characters or less')
    .regex(/^[a-zA-Z0-9!@#$%^&*().+\-]+$/, 'Invalid characters in credentials');

// Registration form schema
export const registrationFormSchema = z
    .object({
        ownerName: nameSchema,
        ownerEmail: emailSchema,
        emailValidationCode: validationCodeSchema
            .nullable()
            .optional()
            .transform((val) => val ?? undefined), // Allow null or undefined
        subDomain: subdomainSchema,
        nsTitle: z
            .string()
            .min(1, 'Title is required')
            .max(50, 'Title must be 50 characters or less')
            .optional()
            .default('Nightscout'),
        apiSecret: apiSecretSchema,
        dataSource: z.enum(['Dexcom', 'API'], {
            message: 'Data source must be either Dexcom or API',
        }),
        dexcomServer: z.enum(['EU', 'US']).optional(),
        dexcomUsername: z.string().optional(),
        dexcomPassword: z.string().optional(),
        reCAPTCHAToken: z.string().min(10, 'Invalid reCAPTCHA token'),
        emailVerificationToken: validationCodeSchema,
    })
    .refine(
        (data) => {
            if (data.dataSource === 'Dexcom') {
                return (
                    data.dexcomServer &&
                    data.dexcomUsername &&
                    data.dexcomPassword &&
                    dexcomCredentialsSchema.safeParse(data.dexcomUsername).success &&
                    data.dexcomPassword.length >= 5
                );
            }
            return true;
        },
        {
            message: 'Dexcom credentials are required when using Dexcom as data source',
            path: ['dexcomUsername'],
        }
    );

// Email validation schemas for API routes
export const emailValidationRequestSchema = z.object({
    email: emailSchema,
    token: z.string().min(10, 'Invalid token'),
});

export const emailVerificationRequestSchema = z.object({
    email: emailSchema,
    token: z.string().min(10, 'Invalid token'),
    code: validationCodeSchema,
});

export const subdomainValidationRequestSchema = z.object({
    token: z.string().min(10, 'Invalid token'),
    subdomain: subdomainSchema,
});

// Domain registration request schema (for API)
export const registerDomainRequestSchema = z.object({
    domain: subdomainSchema,
    title: z.string().min(1).max(50).default('Nightscout'),
    apiSecret: apiSecretSchema,
    ownerEmail: emailSchema,
    ownerName: nameSchema,
    dataSource: z.enum(['Dexcom', 'API']),
    dexcomUsername: z.string().optional(),
    dexcomPassword: z.string().optional(),
    dexcomServer: z.enum(['EU', 'US']).optional(),
    emailVerificationToken: validationCodeSchema,
    reCAPTCHAToken: z.string().min(10),
});

// Type exports for TypeScript
export type RegistrationFormData = z.infer<typeof registrationFormSchema>;
export type EmailValidationRequest = z.infer<typeof emailValidationRequestSchema>;
export type EmailVerificationRequest = z.infer<typeof emailVerificationRequestSchema>;
export type SubdomainValidationRequest = z.infer<typeof subdomainValidationRequestSchema>;
export type RegisterDomainRequest = z.infer<typeof registerDomainRequestSchema>;
