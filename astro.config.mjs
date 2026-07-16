// @ts-check
import { defineConfig } from 'astro/config';
import { visit } from 'unist-util-visit';

// Wraps every rendered <table> in a scrollable div, since overflow-x:auto
// on the table itself doesn't reliably constrain a table's width on mobile.
function rehypeWrapTables() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName === 'table' && parent && index !== null) {
        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['table-wrap'] },
          children: [node],
        };
      }
    });
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://jordanenglish.github.io',
  base: '/cv/',
  markdown: {
    smartypants: false,
    rehypePlugins: [rehypeWrapTables],
  },
});
