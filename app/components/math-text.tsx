import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';

export function MathText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const text = children
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => `\n$$\n${math}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math: string) => `$${math}$`);
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[
          rehypeSanitize,
          [
            rehypeKatex,
            { throwOnError: false, trust: false, strict: 'ignore' },
          ],
        ]}
        skipHtml
        disallowedElements={['img']}
        unwrapDisallowed
        components={{ a: ({ children }) => <span>{children}</span> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
