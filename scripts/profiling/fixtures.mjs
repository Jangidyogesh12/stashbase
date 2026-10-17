// Deterministic test projects. Regenerated on every run so results never
// depend on what an earlier run saved.

import fs from "node:fs";
import path from "node:path";

function writeNotes(projectDirectory, { topics, notesPerTopic }) {
  for (let topic = 0; topic < topics; topic++) {
    const directory = path.join(projectDirectory, "notes", `topic-${topic}`);
    fs.mkdirSync(directory, { recursive: true });
    for (let note = 0; note < notesPerTopic; note++) {
      fs.writeFileSync(
        path.join(directory, `note-${note}.md`),
        `# Note ${topic}-${note}\n\nSome body text for note ${note}.\n`,
      );
    }
  }
}

// About 124 KB: 2,305 editor paragraphs in sections of a heading, a prose
// paragraph with inline marks, and a three-item `-` list.
function longMarkdownDocument(targetBytes) {
  const blocks = [];
  for (let section = 1; blocks.join("\n\n").length < targetBytes; section++) {
    blocks.push(
      `## Section ${section}`,
      `Some **bold** prose with a [link](https://example.com/${section}) and \`code\` that keeps going for a while so the paragraph is realistic in length, more words here.`,
      `- item one ${section}\n- item two\n- item three`,
    );
  }
  return `# Big document\n\n${blocks.join("\n\n")}\n`;
}

/** 300 short notes plus one long Markdown document, `big.md`. */
export function writeEditingProject(projectDirectory) {
  fs.rmSync(projectDirectory, { recursive: true, force: true });
  fs.mkdirSync(projectDirectory, { recursive: true });
  writeNotes(projectDirectory, { topics: 10, notesPerTopic: 30 });
  const documentPath = path.join(projectDirectory, "big.md");
  const original = longMarkdownDocument(120 * 1024);
  fs.writeFileSync(documentPath, original);
  return { documentName: "big.md", documentPath, original, markdownFiles: 301 };
}
