// Redirect permanente: /alertas → /radar
import { redirect } from 'next/navigation';

export default function AlertasRedirect() {
  redirect('/radar');
}
