import { api } from './api';

/** מוחק חוזה אחרי אישור. מחזיר true אם נמחק. */
export async function confirmAndDeleteContract(contract: { id: string; title: string; status: string }): Promise<boolean> {
  const warning =
    contract.status === 'נחתם'
      ? `החוזה "${contract.title}" כבר נחתם על ידי העובד/ת. למחוק אותו בכל זאת? המחיקה סופית, כולל החתימה.`
      : `למחוק את החוזה "${contract.title}"? המחיקה סופית.`;
  if (!confirm(warning)) return false;
  try {
    await api.delete(`/contracts/${contract.id}`);
    return true;
  } catch (err: any) {
    alert(err.message || 'שגיאה במחיקת החוזה');
    return false;
  }
}
