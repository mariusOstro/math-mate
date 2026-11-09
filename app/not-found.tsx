import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="load-error">
      <h1>Siden finnes ikke</h1>
      <p>Du kan starte en ny matematikkøkt fra forsiden.</p>
      <Link className="button primary" href="/">
        Til MathMate
      </Link>
    </main>
  );
}
