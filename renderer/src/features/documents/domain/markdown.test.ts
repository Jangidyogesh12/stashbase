import { describe, expect, it } from 'vite-plus/test';

import { splitLeadingYamlFrontmatter } from './markdown';
import { retainDocumentTabIds } from './retained-tabs';

describe('Markdown document policy', () => {
  it('keeps valid leading YAML verbatim and leaves malformed metadata in the document body', () => {
    expect(splitLeadingYamlFrontmatter('---\ntitle: Plan\n---\n# Body')).toEqual({
      body: '# Body',
      source: '---\ntitle: Plan\n---\n',
    });
    expect(splitLeadingYamlFrontmatter('---\ntitle: [broken\n---\n# Body')).toEqual({
      body: '---\ntitle: [broken\n---\n# Body',
      source: '',
    });
  });

  it('retains activated Markdown and HTML sessions and drops closed documents', () => {
    const tabs = [
      { id: 'markdown', source: { path: 'plan.markdown' } },
      { id: 'text', source: { path: 'notes.txt' } },
      { id: 'form', source: { path: 'form.html' } },
    ];

    expect(retainDocumentTabIds(['missing', 'text'], tabs, 'text')).toEqual([]);
    expect(retainDocumentTabIds([], tabs, 'markdown')).toEqual(['markdown']);
    expect(retainDocumentTabIds(['markdown'], tabs, 'form')).toEqual(['form', 'markdown']);
  });
});
