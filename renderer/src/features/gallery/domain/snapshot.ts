/** Bundled projects render before the network answers and remain usable offline. */
import type { GalleryEntry } from './entry';

export const GALLERY_SNAPSHOT: readonly GalleryEntry[] = [
  {
    about:
      "Build your resume with an Agent that interviews you first. For students and early-career job seekers, whether it's your first resume or your old one undersells you.\n\nStart with your current resume or LinkedIn profile. The Agent asks about what's missing, like what you did yourself and what came of it, then writes a one-page resume from your answers. Paste a job description and it writes a version for that job, picking from everything you've told it, plus a cover letter if you need one.",
    category: 'career',
    description:
      'Build a resume that shows what you actually did, and tailor it to every job you apply for.',
    id: 'resume-builder',
    name: 'Resume Builder',
    repo: 'https://github.com/0-bingwu-0/resume-builder',
    screenshot: null,
  },
  {
    about:
      "Post on LinkedIn consistently with a ghostwriter that learns your background and writing style. For students, builders, and professionals who want to share what they're working on and learning.\n\nStart from something you've been building or learning, or from today's AI news on the X accounts you follow. The Agent writes the LinkedIn post and asks for the one detail only you know when it matters. Once you approve, it turns the post into an X Post or X Article, whichever fits.",
    category: 'personal brand',
    description:
      'Share what you build and learn on LinkedIn, in your own voice, then bring it to X.',
    id: 'linkedin-ghostwriter',
    name: 'LinkedIn Ghostwriter',
    repo: 'https://github.com/0-bingwu-0/linkedin-ghostwriter',
    screenshot: null,
  },
  {
    about:
      'Build a consistent posting habit on X with a content partner that learns your background and writing style. For builders, founders, and professionals who want to share their views and develop a personal brand.\n\nFind topics from the accounts you follow, connect them to your own point of view, and turn an approved outline into a Post or Article. Keep your drafts and past posts together so each new piece can build on what you have already shared.',
    category: 'personal brand',
    description:
      'Build your personal brand on X by sharing your ideas consistently, in your own voice.',
    id: 'x-content-starter',
    name: 'X Content Starter',
    repo: 'https://github.com/0-bingwu-0/x-content-starter',
    screenshot: null,
  },
  {
    about:
      "Follow new AI research and see what it changes for your work. For analysts, investors, and other professionals who need to keep up with AI but don't do research for a living.\n\nTell the Agent what you do and which views you're tracking. It pulls the papers the AI community is paying attention to from Hugging Face Daily Papers, picks out the ones that support or challenge your views, and explains why in a short digest. Ask about a trend, a view, or a paper, and get an answer from your paper library, with sources.",
    category: 'research',
    description: 'Keep up with the AI papers that matter for your work, without reading them all.',
    id: 'paper-tracker-for-industry',
    name: 'Paper Tracker for Industry',
    repo: 'https://github.com/0-bingwu-0/paper-tracker-for-industry',
    screenshot: null,
  },
];
