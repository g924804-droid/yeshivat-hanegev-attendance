import { Construction } from 'lucide-react';
import { Layout } from '../components/Layout';

export function ComingSoon({ title = 'בקרוב' }: { title?: string }) {
  return (
    <Layout title={title}>
      <div className="card flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Construction className="text-gold-dark" size={36} />
        <h2 className="font-bold text-navy text-lg">בקרוב</h2>
        <p className="text-slate-500 text-sm">המודול הזה נמצא בפיתוח.</p>
      </div>
    </Layout>
  );
}
