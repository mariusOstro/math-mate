import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'MathMate – øv på matematikk',
  description:
    'Øv på tekstoppgaver i ditt eget tempo, med stegvis veiledning og en norsk AI-veileder.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nb">
      <body>{children}</body>
    </html>
  );
}
