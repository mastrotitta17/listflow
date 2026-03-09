import PaymentSuccess from '@/components/PaymentSuccess';
import { buildPrivateMetadata } from "@/lib/seo";

export const metadata = buildPrivateMetadata("Payment Success", "/payment-success");

export default function PaymentSuccessPage() {
  return <PaymentSuccess />;
}
