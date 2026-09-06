import { z } from 'zod';

const ROLE_NOUNS = new Set([
  'administrator', 'analyst', 'architect', 'assistant', 'banker', 'consultant', 'coordinator',
  'developer', 'director', 'engineer', 'executive', 'founder', 'lead', 'manager', 'officer',
  'president', 'principal', 'programmer', 'recruiter', 'representative', 'specialist', 'supervisor',
  'technician', 'vp', 'ceo', 'cio', 'cfo', 'cto', 'owner', 'designer', 'accountant', 'associate',
  'advisor', 'strategist', 'scientist', 'operator', 'dba',
]);

const ACTION_VERBS = new Set([
  'administered', 'architected', 'automated', 'built', 'collaborated', 'configured', 'coordinated',
  'created', 'deployed', 'designed', 'developed', 'directed', 'documented', 'drove', 'engineered',
  'established', 'executed', 'implemented', 'improved', 'integrated', 'led', 'maintained', 'managed',
  'migrated', 'modernized', 'monitored', 'optimized', 'partnered', 'performed', 'provided', 'reduced',
  'resolved', 'supported', 'troubleshot', 'upgraded', 'delivered', 'oversaw', 'trained', 'installed',
  'assisted', 'analyzed', 'tested', 'secured', 'streamlined', 'introduced', 'supervised',
]);

const HTTP_URL_RE = /^https?:\/\//i;
const RESUME_EXT_RE = /\.(docx|pdf|txt|md|rtf)$/i;

export const jobUrlSchema = z
  .string()
  .trim()
  .min(1, 'Job URL is required.')
  .url('Enter a valid job URL.')
  .refine((value) => HTTP_URL_RE.test(value), 'Job URL must start with http:// or https://.');

export const outputFormatSchema = z.enum(['all', 'docx', 'pdf', 'rtf']);

export const resumeFileSchema = z
  .any()
  .refine((file) => file && typeof file.name === 'string', 'Resume file is required.')
  .refine((file) => RESUME_EXT_RE.test(file?.name || ''), 'Resume must be DOCX, PDF, TXT, MD, or RTF.')
  .refine((file) => file?.size <= 10 * 1024 * 1024, 'Resume files must be 10 MB or smaller.');

export const jobTitleSchema = z.string().trim().max(80).refine((value) => {
  if (!value) return true;

  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length || words.length > 10) return false;
  if (/[.;:]$/.test(value) || value.includes(',')) return false;
  if (words.some((word) => ACTION_VERBS.has(word))) return false;
  return words.some((word) => ROLE_NOUNS.has(word));
}, 'Invalid job title: expected a short noun/adjective position title.');

export const companyNameSchema = z.string().trim().max(120);
export const descriptionSchema = z.string().trim().min(1).max(1000);
export const extractedSectionItemSchema = z.string().trim().min(1).max(500);

export const extractedResumeJobSchema = z.object({
  number: z.number().int().positive(),
  job: z.string().trim().min(1).max(150),
  company: companyNameSchema,
  descriptions: z.array(descriptionSchema).default([]),
});

export const resumeExtractionSchema = z.object({
  target_position_title: z.string().trim().max(150),
  executive_summary: z.string().trim().max(5000),
  skills: z.array(z.string().trim().min(1).max(120)),
  experience: z.array(extractedResumeJobSchema),
  education: z.array(extractedSectionItemSchema).default([]),
  clearances: z.array(extractedSectionItemSchema).default([]),
  certifications: z.array(extractedSectionItemSchema).default([]),
});

export const generateResponseSchema = z.object({
  job_title: z.string(),
  company: z.string(),
  preview: z.string(),
  thumbnail: z.string(),
  files: z.record(z.string()),
  keywords: z.array(z.object({ keyword: z.string(), status: z.enum(['present', 'review']) })).default([]),
});

export const generationFormSchema = z.object({
  resume: resumeFileSchema,
  jobUrl: z.string().trim().max(2048),
  jobDescription: z.string().trim().max(30000),
  outputFormat: outputFormatSchema,
}).refine((value) => value.jobDescription.length >= 100 || (!value.jobDescription && jobUrlSchema.safeParse(value.jobUrl).success),
  'Enter a valid job URL or paste at least 100 characters of the job description.');

export function zodErrorMessage(result, fallback = 'Invalid data.') {
  return result?.error?.issues?.[0]?.message || fallback;
}
