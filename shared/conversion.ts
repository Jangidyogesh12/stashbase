import type { z } from 'zod';
import type { conversionProgressSchema } from './protocols/http/index-status.ts';

export type ConversionProgress = z.output<typeof conversionProgressSchema>;
